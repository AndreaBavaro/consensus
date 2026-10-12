import { env } from "../../lib/env.ts";
import { logger } from "../../lib/log.ts";
import { isoFromEpoch, type Comment, type SearchResult } from "../../lib/types.ts";
import { fetchPostListing } from "./client.ts";

const log = logger("reddit");
const MAX_COMMENTS_PER_POST = 100;

interface RedditThing {
  kind: string;
  data: {
    title?: string;
    selftext?: string;
    body?: string;
    score?: number;
    author?: string;
    permalink?: string;
    created_utc?: number;
    subreddit?: string;
  };
}
type Listing = { data: { children: RedditThing[] } };

export function extractPostId(url: string): string | null {
  return url.match(/reddit\.com\/r\/\w+\/comments\/(\w+)/)?.[1] ?? url.match(/redd\.it\/(\w+)/)?.[1] ?? null;
}

function subredditOf(url: string): string | null {
  const name = url.split("/r/")[1]?.split("/")[0];
  return name ? `r/${name}` : null;
}

async function serpSearch(engine: "google" | "google_light", q: string, num: number, fresh = false): Promise<SearchResult[]> {
  const params = new URLSearchParams({ engine, q, num: String(num), api_key: env.serpApiKey, ...(fresh ? { no_cache: "true" } : {}) });
  try {
    const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(12_000) });
    const data = (await res.json()) as { organic_results?: { title?: string; link?: string }[]; error?: string };
    if (data.error) log.warn(`SerpAPI ${engine} error: ${data.error}`);
    const seen = new Set<string>();
    return (data.organic_results ?? [])
      .filter((r) => r.link && extractPostId(r.link) && !seen.has(r.link) && seen.add(r.link))
      .map((r) => ({ title: r.title ?? "", link: r.link!, subreddit: subredditOf(r.link!) }));
  } catch (e) {
    log.error(`SerpAPI ${engine} search failed`, { error: String(e) });
    return [];
  }
}

/**
 * Google search via SerpAPI for Reddit threads. `site:` narrows Google too far, so the query just mentions reddit.
 * The full engine ranks far better than google_light, which is only a fallback when it returns too little.
 */
/**
 * Google occasionally reads "<question> reddit" as a search about Reddit itself (homepage, app pages), and SerpAPI
 * then serves that page from its cache for an hour; a fresh, uncached search of the same query recovers it.
 */
export async function searchReddit(query: string, num = 20): Promise<SearchResult[]> {
  const q = `${query} reddit`;
  const results = await serpSearch("google", q, num);
  if (results.length >= 3) return results;
  const fresh = await serpSearch("google", q, num, true);
  return fresh.length >= 3 ? fresh : serpSearch("google_light", q, num);
}

const author = (a?: string) => (a && a !== "[deleted]" ? a : "[deleted]");

function parseListing(raw: unknown, url: string, position: number): Comment[] {
  const [postListing, commentListing] = raw as [Listing, Listing];
  const post = postListing?.data?.children?.[0]?.data;
  if (!post) return [];

  const subreddit = subredditOf(url);
  const base = {
    post_title: post.title ?? "",
    post_url: url,
    post_position: position,
    post_created_utc: post.created_utc ?? null,
    subreddit,
    source: "reddit" as const,
  };

  const postComment: Comment = {
    ...base,
    content: `${post.title ?? ""}\n ${post.selftext ?? ""}`,
    score: post.score ?? 0,
    upvotes: post.score ?? 0,
    author: author(post.author),
    comment_url: url,
    created_utc: post.created_utc ?? null,
    created_at: isoFromEpoch(post.created_utc),
  };

  const comments = (commentListing?.data?.children ?? [])
    .filter((c) => c.kind === "t1" && c.data.body && !["[deleted]", "[removed]"].includes(c.data.body))
    .sort((a, b) => (b.data.score ?? 0) - (a.data.score ?? 0))
    .slice(0, MAX_COMMENTS_PER_POST)
    .map<Comment>((c) => ({
      ...base,
      content: c.data.body!,
      score: c.data.score ?? 0,
      upvotes: c.data.score ?? 0,
      author: author(c.data.author),
      comment_url: `https://www.reddit.com${c.data.permalink}`,
      created_utc: c.data.created_utc ?? null,
      created_at: isoFromEpoch(c.data.created_utc),
    }));

  return [postComment, ...comments];
}

/** Fetch every post in parallel; returns post bodies first, then comments, like the original service. */
export async function getRedditComments(results: SearchResult[]): Promise<Comment[]> {
  const start = Date.now();
  const listings = await Promise.all(
    results.map(async (r, i) => {
      const id = extractPostId(r.link);
      const raw = id ? await fetchPostListing(id) : null;
      return raw ? parseListing(raw, r.link, i) : [];
    }),
  );
  const posts = listings.flatMap((l) => l.slice(0, 1));
  const comments = listings.flatMap((l) => l.slice(1));
  log.info(`fetched ${listings.filter((l) => l.length).length}/${results.length} posts, ${comments.length} comments in ${Date.now() - start}ms`);
  return [...posts, ...comments];
}
