import { logger } from "../lib/log.ts";
import { meter } from "../lib/meter.ts";
import { completeJson } from "../llm.ts";
import { fetchPostListing, fetchRedditPath } from "../sources/reddit/client.ts";
import { extractPostId } from "../sources/reddit/index.ts";
import { googleSearch, type OrganicResult } from "../sources/serper.ts";
import { Semaphore, within } from "./limit.ts";
import type { Author, RawPost } from "./types.ts";

/*
 * Reddit pool = backtest track R5 (round A winner, kept through rounds B and C):
 * 10 LLM-written Google searches (6 thread-title rewordings + 4 wider) + the raw question, all through Serper at once,
 * threads merged in rank order, top 40 fetched (one retry for failures) with their full comment trees, items under 15 chars dropped,
 * date window enforced per comment, AutoModerator removed. The keep/drop filter and sorting happen downstream in one pass.
 * Round C showed cutting depth (R8/R9) loses 20-25% of stance items, so the full tree is kept.
 */
const log = logger("v3-reddit");
export const MAX_THREADS = Number(process.env.R_THREADS ?? 40);
const MIN_CHARS = 15;
/** Failed threads are retried only if the first attempt ended this soon after collection began. */
const RETRY_BEFORE_MS = 14_000;
/** Thread downloads in flight per function instance, so concurrent searches do not exhaust the proxy pool. */
const gate = new Semaphore(Number(process.env.R_FETCH_CONCURRENCY ?? 90));
/** Threads from the raw-question search that start downloading before the reworded searches are back. */
const EARLY_THREADS = 4;

const SCHEMA = {
  type: "object",
  properties: {
    queries: { type: "array", items: { type: "string" } },
    subreddits: { type: "array", items: { type: "string" } },
    core: { type: "string" },
  },
  required: ["queries", "subreddits", "core"],
};

export interface RedditPlan {
  queries: string[];
  /** `site:reddit.com/r/<sub>` searches for the communities most likely to answer. */
  siteQueries: string[];
}

/*
 * Sparse round 1: the old template ("<question> regret", "anyone use <question>") only fit products and returned
 * how-to threads for niche subjects (VCs, accelerators, local spots). The planner now writes searches the way the
 * people who answer this question title threads, searches each named subject on its own (with its aliases), keeps
 * the place in every query, and names the subreddits that answer it, which become site: searches.
 */
export async function planRedditSearches(query: string, signal?: AbortSignal): Promise<RedditPlan> {
  const prompt = `We build a public-opinion poll from Reddit threads on: "${query}"
Write Google searches that find Reddit threads where MANY people give their own answer to this exact question (picks, verdicts, first-hand experience), not how-to or news threads.

queries: 12 searches.
- 5 phrased the way Redditors title threads asking this exact question, in the words the people who answer it use (founders: "PearX or YC?", "Is a16z speedrun worth it?"; locals: "best ramen in SF?", "favorite burrito spot in the Mission"; buyers: "Hubspot worth it for small business?").
- For comparisons and named subjects: each subject ALONE with an experience or verdict word ("PearX experience", "Y Combinator worth it founders", "Andreessen Horowitz reputation founders"), and their full names/aliases (a16z = Andreessen Horowitz, YC = Y Combinator, PearX = Pear VC, SF = San Francisco).
- For "best X" questions: recommendation and ranking threads ("best VC firms ranked", "favorite thai restaurant san francisco", "underrated ramen sf", "where to get boba san jose").
- If the question names a place, EVERY search includes that place (or its common short name). Never drop the place.
- The examples above only show the STYLE. Never put a subject from the examples into a search unless "${query}" itself names it. Every search must be about "${query}" and nothing else (for "best vc for b2b saas": "best VCs for B2B SaaS", "Bessemer vs Insight Partners for SaaS", "favorite SaaS investor", "which VC is best for enterprise software").
- For "best X" questions, also name 3 or 4 of the most common real answers, each in its own search with the question's context ("Bessemer SaaS investor experience").
- No operators, no "site:", no word "reddit". If the question is not in English, write them in its language.
subreddits: the 3 to 5 subreddits (names only, no r/) where people most often answer this question (e.g. startups, ycombinator, venturecapital, Entrepreneur; sanfrancisco, AskSF, bayarea, SFFood; running, RunningShoeGeeks; CRM, smallbusiness).
core: the shortest search phrase for the subject itself, 1 to 5 words, with the place if any (e.g. "pearx yc", "thai food sf", "a16z speedrun").
Return {"queries":[...],"subreddits":[...],"core":"..."}.`;
  try {
    const r = await completeJson<{ queries?: unknown[]; subreddits?: unknown[]; core?: unknown }>(prompt, SCHEMA, { maxTokens: 900, timeoutMs: 9_000, signal }, 1);
    const strs = (a?: unknown[]) => (a ?? []).filter((q): q is string => typeof q === "string" && !!q.trim()).map((q) => q.trim());
    const queries = strs(r.queries).slice(0, 12);
    const core = typeof r.core === "string" && r.core.trim() ? r.core.trim() : query;
    const subs = strs(r.subreddits)
      .map((s) => s.replace(/^\/?r\//i, "").replace(/[^A-Za-z0-9_]/g, ""))
      .filter((s) => s.length >= 2)
      .slice(0, 4);
    return { queries, siteQueries: subs.map((s) => `${core} site:reddit.com/r/${s}`) };
  } catch (e) {
    log.warn("search plan failed, raw question only", { error: String(e) });
    return { queries: [], siteQueries: [] };
  }
}

const FILTER_SCHEMA = { type: "object", properties: { keep: { type: "array", items: { type: "integer" } } }, required: ["keep"] };
const FILTER_MS = Number(process.env.R_FILTER_MS ?? 4_000);

/**
 * One fast call over the found thread titles: which threads will hold people's own answers to this question
 * (right subject, right place). Returns the kept hits best-first, or null when the call does not finish in time.
 */
export async function filterThreads(query: string, hits: ThreadHit[], signal?: AbortSignal): Promise<ThreadHit[] | null> {
  if (hits.length <= 8) return null;
  const list = hits
    .slice(0, 140)
    .map((h, i) => `[${i}] ${h.url.match(/reddit\.com\/r\/(\w+)/i)?.[1] ? `r/${h.url.match(/reddit\.com\/r\/(\w+)/i)![1]} | ` : ""}${h.title.slice(0, 110)}${h.snippet ? ` | ${h.snippet.replace(/\s+/g, " ").slice(0, 90)}` : ""}`)
    .join("\n");
  const prompt = `Poll question: "${query}"
Reddit threads found by search:
${list}

Return the indices of threads where commenters are likely to give their OWN answer to this question (their pick, verdict or experience), best first.
Leave out: threads about a different place than the one asked (another city or region), a different subject that only shares words, job postings, news, how-to/fundraising-tactics threads with no opinions on the subject, and self-promotion.
Keep general threads in the right place or subject that invite recommendations or opinions (e.g. "SF food recommendations?" for a best thai in SF question, "rank the top VCs" for a best VC question).
Return {"keep":[...]}.`;
  try {
    const r = await completeJson<{ keep?: unknown[] }>(prompt, FILTER_SCHEMA, { maxTokens: 500, timeoutMs: FILTER_MS, signal }, 0);
    const keep = [...new Set((r.keep ?? []).filter((i): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < hits.length))];
    return keep.length ? keep.map((i) => hits[i]!) : null;
  } catch (e) {
    if (!signal?.aborted) log.warn("thread filter failed, using search order", { error: String(e).slice(0, 160) });
    return null;
  }
}

export interface ThreadHit {
  id: string;
  title: string;
  url: string;
  snippet?: string;
}

export async function searchThreads(q: string, window: { since?: string; until?: string }, signal?: AbortSignal): Promise<ThreadHit[]> {
  const results = await googleSearch(q.includes("site:") ? q : `${q} reddit`, { num: 20, ...window, signal });
  const out: ThreadHit[] = [];
  for (const r of results as OrganicResult[]) {
    const id = extractPostId(r.link);
    if (id && !out.some((t) => t.id === id)) out.push({ id, title: r.title.replace(/\s*[-:|]\s*r\/\w+.*$/i, "").replace(/\s*:\s*\w+\s*-\s*Reddit$/i, ""), url: r.link, snippet: r.snippet });
  }
  return out;
}

/** Rank-order merge: rank 1 of every search, then rank 2, ... deduped. */
export function mergeRanked(lists: ThreadHit[][]): ThreadHit[] {
  const seen = new Set<string>();
  const out: ThreadHit[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let rank = 0; rank < longest; rank++)
    for (const l of lists) {
      const hit = l[rank];
      if (hit && !seen.has(hit.id)) {
        seen.add(hit.id);
        out.push(hit);
      }
    }
  return out;
}

type Thing = { kind: string; data: any };
const redditAuthor = (name: string | undefined): Author => {
  const handle = name && name !== "[deleted]" ? name : "[deleted]";
  return { handle, name: null, profile_url: handle === "[deleted]" ? null : `https://www.reddit.com/user/${handle}`, avatar: null, followers: null };
};

export interface FetchedThread {
  id: string;
  title: string;
  url: string;
  community: string | null;
  numComments: number;
  posts: RawPost[];
}

/** One thread with its whole comment tree (Reddit nests replies in the same response), tagged with depth. */
export async function fetchThread(id: string, window: { sinceEpoch: number; untilEpoch: number }): Promise<FetchedThread | null> {
  const m = meter();
  if (m) m.redditFetches++;
  const raw = (await fetchPostListing(id)) as [any, any] | null;
  const post = raw?.[0]?.data?.children?.[0]?.data;
  if (!post) {
    if (m) m.redditFailed++;
    return null;
  }
  const url = `https://www.reddit.com${post.permalink ?? `/comments/${id}`}`;
  const title: string = post.title ?? "";
  const community = post.subreddit ? `r/${post.subreddit}` : null;
  const posts: RawPost[] = [];
  const inWindow = (t: number | null) => !t || (t >= window.sinceEpoch && t < window.untilEpoch);
  const push = (p: RawPost) => {
    if (p.author.handle === "AutoModerator" || p.text.trim().length < MIN_CHARS || !inWindow(p.created_utc)) return;
    posts.push(p);
  };
  push({
    id: `t3_${post.id ?? id}`,
    source: "reddit",
    kind: "opener",
    depth: -1,
    text: `${title}\n${post.selftext ?? ""}`.trim(),
    url,
    thread_title: title,
    thread_url: url,
    community,
    created_utc: post.created_utc ?? null,
    score: post.score ?? 0,
    replies: post.num_comments ?? 0,
    author: redditAuthor(post.author),
  });
  const walk = (children: Thing[] | undefined, depth: number, parent: string | undefined) => {
    for (const c of children ?? []) {
      if (c.kind !== "t1") continue;
      const body = c.data.body as string | undefined;
      const kids: Thing[] = c.data.replies && typeof c.data.replies === "object" ? (c.data.replies.data?.children ?? []) : [];
      const live = body && body !== "[deleted]" && body !== "[removed]";
      if (live)
        push({
          id: `t1_${c.data.id}`,
          source: "reddit",
          kind: "comment",
          depth,
          text: body,
          url: c.data.permalink ? `https://www.reddit.com${c.data.permalink}` : url,
          thread_title: title,
          thread_url: url,
          community,
          created_utc: c.data.created_utc ?? null,
          score: c.data.score ?? 0,
          replies: kids.filter((k) => k.kind === "t1").length,
          ...(parent ? { parent_text: parent } : {}),
          author: redditAuthor(c.data.author),
        });
      if (kids.length) walk(kids, depth + 1, live ? body.slice(0, 240) : undefined);
    }
  };
  walk(raw?.[1]?.data?.children, 0, undefined);
  return { id, title, url, community, numComments: post.num_comments ?? 0, posts };
}

/**
 * Finds and downloads the Reddit pool. `onThread` fires as each thread lands so sorting can start immediately;
 * resolves with search stats once every thread is in (or failed).
 */
export async function collectReddit(
  query: string,
  window: { since?: string; until?: string; sinceEpoch: number; untilEpoch: number },
  onThread: (t: FetchedThread) => void,
  onHits: (hits: ThreadHit[]) => void,
  signal?: AbortSignal,
): Promise<{ queries: string[]; threadsFound: number; threadsFetched: number; threadsKept: number | null }> {
  const dates = { since: window.since, until: window.until };
  const began = Date.now();
  const started = new Map<string, Promise<void>>();
  let fetched = 0;
  let retried = 0;
  // Early threads download before the title check; they are held until it decides (undefined = not decided yet).
  let allowed: Set<string> | null | undefined;
  const held: FetchedThread[] = [];
  const deliver = (t: FetchedThread) => {
    if (allowed === undefined) held.push(t);
    else if (allowed === null || allowed.has(t.id)) onThread(t);
  };
  // A thread that fails (proxy drop or burst timeout) gets one more try on fresh connections while there is time.
  const once = (id: string, retry: boolean): Promise<void> =>
    fetchThread(id, window)
      .then((t) => {
        if (t && !signal?.aborted) {
          fetched++;
          deliver(t);
        } else if (!t && !retry && !signal?.aborted && Date.now() - began < RETRY_BEFORE_MS) {
          retried++;
          return once(id, true);
        }
      })
      .catch((e) => log.warn(`thread ${id} failed`, { error: String(e) }));
  const start = (id: string) => {
    if (started.has(id) || signal?.aborted) return;
    started.set(id, gate.run(() => once(id, false)));
  };

  const rawSearch = searchThreads(query, dates, signal).then((hits) => {
    hits.slice(0, EARLY_THREADS).forEach((h) => start(h.id));
    onHits(hits);
    return hits;
  });
  const plan = await planRedditSearches(query, signal);
  const queries = [...plan.queries, ...plan.siteQueries];
  const lists = await Promise.all([rawSearch, ...queries.map((q) => searchThreads(q, dates, signal).then((h) => (onHits(h), h)))]);
  const all = mergeRanked(lists);
  // Threads the title check keeps go first; if it is slow or fails, search order stands.
  const kept = process.env.R_FILTER === "0" ? null : await filterThreads(query, all, signal);
  // Threads the check saw and left out are rejected; only ones beyond what it read can fill remaining slots.
  const ordered = kept ? [...kept, ...all.slice(140)] : all;
  const merged = ordered.slice(0, MAX_THREADS);
  allowed = kept ? new Set(merged.map((h) => h.id)) : null;
  for (const t of held.splice(0)) deliver(t);
  merged.forEach((h) => start(h.id));
  await Promise.all(started.values());
  if (retried) log.info("retried failed threads", { retried });
  return { queries: [query, ...queries], threadsFound: all.length, threadsFetched: fetched, threadsKept: kept?.length ?? null };
}

/** Reddit's default Snoo for a user with no avatar, picked by a hash of the name so it never changes between searches. */
export function defaultSnoo(handle: string): string {
  let h = 0;
  for (const c of handle.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `https://www.redditstatic.com/avatars/defaults/v2/avatar_default_${h % 8}.png`;
}

/** Profiles cached across searches on this function instance (KAN-422); a profile rarely changes within hours. */
const profileCache = new Map<string, { at: number; p: Partial<Author> }>();
const PROFILE_TTL_MS = 6 * 3600_000;

/**
 * Avatar, follower count and karma for Reddit authors (KAN-422: every visible author, not just leads). Cached
 * handles answer at once; the rest are fetched under the time budget. Authors whose profile cannot be read (deleted,
 * suspended, budget ran out) get the deterministic default Snoo, so the UI never needs a letter fallback.
 */
export async function fetchRedditProfiles(handles: string[], budgetMs: number): Promise<Record<string, Partial<Author>>> {
  const gate = new Semaphore(Number(process.env.R_PROFILE_CONCURRENCY ?? 48));
  const out: Record<string, Partial<Author>> = {};
  const todo: string[] = [];
  for (const h of new Set(handles)) {
    if (!h || h === "[deleted]") continue;
    const c = profileCache.get(h);
    if (c && Date.now() - c.at < PROFILE_TTL_MS) out[h] = c.p;
    else todo.push(h);
  }
  const work = Promise.all(
    todo.map((h) =>
      gate.run(async () => {
        const raw = (await within(fetchRedditPath(`/user/${encodeURIComponent(h)}/about?raw_json=1`), budgetMs, null)) as { data?: any } | null;
        const d = raw?.data;
        if (!d) return;
        const avatar = String(d.snoovatar_img || d.icon_img || "").split("?")[0] || defaultSnoo(h);
        const p: Partial<Author> = {
          avatar,
          followers: typeof d.subreddit?.subscribers === "number" ? d.subreddit.subscribers : null,
          karma: typeof d.total_karma === "number" ? d.total_karma : (d.link_karma ?? 0) + (d.comment_karma ?? 0),
          name: d.subreddit?.title || null,
        };
        out[h] = p;
        profileCache.set(h, { at: Date.now(), p });
      }),
    ),
  );
  await within(work, budgetMs, undefined);
  // Unreadable or out-of-budget authors get the default Snoo (not cached, so a later search can fill them in).
  for (const h of todo) if (!out[h]) out[h] = { avatar: defaultSnoo(h) };
  return out;
}

/** Subreddit icon, colour and size for the communities in the poll (one call each, a few dozen at most). */
export async function fetchSubredditInfo(names: string[], budgetMs: number): Promise<Record<string, { icon: string | null; color: string | null; subscribers: number | null; url: string }>> {
  const gate = new Semaphore(40);
  const out: Record<string, { icon: string | null; color: string | null; subscribers: number | null; url: string }> = {};
  const work = Promise.all(
    names.map((n) =>
      gate.run(async () => {
        const sub = n.replace(/^r\//, "");
        const raw = (await fetchRedditPath(`/r/${encodeURIComponent(sub)}/about?raw_json=1`)) as { data?: any } | null;
        const d = raw?.data;
        if (!d) return;
        const icon = String(d.community_icon || d.icon_img || "").split("?")[0] || null;
        out[`r/${sub}`] = {
          icon,
          color: d.primary_color || d.key_color || null,
          subscribers: typeof d.subscribers === "number" ? d.subscribers : null,
          url: `https://www.reddit.com/r/${sub}/`,
        };
      }),
    ),
  );
  await within(work, budgetMs, undefined);
  return out;
}
