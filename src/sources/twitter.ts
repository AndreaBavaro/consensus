import { env } from "../lib/env.ts";
import { logger } from "../lib/log.ts";
import { isoFromEpoch, type Comment } from "../lib/types.ts";
import { completeJson } from "../llm.ts";

const log = logger("twitter");

const BASE_URL = "https://api.twitterapi.io/twitter";
export const BASE_FILTERS = "lang:en -filter:retweets";
const MAX_THREADS = 20;
const REPLIES_PER_THREAD = 30;
/** Hard cap on posts kept from search, ranked by engagement, so classification stays inside the stream deadline. */
const MAX_POSTS = 400;
/** TwitterAPI.io answers most calls in ~2s but ~1 in 10 takes 8-13s; a duplicate is fired after this and the first wins. */
const HEDGE_AFTER_MS = 2_500;
const CALL_DEADLINE_MS = 7_000;
const MIN_TEXT_LENGTH = 25;
export const PROMO = /giveaway|enter to win|to win:|use (my )?code|promo code|discount|\d+% off|affiliate|#ad\b|#sponsored|sponsored|link in bio|shop now|buy now|deal alert|price drop|on sale/i;

interface Tweet {
  id: string;
  text?: string;
  url?: string;
  createdAt?: string;
  likeCount?: number;
  replyCount?: number;
  isReply?: boolean;
  author?: { userName?: string };
}

export interface TwitterThread {
  title: string;
  link: string | undefined;
  subreddit: "X";
  source: "twitter";
  likes: number;
  replies: number;
}

export interface TwitterSearch {
  searchQueries: string[];
  threads: TwitterThread[];
  /** Matching posts found by search, as comments. */
  comments: Comment[];
  /** The busiest original posts, whose replies are worth fetching. */
  replyThreads: Tweet[];
  /** Position of each reply thread in `threads`, for comment links. */
  positions: Map<string, number>;
}

interface Plan {
  /** One list of names per side; a single list for non-comparison questions. */
  subjects: string[][];
  opinionWords: string[];
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    subjects: { type: "array", items: { type: "array", items: { type: "string" } } },
    opinion_words: { type: "array", items: { type: "string" } },
  },
  required: ["subjects", "opinion_words"],
};

export const clean = (text = "") =>
  text
    .replace(/^(?:@\w+\s*)+/, "")
    .replace(/https?:\/\/t\.co\/\w+/g, "")
    .trim();

const epoch = (createdAt?: string) => {
  const ms = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isNaN(ms) ? null : ms / 1000;
};

const term = (t: string) => (/\s/.test(t) ? `"${t}"` : t);
const anyOf = (terms: string[]) => (terms.length === 1 ? term(terms[0]!) : `(${terms.map(term).join(" OR ")})`);

async function fetchJson<T>(path: string, params: Record<string, string>, signal: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE_URL}/${path}?${new URLSearchParams(params)}`, { headers: { "X-API-Key": env.twitterKey! }, signal });
  if (!res.ok) throw new Error(`TwitterAPI.io ${res.status}`);
  return res.json() as Promise<T>;
}

/** Hedged GET: a second identical request starts if the first is slow, and whichever succeeds first is used. */
async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(CALL_DEADLINE_MS)]);
  const first = fetchJson<T>(path, params, signal);
  const hedge = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => fetchJson<T>(path, params, signal).then(resolve, reject), HEDGE_AFTER_MS);
    first.then(() => clearTimeout(timer), () => {});
  });
  try {
    return await Promise.any([first, hedge]);
  } finally {
    controller.abort();
  }
}

/**
 * X search is keyword matching, not semantic search: every word must appear in the post. The plan is the subject's
 * names (OR-ed) and the words people use when they give a verdict, which are combined into operator queries.
 */
export async function buildPlan(query: string): Promise<Plan> {
  const prompt = `We will grep X (Twitter) for posts where people give their opinion on: "${query}"

X search matches keywords literally, so return:
- subjects: the names people actually type for the subject, as lowercase keywords. One list per side for comparisons ("iphone vs android" -> [["iphone","iphones"],["android","pixel","galaxy"]]), otherwise one list ("is a standing desk worth it" -> [["standing desk","standing desks","sit stand desk"]]). 2 to 5 names per list, include plurals, common short forms and spellings. Use multi-word phrases when one word alone would match unrelated posts (e.g. "standing desk", not "desk"). Never generic words like best, good, life, thing.
- opinion_words: 12 to 16 single lowercase words or short phrases that appear in tweets giving a verdict or experience on THIS question, balanced across sides. E.g. worth, regret, overrated, underrated, love, hate, switched, recommend, "never again", "game changer", "waste of money", better, worse, honestly.`;
  try {
    const r = await completeJson<{ subjects?: unknown; opinion_words?: unknown }>(prompt, PLAN_SCHEMA, { maxTokens: 400 });
    const strings = (v: unknown) =>
      (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().toLowerCase().replace(/"/g, ""));
    const subjects = (Array.isArray(r.subjects) ? r.subjects : []).map(strings).filter((l) => l.length).slice(0, 3);
    const opinionWords = [...new Set(strings(r.opinion_words))].slice(0, 16);
    if (subjects.length) return { subjects, opinionWords };
  } catch (e) {
    log.warn("search plan failed, using raw query", { error: String(e) });
  }
  return { subjects: [[query.toLowerCase().replace(/[?"]/g, "")]], opinionWords: [] };
}

interface Lane {
  query: string;
  type: "Top" | "Latest";
  pages: number;
}

/** Operator queries per side: verdict words in two halves, popular takes, discussion threads, and recent posts. */
export function buildLanes({ subjects, opinionWords }: Plan): Lane[] {
  const half = Math.ceil(opinionWords.length / 2);
  const wordGroups = opinionWords.length ? [opinionWords.slice(0, half), opinionWords.slice(half)].filter((g) => g.length) : [];
  const lanes: Lane[] = [];
  for (const names of subjects) {
    const s = anyOf(names);
    for (const words of wordGroups) lanes.push({ query: `${s} ${anyOf(words)} ${BASE_FILTERS} min_faves:5`, type: "Top", pages: 3 });
    lanes.push({ query: `${s} ${BASE_FILTERS} min_faves:50`, type: "Top", pages: 3 });
    lanes.push({ query: `${s} ${BASE_FILTERS} -filter:replies min_replies:15`, type: "Top", pages: 2 });
    if (wordGroups.length) lanes.push({ query: `${s} ${anyOf(opinionWords)} ${BASE_FILTERS} min_faves:5`, type: "Latest", pages: 2 });
  }
  if (subjects.length > 1) {
    lanes.push({ query: `${subjects.map(anyOf).join(" ")} ${BASE_FILTERS} min_faves:5`, type: "Top", pages: 3 });
  }
  return lanes;
}

async function searchLane(lane: Lane): Promise<Tweet[]> {
  const out: Tweet[] = [];
  let cursor = "";
  for (let page = 0; page < lane.pages; page++) {
    try {
      const data = await get<{ tweets?: Tweet[]; has_next_page?: boolean; next_cursor?: string }>("tweet/advanced_search", {
        query: lane.query,
        queryType: lane.type,
        cursor,
      });
      out.push(...(data.tweets ?? []));
      if (!data.has_next_page || !data.next_cursor) break;
      cursor = data.next_cursor;
    } catch (e) {
      log.error(`search failed for ${lane.query}`, { error: String(e) });
      break;
    }
  }
  return out;
}

async function getReplies(tweetId: string): Promise<Tweet[]> {
  try {
    const data = await get<{ tweets?: Tweet[] }>("tweet/replies/v2", { tweetId, queryType: "Relevance" });
    return (data.tweets ?? []).filter((t) => t.id !== tweetId);
  } catch (e) {
    log.error(`replies failed for ${tweetId}`, { error: String(e) });
    return [];
  }
}

export function toComment(tweet: Tweet, thread: Tweet, position: number): Comment {
  const author = tweet.author?.userName ?? "[unknown]";
  const created = epoch(tweet.createdAt);
  const likes = tweet.likeCount ?? 0;
  return {
    content: clean(tweet.text),
    score: likes,
    upvotes: likes,
    likes,
    author,
    comment_url: tweet.url ?? `https://x.com/${author}/status/${tweet.id}`,
    created_utc: created,
    created_at: isoFromEpoch(created),
    post_title: clean(thread.text).slice(0, 120),
    post_url: thread.url ?? "",
    post_position: position,
    post_created_utc: epoch(thread.createdAt),
    subreddit: "X",
    source: "twitter",
  };
}

const engagement = (t: Tweet) => (t.likeCount ?? 0) + 3 * (t.replyCount ?? 0);

/** Search X with keyword/operator queries and keep posts that actually mention the subject. */
export async function searchTwitter(query: string): Promise<TwitterSearch | null> {
  if (!env.twitterKey) return null;

  const start = Date.now();
  const plan = await buildPlan(query);
  const lanes = buildLanes(plan);
  const results = await Promise.all(lanes.map(searchLane));
  const raw = results.flat();

  const names = plan.subjects.flat();
  const seen = new Set<string>();
  const tweets = raw
    .filter((t) => {
      const text = clean(t.text);
      const lower = text.toLowerCase();
      if (seen.has(t.id) || text.length < MIN_TEXT_LENGTH || PROMO.test(text)) return false;
      if (!names.some((n) => lower.includes(n))) return false;
      seen.add(t.id);
      return true;
    })
    .sort((a, b) => engagement(b) - engagement(a))
    .slice(0, MAX_POSTS);

  const replyThreads = tweets
    .filter((t) => !t.isReply && (t.replyCount ?? 0) >= 5)
    .sort((a, b) => (b.replyCount ?? 0) - (a.replyCount ?? 0))
    .slice(0, MAX_THREADS);
  log.info(`${tweets.length} posts kept of ${raw.length} matched across ${lanes.length} queries in ${Date.now() - start}ms`, {
    perQuery: results.map((r, i) => `${r.length} ${lanes[i]!.type}: ${lanes[i]!.query}`),
  });
  return {
    searchQueries: lanes.map((l) => l.query.replace(` ${BASE_FILTERS}`, "")),
    threads: tweets.map((t) => ({
      title: clean(t.text).slice(0, 120),
      link: t.url,
      subreddit: "X",
      source: "twitter",
      likes: t.likeCount ?? 0,
      replies: t.replyCount ?? 0,
    })),
    comments: tweets.map((t, i) => toComment(t, t, i)),
    replyThreads,
    positions: new Map(tweets.map((t, i) => [t.id, i])),
  };
}

/** Top replies from the busiest threads; the classifier sorts out replies without a stance. */
export async function getTwitterReplies(search: TwitterSearch): Promise<Comment[]> {
  const start = Date.now();
  const lists = await Promise.all(search.replyThreads.map((t) => getReplies(t.id)));
  const comments = search.replyThreads.flatMap((thread, i) =>
    (lists[i] ?? [])
      .filter((r) => clean(r.text).length >= MIN_TEXT_LENGTH && !PROMO.test(r.text ?? ""))
      .slice(0, REPLIES_PER_THREAD)
      .map((reply) => toComment(reply, thread, search.positions.get(thread.id) ?? 0)),
  );
  log.info(`${comments.length} replies from ${search.replyThreads.length} threads in ${Date.now() - start}ms`);
  return comments;
}

/** Rescale X likes to the Reddit upvote median so neither platform dominates the poll by raw vote counts alone. */
export function normalizeTwitterScores(reddit: Comment[], twitter: Comment[]): void {
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const r = median(reddit.map((c) => c.score).filter((s) => s > 0));
  const t = median(twitter.map((c) => c.likes ?? 0).filter((s) => s > 0));
  if (!r || !t) return;
  const factor = r / t;
  for (const c of twitter) c.score = c.upvotes = Math.max(1, Math.round((c.likes ?? 0) * factor));
}
