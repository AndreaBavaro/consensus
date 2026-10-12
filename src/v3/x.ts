import { env } from "../lib/env.ts";
import { logger } from "../lib/log.ts";
import { meter } from "../lib/meter.ts";
import { completeJson } from "../llm.ts";
import { BASE_FILTERS, PROMO, clean } from "../sources/twitter.ts";
import { sleep } from "./limit.ts";
import { pace, registerSearch, xBackoff } from "./xpace.ts";
import type { RawPost } from "./types.ts";

/*
 * X pool (round B, wide): one LLM call writes 12 narrow first-person opinion queries plus 4 broad subject+topic
 * queries. Code fans the broad ones out into Top and Latest lanes plus min_faves:20 (Top) and min_faves:5 (Latest)
 * variants, so popular takes and fresh volume both come in. `lang:en -filter:retweets` and the date window are
 * appended, every lane runs at once through one paced client (no hedged duplicates: each duplicate is billed), each
 * opinion lane pages up to 5 times (broad/popular 3), paging stops when a page is thin (<10) or mostly off-topic (<30% mention a name), and a
 * per-search spend cap (X_MAX_USD, default $0.30) and an 11s time budget (X_TIME_MS) stop new pages.
 */
const log = logger("v3-x");
const USD_PER_TWEET = 0.15 / 1000;
const MIN_CHARS = 25;
/** Tweets with fewer words than this carry no usable stance once @handles and links are stripped. */
const MIN_WORDS = 5;
/** Deal-bot listings ("$48.75 (Extra $12.19 Checkout Savings) ... 4.5 out of 5 stars (89 ratings)") flood short windows. */
const DEAL =
  /checkout savings|out of 5 stars|\(\d[\d,]* ratings?\)|\bwas \$\d|\blist price\b|\bclip (the )?coupon|\bsubscribe ?& ?save\b|\blowest price\b|\bprice tracker\b|amzn\.to|\$\d+(\.\d\d)?\s*\((extra|save|reg)/i;
const X_MAX_USD = Number(process.env.X_MAX_USD ?? 1.2);
const MAX_PAGES = Number(process.env.X_PAGES ?? 8);
/** Broad and popular lanes turn ~10-15% of tweets into opinions vs ~25-35% for opinion lanes (round B), so they page less. */
const WIDE_PAGES = Number(process.env.X_WIDE_PAGES ?? 1);
/** No new page starts this long after the first X lane launched, so slow deep lanes cannot hold up the poll. */
const X_TIME_MS = Number(process.env.X_TIME_MS ?? 16_000);

interface Tweet {
  id: string;
  text?: string;
  url?: string;
  createdAt?: string;
  likeCount?: number;
  replyCount?: number;
  retweetCount?: number;
  quoteCount?: number;
  viewCount?: number;
  isReply?: boolean;
  conversationId?: string;
  lang?: string;
  author?: { userName?: string; name?: string; url?: string; profilePicture?: string; followers?: number; isBlueVerified?: boolean; isVerified?: boolean; isAutomated?: boolean };
}

/** Why X pages ended without data (pace skip vs retries exhausted by kind), logged once per search. */
type XFail = "skip" | "deferred" | "r429" | "r5xx" | "timeout" | "net" | "http4xx" | "retry429" | "retry5xx" | "retryTimeout" | "retryNet";
const fails = new WeakMap<object, Partial<Record<XFail, number>>>();
const bump = (k: XFail) => {
  const m = meter();
  if (!m) return;
  const f = fails.get(m) ?? {};
  f[k] = (f[k] ?? 0) + 1;
  fails.set(m, f);
};

/*
 * One rate cut per 429 episode. A burst of 429s comes back on many in-flight pages at once; cutting 40% on each one took
 * the rate from 34 to 3.4 req/s within ~250ms, after which pace() skipped ~12% of a search's pages (x_failed).
 */
const CUT_EVERY_MS = Number(process.env.X_CUT_EVERY_MS ?? 1_000);
let lastCut = 0;

/*
 * Per-search page queue (fair share under load). With N live searches each instance gets ~34/N req/s, and a search
 * starts ~100 lanes at once. First-come pacing gave the first ~34 lanes every slot (and their deep pages) while the
 * rest, including the plan wave's opinion lanes, were skipped and counted as failed (N=10: 53% of pages). Pages now
 * wait in one queue per search and the next slot goes to the shallowest page, then the higher-yield lane kind; a
 * page still queued after X_QUEUE_MS is deferred (not sent, not a failed call).
 */
const QUEUE_MS = Number(process.env.X_QUEUE_MS ?? 10_000);
/** Queued pages may still go out this long after X_TIME_MS (deep pages already stop starting at X_TIME_MS). */
const QUEUE_TAIL_MS = Number(process.env.X_QUEUE_TAIL_MS ?? 8_000);
/** Opinions per page by lane kind on kb1: replies 2.3, opinion 1.5-1.9, pick 1.3, broad 0.7. */
const KIND_RANK: Record<XLane["kind"], number> = { replies: 0, opinion: 0, pick: 0.5, convo: 0.5, popular: 1, broad: 1 };
/*
 * A lane whose served pages kept at least this many new usable posts per page sends its next page ahead of untried
 * first pages. Lanes at 12+ kept/page carry 2.15 opinions/page vs 0.22 under 5 (kb1/k1/r6/k407a/r7-r8/b0, 46k pages);
 * at N=10 the pure shallow-first queue spent pear x's ~62 pages on 62 page-0s and never reached "yc changed my life".
 * 0 turns it off.
 */
const HOT_KEPT = Number(process.env.X_HOT_KEPT ?? 12);

class PageQueue {
  private q: { pri: number; seq: number; at: number; signal?: AbortSignal; go: (r: "go" | "deferred" | "skip") => void }[] = [];
  private seq = 0;
  private pumping = false;
  deferred = 0;
  /** No queued page is sent after this (epoch ms); set once the lane clock starts so waits cannot outlast the X budget. */
  until = Infinity;

  /** "go" when this page may be sent; "deferred" when it waited past X_QUEUE_MS (or the search ended); "skip" from pace(). */
  take(pri: number, signal?: AbortSignal): Promise<"go" | "deferred" | "skip"> {
    return new Promise((go) => {
      this.q.push({ pri, seq: this.seq++, at: Date.now(), signal, go });
      void this.pump();
    });
  }

  private expire() {
    const now = Date.now();
    this.q = this.q.filter((r) => {
      if (r.signal?.aborted) return r.go("deferred"), false;
      if (now - r.at <= QUEUE_MS && now <= this.until) return true;
      this.deferred++;
      bump("deferred");
      return r.go("deferred"), false;
    });
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (this.expire(); this.q.length; this.expire()) {
        // Reserve the slot first, then pick: a page queued during the wait can still take it.
        const ok = await pace();
        this.expire();
        if (!this.q.length) break;
        let b = 0;
        for (let i = 1; i < this.q.length; i++) {
          const a = this.q[i]!, c = this.q[b]!;
          if (a.pri < c.pri || (a.pri === c.pri && a.seq < c.seq)) b = i;
        }
        const r = this.q.splice(b, 1)[0]!;
        r.go(ok ? "go" : "skip");
      }
    } finally {
      this.pumping = false;
    }
  }
}

async function xSearch(query: string, type: "Top" | "Latest", cursor: string, signal?: AbortSignal, slot?: { queue: PageQueue; pri: number }) {
  const m = meter();
  let last: XFail = "retryNet";
  for (let attempt = 0; attempt < 5; attempt++) {
    if (signal?.aborted) return null;
    // Global pacing (xpace.ts) through the search's page queue. A deferred page was never sent, so it is not a failed
    // call; a page pace() refuses (queue wait past X_MAX_WAIT_MS) still is.
    const got = slot ? await slot.queue.take(slot.pri, signal) : (await pace()) ? "go" : "skip";
    if (got === "deferred" || signal?.aborted) return null;
    if (got === "skip") {
      if (m) m.xFailed++;
      bump("skip");
      return null;
    }
    if (m) m.xCalls++;
    try {
      const res = await fetch(`https://api.twitterapi.io/twitter/tweet/advanced_search?${new URLSearchParams({ query, queryType: type, cursor })}`, {
        headers: { "X-API-Key": env.twitterKey! },
        signal: AbortSignal.any([AbortSignal.timeout(12_000), ...(signal ? [signal] : [])]),
      });
      if (res.status === 429) {
        if (Date.now() - lastCut > CUT_EVERY_MS) {
          lastCut = Date.now();
          xBackoff(Number(res.headers.get("retry-after")) || 0);
        }
        throw Object.assign(new Error("retry 429"), { kind: "retry429" });
      }
      if (res.status >= 500) throw Object.assign(new Error(`retry ${res.status}`), { kind: "retry5xx" });
      if (!res.ok) {
        // A rejected query is retried once without exclusions and quoted-phrase groups beyond the first.
        const simpler = res.status === 400 ? simplify(query) : null;
        if (simpler && simpler !== query) {
          log.warn("search 400, retrying simpler", { query });
          query = simpler;
          continue;
        }
        if (m) m.xFailed++;
        bump("http4xx");
        log.warn(`search ${res.status}`, { query });
        return null;
      }
      const data = (await res.json()) as { tweets?: Tweet[]; has_next_page?: boolean; next_cursor?: string };
      // 15 credits per tweet, 15-credit minimum per call ($1 = 100k credits).
      if (m) m.xUsd += Math.max(1, data.tweets?.length ?? 0) * USD_PER_TWEET;
      return data;
    } catch (e) {
      if (signal?.aborted) return null;
      if (m) m.xRetries++;
      last = (e as { kind?: XFail }).kind ?? ((e as Error)?.name === "TimeoutError" ? "retryTimeout" : "retryNet");
      bump(last);
      await sleep(500 * 2 ** attempt + Math.random() * 300);
    }
  }
  if (m) m.xFailed++;
  bump(last === "retry429" ? "r429" : last === "retry5xx" ? "r5xx" : last === "retryTimeout" ? "timeout" : "net");
  return null;
}

/** Drops -exclusions and keeps the query under 300 characters; used after an HTTP 400. */
function simplify(query: string): string {
  const out = query.replace(/\s-(?!filter:)(?:"[^"]*"|[^\s()"]+)/g, "").replace(/\s+/g, " ").trim();
  return out.length > 300 ? trimQuery(out, 300) : out;
}

const SCHEMA = {
  type: "object",
  properties: {
    names: { type: "array", items: { type: "string" } },
    opinion: { type: "array", items: { type: "string" } },
    broad: { type: "array", items: { type: "string" } },
    picks: { type: "array", items: { type: "string" } },
    asks: { type: "array", items: { type: "string" } },
  },
  required: ["names", "opinion", "broad", "picks", "asks"],
};

export interface LaneStat {
  query: string;
  kind: XLane["kind"];
  type: XLane["type"];
  pages: number;
  raw: number;
  kept: number;
  stop: string;
  opinions?: number;
}

export interface XLane {
  query: string;
  type: "Top" | "Latest";
  pages: number;
  kind: "opinion" | "broad" | "popular" | "pick" | "replies" | "convo";
}
/** X rejects very long queries (HTTP 400); longer ones are cut at an OR boundary. */
const MAX_QUERY_CHARS = 480;
const PICK_PAGES = Number(process.env.X_PICK_PAGES ?? 2);
const REPLY_PAGES = Number(process.env.X_REPLY_PAGES ?? 5);
/** X round 6: pick names AND-ed with verdict words turned 15-21 of every 100 tweets into opinions (bare picks 5.7). */
const VERDICT_LANES = Number(process.env.X_VERDICT_LANES ?? 20);
const VERDICT_PAGES = Number(process.env.X_VERDICT_PAGES ?? 6);

const PLAN_DEADLINE_MS = Number(process.env.X_PLAN_MS ?? 13_000);
/** Conversation lane: tweets with this many replies whose reply threads are read in full. */
const CONVO_MIN_REPLIES = Number(process.env.X_CONVO_MIN_REPLIES ?? 4);
const CONVO_THREADS = Number(process.env.X_CONVO_THREADS ?? 10);
const CONVO_PAGES = Number(process.env.X_CONVO_PAGES ?? 3);
const STOP = new Set("a an the is are was were be been will would should could can do does did i me my we you your it its of to for in on at by with or and vs versus than then good bad better best worth really right now still another gonna going get getting who what which when where why how this that these those about over any some most more".split(" "));

/** Lanes from the question alone, used only when the planner call fails. */
export function fallbackPlan(query: string) {
  const vs = query.match(/^(?:is\s+)?(.+?)\s+(?:vs\.?|versus|or)\s+(.+?)\??$/i);
  const words = query.toLowerCase().replace(/[^a-z0-9.\-+ ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
  const sides = vs ? [vs[1]!, vs[2]!].map((x) => x.toLowerCase().replace(/^(is|should i (get|pick|use|choose)|which is better)\s+/, "").trim()) : [];
  const group = (xs: string[]) => (xs.length > 1 ? `(${xs.map((x) => (x.includes(" ") ? `"${x}"` : x)).join(" OR ")})` : xs[0]!.includes(" ") ? `"${xs[0]}"` : xs[0]!);
  // Not a comparison: the main words are AND-ed (X matches each word anywhere), at most three of them.
  const subject = sides.length ? sides : words.length ? words : [query.toLowerCase()];
  const subj = sides.length ? group(sides) : subject.slice(0, 3).join(" ");
  const phrases = ['("I think" OR "imo" OR "honestly")', '("worth it" OR "not worth" OR "overrated" OR "underrated")', '("I love" OR "I hate" OR "best" OR "worst")', '("switched" OR "never again" OR "regret" OR "recommend")', '("will" OR "won\'t" OR "no way" OR "definitely")'];
  return {
    // Short names ("yc", "sf", "a16z") are often the whole subject, so every non-stopword counts.
    names: [...new Set([...(sides.length ? sides : []), ...words])].concat(words.length ? [] : [query.toLowerCase()]),
    opinion: [...phrases.map((ph) => `${subj} ${ph}`), ...sides.map((x) => `${group([x])} ("I think" OR "better" OR "prefer")`)],
    broad: [subj, ...sides.map((x) => group([x])), ...(sides.length ? [] : subject.slice(0, 2).length === 2 ? [subject.slice(0, 2).join(" ")] : [])].slice(0, 4),
    picks: [...sides.map((x) => `"switched to" ${group([x])}`), ...sides.map((x) => `${group([x])} better`)],
  };
}

const ENRICH_SCHEMA = {
  type: "object",
  properties: {
    answers: { type: "array", items: { type: "string" } },
    phrasings: { type: "array", items: { type: "string" } },
    asks: { type: "array", items: { type: "string" } },
    names: { type: "array", items: { type: "string" } },
  },
  required: ["answers", "phrasings", "asks", "names"],
};

/**
 * Query enrichment (sparse round 3): the plan call names a handful of picks; sparse "best X" questions need every
 * real answer searched on its own ("best vc for b2b saas" -> bessemer, insight, battery, emergence...), and the
 * everyday wordings people tweet ("went through yc", "raised from a16z"). Returned as bare queries.
 */
export async function enrichX(query: string, signal: AbortSignal): Promise<{ picks: string[]; phrasings: string[]; asks: string[]; names: string[] } | null> {
  const prompt = [
    `Question for a public-opinion poll built from X (Twitter) posts: "${query}"`,
    `Using what you know, list:`,
    `answers: up to 20 specific answers people actually give to this question, each as a SHORT X search (1 to 3 words) that pairs the answer with just enough context to stay on topic. For "best X": the real named picks (for "best note taking app": obsidian, notion, "apple notes", bear; for "best ramen in sf": marufuku, "mensho tokyo", "ramen nagi"). For yes/no and A vs B: the subject with the verdict words people use ("yc changed my life", "yc not worth", "regret yc").`,
    `phrasings: up to 10 SHORT first-person phrases people tweet when they have a real experience or verdict on this exact subject, each including the subject name (e.g. "did yc", "went through yc", "my yc batch", "rejected by yc", "pitched sequoia", "raised from a16z").`,
    `asks: up to 6 SHORT queries that find tweets asking for recommendations on this question ("best saas vcs", "recommend a seed fund", "best ramen sf").`,
    `names: up to 10 lowercase spellings, nicknames and handles of the subject and the main answers (e.g. "bvp", "@bessemervp").`,
    `No operators, no dates, no lang:. Plain lowercase strings, quotes only around multi-word exact phrases.`,
    `The examples above are for OTHER questions and only show the style: never use an example's subject (yc, sequoia, a16z, ramen...) unless "${query}" itself is about it or it is a real answer to it.`,
    `Never use a 1 to 3 letter abbreviation on its own unless people universally tweet it that way (yc, a16z); write the full name ("entrepreneur first", not "ef"), because short letters match unrelated tweets.`,
  ].join("\n");
  const r = await completeJson<{ answers?: unknown[]; phrasings?: unknown[]; asks?: unknown[]; names?: unknown[] }>(
    prompt,
    ENRICH_SCHEMA,
    { model: process.env.X_ENRICH_MODEL ?? env.classifierModel, maxTokens: 1200, timeoutMs: PLAN_DEADLINE_MS, signal },
    0,
  );
  const s = (a?: unknown[], n = 20) => (a ?? []).filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()).slice(0, n);
  return { picks: s(r.answers, 20), phrasings: s(r.phrasings, 10), asks: s(r.asks, 6), names: s(r.names, 10) };
}

type RawPlan = { names?: unknown[]; opinion?: unknown[]; broad?: unknown[]; picks?: unknown[]; asks?: unknown[] };

/** X's until: is exclusive, so the inclusive end date becomes the next day. */
function xDates(window: { since?: string; until?: string }): string {
  const untilX = window.until ? new Date(Date.parse(`${window.until}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : undefined;
  return `${window.since ? ` since:${window.since}` : ""}${untilX ? ` until:${untilX}` : ""}`;
}

/** Short windows (past week/month) have a small fraction of the volume, so queries get looser and lanes lean on Latest. */
function windowSpan(window: { since?: string; until?: string }) {
  const span = window.since ? (Date.parse(window.until ? `${window.until}T00:00:00Z` : new Date().toISOString()) - Date.parse(`${window.since}T00:00:00Z`)) / 86_400_000 : Infinity;
  return { days: Math.max(1, Math.round(span)), short: span <= 45 };
}

function planPrompt(query: string, window: { since?: string; until?: string }): string {
  const { days, short } = windowSpan(window);
  return `We are building a public-opinion poll from X (Twitter) posts on the question: "${query}"
Write X advanced-search queries. We want the LARGEST possible pool of posts where real people talk about this question, while staying on this exact subject.

X matches keywords literally (every bare word must appear). Use "exact phrases", (a OR b) groups, and -word exclusions for other meanings of the same words (other products, people, places, crypto/stock tickers, memes).

opinion: 16 queries that pin a FIRST-PERSON or verdict phrase next to the subject, e.g. ("I think" OR "I switched" OR "I love" OR "I hate" OR "worth it" OR "overrated" OR "highly recommend" OR "never again"). Cover both sides, and for comparisons each side separately and head-to-head. End each with: -giveaway -webinar -podcast -hiring -course -"link in bio".

broad: 4 SHORT queries of just the subject (with its spellings in an OR group) plus at most one topic word group, no opinion phrases, e.g. (hubspot OR "hub spot") (crm OR pricing OR "small business"). These must be broad enough to return thousands of posts but still only about this subject: add -exclusions for colliding meanings. For a "best X" question, use the category plus its common picks, e.g. (pizza) (topping OR toppings OR pepperoni OR pineapple). For a person or event, the name plus the event, e.g. (trump) (2028 OR "third term" OR reelection OR "run again").

${short ? `IMPORTANT: we only search the last ${days} days, so volume is tiny. Keep every query loose: at most ONE short opinion phrase group per opinion query (or none), never two AND-ed groups, and the broad queries should be the bare subject names (category words like "running shoes" plus brand/model names people use, e.g. (nike OR asics OR brooks OR hoka) (running OR runner OR shoes)).\n` : ""}Do NOT add lang:, filter:, min_faves or date operators; we add those.
names: 4 to 16 lowercase subject names/spellings and the everyday synonyms people use for the subject; a post must contain at least one to be kept, so be generous with synonyms (for "will ai replace software engineers": ["software engineer","software engineers","swe","swes","developers","developer","programmers","programmer","coders","coding jobs","dev jobs"]) (e.g. ["standing desk","standing desks","sit stand desk","sit-stand"]). Also include the joined and split spellings and common nicknames people actually type (e.g. ["pearx","pear x","pear vc","yc","y combinator","ycombinator"], ["sf","san francisco"]). Keep each name specific enough that it does not match unrelated posts.

picks: 14 SHORT queries (1 to 4 words), one per answer or side people most often give, each pairing that answer with the subject so it stays on topic, and no opinion phrases. For "best X": the common named picks (pineapple pizza, keychron keyboard; for "best VC": sequoia, a16z, benchmark, "founders fund"; for "best accelerator": yc, "a16z speedrun", neo, hf0, pearx, antler, techstars). For A vs B: each side alone, "switched to" each side, and head-to-head (cursor "claude code"). For yes/no or worth-it: the subject with the stance words people use ("not worth it" (steam deck OR steamdeck), "love my" (steam deck OR steamdeck)). For people/events: the name plus the event word.

asks: 6 SHORT queries (1 to 4 words, the subject plus at most one word) that find tweets which DRAW REPLIES with people's answers: people asking the question ("pearx or yc", "should I do yc"), rankings/tier lists ("best accelerators", "top vc firms", "accelerator tier list"), and hot takes on the subject ("yc overrated", "a16z speedrun"). Include each named subject's official handle as @handle if it has one (e.g. @ycombinator, @pearvc, @a16z, @sequoia, @spc).

Keep "names" SHORT (at most 16) and use the shortest everyday forms (e.g. "vc", "vcs", "venture capital"), never long phrase variants.`;
}

/**
 * The plan call. Three identical calls race under one hard deadline (a slow provider once held X up for 41s); the first
 * answer wins. Rejects only if all three fail.
 */
function planCall(query: string, window: { since?: string; until?: string }, signal: AbortSignal): Promise<RawPlan> {
  const prompt = planPrompt(query, window);
  const call = () => completeJson<RawPlan>(prompt, SCHEMA, { maxTokens: 3500, timeoutMs: PLAN_DEADLINE_MS, signal }, 0);
  return Promise.any([call(), sleep(1_000).then(call), sleep(3_000).then(call)]);
}

/** Plan plus enrichment in one plan: plan entries first, then the enrichment's answers, phrasings, asks and names. */
function mergePlan(plan: RawPlan, extra: Awaited<ReturnType<typeof enrichX>>): RawPlan {
  if (!extra) return plan;
  const arr = (a?: unknown[]) => (Array.isArray(a) ? a : []);
  return { ...plan, picks: [...arr(plan.picks), ...extra.picks], opinion: [...arr(plan.opinion), ...extra.phrasings], asks: [...arr(plan.asks), ...extra.asks], names: [...arr(plan.names), ...extra.names] };
}

/** The enrichment alone as a plan (wave 1): its answers become pick lanes and its phrasings opinion lanes. */
function enrichPlan(extra: NonNullable<Awaited<ReturnType<typeof enrichX>>>): RawPlan {
  return { picks: extra.picks, opinion: extra.phrasings, asks: extra.asks, names: extra.names, broad: [] };
}

/**
 * Lanes and conversation seeds from a plan. `fullOpinions` / `fullPicks` lanes page deep, the rest 3 to 4 pages;
 * `partial` (wave 1) skips the question-as-broad-query fallback because the full plan is still coming.
 */
export function buildLanes(r: RawPlan, query: string, window: { since?: string; until?: string }, opts: { fullOpinions?: number; fullPicks?: number; partial?: boolean } = {}): { names: string[]; lanes: XLane[]; seeds: string[] } {
  const { fullOpinions = 16, fullPicks = 14, partial = false } = opts;
  const strs = (a?: unknown[]) => (a ?? []).filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim());
  const names = strs(r.names).map((n) => n.toLowerCase().replace(/"/g, "").replace(/^@/, "").trim()).filter(Boolean);
  // X's until: is exclusive, so the inclusive end date becomes the next day.
  const dates = xDates(window);
  const { short } = windowSpan(window);
  // The length limit applies to the whole query, so the body gets whatever the suffix leaves.
  const q = (s: string, extra = "") => {
    const tail = `${extra} ${BASE_FILTERS}${dates}`;
    return `${trimQuery(capExclusions(s), MAX_QUERY_CHARS - tail.length)}${tail}`;
  };
  const uniq = (xs: string[]) => {
    const seen = new Set<string>();
    return xs.filter((x) => {
      const k = x.toLowerCase().replace(/["()]/g, "").replace(/\s+/g, " ").trim();
      return !!k && !seen.has(k) && !!seen.add(k);
    });
  };
  // Plan opinions first (16), then the enrichment's first-person phrasings (10).
  const opinion = uniq(strs(r.opinion)).slice(0, 26);
  const broad = strs(r.broad).slice(0, 4);
  // Plan picks (14) then enrichment answers (20); sparse round 3.
  const picks = uniq(strs(r.picks)).slice(0, 34);
  const asks = uniq(strs(r.asks)).slice(0, VERDICT_LANES);
  // Sparse round 4: bare pick names ("bessemer") return mostly funding news; the same name AND-ed with verdict words
  // returns the posts that actually judge it. Only for short name-like picks (best-X answers), not stance phrases.
  const VERDICT = `("love" OR "best" OR "great" OR "recommend" OR "underrated" OR "overrated" OR "avoid" OR "worst" OR "terrible" OR "regret" OR "favorite")`;
  const STANCE = /\b(worth|regret|love|hate|best|worst|changed|not|never|switched)\b/i;
  /*
   * X round 7: quoting the whole pick ("sequoia b2b saas") AND verdict words returned 0 tweets on every lane, and stance
   * picks ("hf0 scam") matched nothing either. The verdict lane now quotes only the pick's own name (the words not in
   * the question) and keeps the question words it carried as one OR group for context; picks with no name left skip it.
   */
  const qWords = new Set(query.toLowerCase().replace(/[^a-z0-9.\-+ ]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)));
  const NOT_NAME = /^(scam|legit|useless|helpful|review|reviews|experience|good|bad|great|too|expensive|cheap|clunky|alternatives?|funding|equity|batch|demo|day|network|alumni|program|early|late|worth|regret|love|hate|overrated|underrated|vs|free|starter|pro|plan|pricing|price|win|wins|lose|loses|landslide|reelection|term|second|third)$/i;
  const verdictBody = (pick: string): string | null => {
    if (pick.includes('"') || pick.includes("(") || STANCE.test(pick)) return null;
    const words = pick.toLowerCase().split(/\s+/).filter(Boolean);
    const own = words.filter((w) => !qWords.has(w) && !STOP.has(w));
    const ctx = words.filter((w) => qWords.has(w));
    if (!own.length || own.length > 3 || own.some((w) => NOT_NAME.test(w))) return null;
    const name = own.length > 1 ? `"${own.join(" ")}"` : own[0]!;
    return ctx.length > 1 ? `${name} (${ctx.join(" OR ")})` : ctx.length ? `${name} ${ctx[0]}` : name;
  };
  const verdictPicks = process.env.X_PICK_VERDICT === "0" ? [] : uniq(picks.map(verdictBody).filter((s): s is string => !!s)).slice(0, VERDICT_LANES);
  if (!partial && !opinion.length && !broad.length) broad.push(query);
  const POPULAR = process.env.X_POPULAR === "1";
  const lanes: XLane[] = [
    ...opinion.map((s, i): XLane => ({ query: q(s), type: (short ? i % 2 === 1 : i % 4 === 3) ? "Latest" : "Top", pages: i < fullOpinions ? MAX_PAGES : 4, kind: "opinion" })),
    ...broad.flatMap((s): XLane[] => [
      { query: q(s), type: "Top", pages: short ? MAX_PAGES : WIDE_PAGES, kind: "broad" },
      ...(short ? [{ query: q(s), type: "Latest" as const, pages: MAX_PAGES, kind: "broad" as const }] : []),
    ]),
    // Sparse round 2: popular lanes turned 2.6 of every 100 tweets into opinions (opinion lanes 9.3), so they are off by default.
    ...(POPULAR ? broad.slice(0, 2) : []).flatMap((s): XLane[] => [
      { query: q(s, short ? " min_faves:3" : " min_faves:20"), type: "Top", pages: WIDE_PAGES, kind: "popular" },
      { query: q(s, short ? " min_faves:1" : " min_faves:5"), type: "Latest", pages: WIDE_PAGES, kind: "popular" },
    ]),
    // Backtest round 1: one lane per likely answer (strategy D) and reply threads on Latest (strategy F) found the most
    // opinions the other lanes missed; together with the opinion lanes they roughly doubled opinions per question.
    ...picks.map((s, i): XLane => ({ query: q(s), type: "Top", pages: i < fullPicks ? PICK_PAGES : Math.min(PICK_PAGES, 2), kind: "pick" })),
    ...verdictPicks.map((s, i): XLane => ({ query: q(`${s} ${VERDICT}`), type: i % 2 ? "Latest" : "Top", pages: VERDICT_PAGES, kind: "opinion" })),
    // Replies are the highest-yield lane (8.9 opinions per 100 tweets): every pick gets one.
    ...[...picks.slice(0, 24), ...broad.slice(0, 2)].map((s, i): XLane => ({ query: q(s, " filter:replies"), type: "Latest", pages: i < 10 ? REPLY_PAGES : 3, kind: "replies" })),
  ];
  // Conversation seeds: tweets with replies on the subject; their reply threads are read in full by collectX.
  // Sparse round 1: broad seeds pulled unrelated conversations (687 posts, 1 opinion on "best seed fund"); asks and picks hold the answers.
  const seedBodies = [...new Set([...asks, ...picks.slice(0, 6)])];
  const seeds = seedBodies.map((s) => q(s, ` min_replies:${CONVO_MIN_REPLIES} -filter:replies`));
  return { names: names.length || partial ? names : [query.toLowerCase()], lanes, seeds };
}

/** Plan and enrichment together, then all lanes at once (used by eval scripts; collectX streams the two waves). */
export async function planXSearches(query: string, window: { since?: string; until?: string }, signal?: AbortSignal): Promise<{ names: string[]; lanes: XLane[]; seeds: string[] }> {
  const planAbort = AbortSignal.any([AbortSignal.timeout(PLAN_DEADLINE_MS), ...(signal ? [signal] : [])]);
  let r: RawPlan;
  try {
    const [plan, extra] = await Promise.all([planCall(query, window, planAbort), enrichX(query, planAbort).catch(() => null)]);
    r = mergePlan(plan, extra);
  } catch (e) {
    log.warn("X plan failed, using built-in lanes", { error: String(e) });
    r = fallbackPlan(query);
  }
  return buildLanes(r, query, window);
}

/** Long -exclusion lists are the usual cause of X 400s; the first 12 cover the real collisions. */
function capExclusions(s: string, max = 12): string {
  let n = 0;
  return s.replace(/\s-(?:"[^"]*"|[^\s()"]+)/g, (m) => (++n > max ? "" : m)).replace(/\s+/g, " ").trim();
}

/** Cuts an over-long query back to its last complete top-level group so X does not reject it. */
function trimQuery(s: string, max = MAX_QUERY_CHARS): string {
  if (s.length <= max) return s;
  let depth = 0;
  let quoted = false;
  let cut = -1;
  for (let i = 0; i < max; i++) {
    const c = s[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "(") depth++;
    else if (!quoted && c === ")") depth--;
    if (!quoted && depth === 0 && c === " ") cut = i;
  }
  return cut > 0 ? s.slice(0, cut) : s.slice(0, max);
}

function toRaw(t: Tweet, text: string, parent?: string): RawPost {
  const handle = t.author?.userName ?? "unknown";
  const created = t.createdAt ? Date.parse(t.createdAt) / 1000 : NaN;
  return {
    id: `x_${t.id}`,
    source: "x",
    kind: t.isReply ? "reply" : "post",
    depth: 0,
    text,
    url: t.url ?? `https://x.com/${handle}/status/${t.id}`,
    thread_title: null,
    thread_url: null,
    community: null,
    ...(parent ? { parent_text: parent } : {}),
    created_utc: Number.isNaN(created) ? null : created,
    score: t.likeCount ?? 0,
    replies: t.replyCount ?? 0,
    reposts: (t.retweetCount ?? 0) + (t.quoteCount ?? 0),
    views: t.viewCount ?? 0,
    author: {
      handle,
      name: t.author?.name ?? null,
      profile_url: t.author?.url ?? `https://x.com/${handle}`,
      avatar: t.author?.profilePicture?.replace("_normal.", "_bigger.") ?? null,
      followers: t.author?.followers ?? null,
      verified: !!(t.author?.isBlueVerified || t.author?.isVerified),
    },
  };
}

/**
 * Runs every lane at once. `onPosts` fires per page with the new, kept posts so sorting starts while paging continues.
 */
export async function collectX(...args: Parameters<typeof collectXInner>): ReturnType<typeof collectXInner> {
  // Counted as a live X search for global pacing while it runs (xpace.ts).
  const release = await registerSearch(Math.random().toString(36).slice(2));
  try {
    return await collectXInner(...args);
  } finally {
    const m = meter();
    const f = m && fails.get(m);
    if (f) log.info("x failures", f);
    void release();
  }
}

async function collectXInner(
  query: string,
  window: { since?: string; until?: string; sinceEpoch: number; untilEpoch: number },
  onPosts: (posts: RawPost[]) => void,
  signal?: AbortSignal,
): Promise<{ queries: string[]; names: string[]; raw: number; kept: number; capped: boolean; lanes: Record<XLane["kind"], { raw: number; kept: number }>; laneOf: Map<string, XLane["kind"]>; laneIdx: Map<string, number>; laneStats: LaneStat[]; convos: number }> {
  // X round 7: the time budget counts from the first lane launch, not from planning; a 13s planner stall used to leave
  // the fallback lanes ~5s and 7-9 calls in total.
  let laneClock = 0;
  const elapsed = () => (laneClock ? Date.now() - laneClock : 0);
  // Names grow as plan waves arrive; a post must mention one to be kept.
  const nameSet = new Set<string>();
  const mentions = (text: string) => {
    const t = text.toLowerCase();
    for (const n of nameSet) if (t.includes(n)) return true;
    return false;
  };
  const lanes: XLane[] = [];
  const seeds: string[] = [];
  const queued = new Set<string>();
  // Until the plan's names land, posts that only miss on names are held and re-checked against the full list.
  let namesFinal = false;
  const held: { t: Tweet; text: string; li: number }[] = [];
  const m = meter();
  const seen = new Set<string>();
  const laneOf = new Map<string, XLane["kind"]>();
  // Per-query yield (eval): which lane each kept post came from, and how far each lane paged.
  const laneIdx = new Map<string, number>();
  const laneStats: LaneStat[] = [];
  let raw = 0;
  let kept = 0;
  let capped = false;
  const byKind: Record<XLane["kind"], { raw: number; kept: number }> = { opinion: { raw: 0, kept: 0 }, broad: { raw: 0, kept: 0 }, popular: { raw: 0, kept: 0 }, pick: { raw: 0, kept: 0 }, replies: { raw: 0, kept: 0 }, convo: { raw: 0, kept: 0 } };
  // A page costs up to ~20 tweets; stop starting pages once the next one could cross the cap.
  const overBudget = () => {
    if (m && m.xUsd + 20 * USD_PER_TWEET > X_MAX_USD) capped = true;
    return capped;
  };
  const inWindow = (p: RawPost) => !p.created_utc || (p.created_utc >= window.sinceEpoch && p.created_utc < window.untilEpoch);
  const dates = xDates(window);
  const queue = new PageQueue();
  const qs = (pri: number) => ({ queue, pri });

  /*
   * Conversation lane (sparse round 1): for niche subjects most answers are replies under one tweet that asks or ranks
   * ("pearX or YC?", "accelerator tier list"), and those replies rarely repeat the subject's name, so keyword lanes miss
   * them. Seed searches find tweets with replies on the subject; each reply thread is then read with conversation_id:.
   */
  const convoIds = new Set<string>();
  const readConversation = async (seed: Tweet, seedText: string) => {
    let cursor = "";
    for (let page = 0; page < CONVO_PAGES && !signal?.aborted; page++) {
      if (overBudget() || elapsed() > X_TIME_MS + 2_000) break;
      const data = await xSearch(`conversation_id:${seed.conversationId ?? seed.id} -filter:retweets${dates}`, "Latest", cursor, signal, qs(page + KIND_RANK.convo));
      const got = data?.tweets ?? [];
      raw += got.length;
      byKind.convo.raw += got.length;
      const fresh: RawPost[] = [];
      for (const t of got) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        const text = clean(t.text);
        // Replies answer the seed, so they need not repeat the subject; they still need a few words of their own.
        if (text.length < 12 || text.split(/\s+/).length < 3 || PROMO.test(text) || DEAL.test(text) || t.author?.isAutomated) continue;
        const post = toRaw({ ...t, isReply: true }, text, seedText.slice(0, 240));
        if (!inWindow(post)) continue;
        fresh.push(post);
        laneOf.set(post.id, "convo");
      }
      kept += fresh.length;
      byKind.convo.kept += fresh.length;
      if (fresh.length && !signal?.aborted) onPosts(fresh);
      if (!data?.has_next_page || !data.next_cursor || got.length < 10) break;
      cursor = data.next_cursor;
    }
  };
  const convoJobs: Promise<void>[] = [];
  const runSeed = async (sq: string) => {
    if (overBudget() || signal?.aborted) return;
    const data = await xSearch(sq, "Top", "", signal, qs(0));
    // A seed must invite answers: a question, a ranking/take, or a big reply thread.
    const invites = (t: Tweet) => {
      const s = clean(t.text);
      return /\?|\b(best|worst|overrated|underrated|tier|ranking|ranked|vs\.?|or|should i|worth it|thoughts|hot take|unpopular)\b/i.test(s) || (t.replyCount ?? 0) >= 20;
    };
    const got = (data?.tweets ?? [])
      .filter((t) => (t.replyCount ?? 0) >= CONVO_MIN_REPLIES && mentions(clean(t.text)) && invites(t) && !PROMO.test(clean(t.text)))
      .sort((a, b) => (b.replyCount ?? 0) - (a.replyCount ?? 0));
    raw += data?.tweets?.length ?? 0;
    byKind.convo.raw += data?.tweets?.length ?? 0;
    for (const t of got.slice(0, 4)) {
      const cid = t.conversationId ?? t.id;
      if (convoIds.size >= CONVO_THREADS || convoIds.has(cid)) continue;
      convoIds.add(cid);
      const text = clean(t.text);
      // The seed itself is a post too (often a ranked list or a take) when it is in the window.
      if (!seen.has(t.id)) {
        seen.add(t.id);
        const post = toRaw(t, text);
        if (inWindow(post) && text.length >= MIN_CHARS && !PROMO.test(text)) {
          laneOf.set(post.id, "convo");
          kept++;
          byKind.convo.kept++;
          onPosts([post]);
        }
      }
      convoJobs.push(readConversation(t, text));
    }
  };

  const runLane = async (lane: XLane, li: number) => {
      let cursor = "";
      const st = laneStats[li]!;
      st.stop = "pages";
      for (let page = 0; page < lane.pages && !signal?.aborted; page++) {
        if (overBudget()) { st.stop = "budget"; break; }
        if (page > 0 && elapsed() > X_TIME_MS) { st.stop = "time"; break; }
        const hot = HOT_KEPT > 0 && page > 0 && st.kept / st.pages >= HOT_KEPT;
        const data = await xSearch(lane.query, lane.type, cursor, signal, qs(hot ? -0.5 : page + KIND_RANK[lane.kind]));
        const got = data?.tweets ?? [];
        st.pages++;
        st.raw += got.length;
        raw += got.length;
        byKind[lane.kind].raw += got.length;
        const fresh: RawPost[] = [];
        let onTopic = 0;
        for (const t of got) {
          const text = clean(t.text);
          const hit = mentions(text);
          if (hit) onTopic++;
          if (seen.has(t.id)) continue;
          seen.add(t.id);
          if (text.length < MIN_CHARS || text.split(/\s+/).length < MIN_WORDS || PROMO.test(text) || DEAL.test(text) || t.author?.isAutomated) continue;
          const post = toRaw(t, text);
          if (post.created_utc && (post.created_utc < window.sinceEpoch || post.created_utc >= window.untilEpoch)) continue;
          if (!hit) {
            if (!namesFinal) held.push({ t, text, li });
            continue;
          }
          fresh.push(post);
          laneOf.set(post.id, lane.kind);
          laneIdx.set(post.id, li);
        }
        kept += fresh.length;
        st.kept += fresh.length;
        byKind[lane.kind].kept += fresh.length;
        if (fresh.length && !signal?.aborted) onPosts(fresh);
        const share = got.length ? onTopic / got.length : 0;
        if (!data?.has_next_page || !data.next_cursor || got.length < 10 || (namesFinal && share < 0.3)) {
          st.stop = !data ? "error" : got.length < 10 || !data.has_next_page ? "thin" : "offtopic";
          break;
        }
        cursor = data.next_cursor;
      }
  };

  /** Starts every lane and seed of a plan wave that an earlier wave did not already run. */
  const jobs: Promise<void>[] = [];
  const launch = (w: { names: string[]; lanes: XLane[]; seeds: string[] }, final = false) => {
    for (const n of w.names) if (n) nameSet.add(n);
    if (final && !namesFinal) {
      namesFinal = true;
      const back: RawPost[] = [];
      for (const h of held.splice(0)) {
        if (!mentions(h.text)) continue;
        const post = toRaw(h.t, h.text);
        const lane = lanes[h.li]!;
        back.push(post);
        laneOf.set(post.id, lane.kind);
        laneIdx.set(post.id, h.li);
        laneStats[h.li]!.kept++;
        byKind[lane.kind].kept++;
      }
      kept += back.length;
      if (back.length && !signal?.aborted) onPosts(back);
    }
    if (!laneClock && (w.lanes.length || w.seeds.length)) {
      laneClock = Date.now();
      queue.until = laneClock + X_TIME_MS + QUEUE_TAIL_MS;
    }
    for (const lane of w.lanes) {
      const key = `${lane.type}|${lane.query.toLowerCase()}`;
      if (queued.has(key)) continue;
      queued.add(key);
      const li = lanes.push(lane) - 1;
      laneStats.push({ query: lane.query, kind: lane.kind, type: lane.type, pages: 0, raw: 0, kept: 0, stop: "" });
      jobs.push(runLane(lane, li));
    }
    for (const sq of w.seeds) {
      const key = `seed|${sq.toLowerCase()}`;
      if (queued.has(key)) continue;
      queued.add(key);
      seeds.push(sq);
      jobs.push(runSeed(sq));
    }
  };

  /*
   * Two waves (X round 6): the enrichment call answers in ~2.7s and the plan in ~5-6s, and every lane used to wait for
   * both. Now the enrichment's answer and phrasing lanes start as soon as it lands, and the plan's lanes join when it
   * does, so the first X pages go out ~3s earlier and every lane gets more pages inside the same time budget.
   */
  const planAbort = AbortSignal.any([AbortSignal.timeout(PLAN_DEADLINE_MS), ...(signal ? [signal] : [])]);
  const waves = process.env.X_WAVES !== "0";
  const enrich = enrichX(query, planAbort).catch(() => null);
  const enrichWave = waves
    ? enrich.then((extra) => {
        if (extra && !signal?.aborted) launch(buildLanes(enrichPlan(extra), query, window, { fullOpinions: 0, fullPicks: 14, partial: true }));
      })
    : Promise.resolve();
  let planned = false;
  const planWave = planCall(query, window, planAbort)
    .then(async (plan) => {
      planned = true;
      // Without waves the plan waits for the enrichment and both run as one (the old behaviour).
      launch(buildLanes(waves ? plan : mergePlan(plan, await enrich), query, window), true);
    })
    .catch(async (e) => {
      if (signal?.aborted) return;
      log.warn("X plan failed, using built-in lanes", { error: String(e) });
      if (!planned) launch(buildLanes(mergePlan(fallbackPlan(query), waves ? null : await enrich), query, window), true);
    });
  await Promise.all([enrichWave, planWave]);
  if (!namesFinal) launch({ names: [query.toLowerCase()], lanes: [], seeds: [] }, true);
  // Lanes launched by a wave can still add lanes' jobs only through `launch`, which both waves have finished calling.
  await Promise.all(jobs);
  await Promise.all(convoJobs);
  if (capped) log.info("X spend cap reached", { usd: m?.xUsd, cap: X_MAX_USD });
  return { queries: [...lanes.map((l) => l.query), ...seeds], names: [...nameSet], raw, kept, capped, lanes: byKind, laneOf, laneIdx, laneStats, convos: convoIds.size };
}
