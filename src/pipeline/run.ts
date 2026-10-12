import { logger } from "../lib/log.ts";
import type { Comment, Source, SourceStats, StreamEvent } from "../lib/types.ts";
import { getRedditComments, searchReddit } from "../sources/reddit/index.ts";
import { getTwitterReplies, normalizeTwitterScores, searchTwitter } from "../sources/twitter.ts";
import { classifyComments } from "./classifier.ts";
import { generateBatchInsights } from "./insights.ts";
import { generateOpinions } from "./opinions.ts";

const log = logger("pipeline");
const INSIGHT_COMMENTS = 200;
const OPINION_COMMENTS = 100;
/** Netlify streams are cut at 60s; finalize opinions before that. */
const CLASSIFY_DEADLINE_MS = 50_000;

export const ALL_SOURCES: Source[] = ["reddit", "twitter"];

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]!);
    if (i < b.length) out.push(b[i]!);
  }
  return out;
}

/** Drain several async generators concurrently, yielding values in arrival order. */
async function* merge<T>(...gens: AsyncGenerator<T>[]): AsyncGenerator<T> {
  const next = (g: AsyncGenerator<T>, i: number) => g.next().then((r) => ({ r, i }));
  const pending = new Map(gens.map((g, i) => [i, next(g, i)]));
  while (pending.size) {
    const { r, i } = await Promise.race(pending.values());
    if (r.done) pending.delete(i);
    else {
      pending.set(i, next(gens[i]!, i));
      yield r.value;
    }
  }
}

async function* insightEvents(comments: Comment[], query: string): AsyncGenerator<StreamEvent> {
  for await (const batch of generateBatchInsights(comments.slice(0, INSIGHT_COMMENTS), query)) {
    yield { event: "insights_batch", data: batch };
  }
}

async function* opinionEvents(
  early: Comment[],
  later: Promise<Comment[]>,
  query: string,
  deadline: number,
): AsyncGenerator<StreamEvent> {
  const start = Date.now();
  const opinions = await generateOpinions(early.slice(0, OPINION_COMMENTS), query);
  log.info(`${opinions.length} opinions in ${Date.now() - start}ms`);
  if (!opinions.length) {
    yield { event: "error", data: { message: "We found discussions but couldn't analyze them right now. Please try again in a minute." } };
    return;
  }
  // Reddit thread openers are mostly the question itself, not a vote on it.
  const votes = early.filter((c) => !(c.source === "reddit" && c.comment_url === c.post_url));
  yield* classifyComments(votes, opinions, query, deadline, later);
}

/**
 * Reddit and X are fetched concurrently. Opinions and insights start as soon as Reddit comments and X posts are in;
 * X replies keep loading meanwhile and join the classification.
 */
export async function* runConsensus(query: string, sources: Source[] = ALL_SOURCES): AsyncGenerator<StreamEvent> {
  const start = Date.now();
  const twitterTask = sources.includes("twitter")
    ? searchTwitter(query).catch((e) => {
        log.error("twitter failed", { error: String(e) });
        return null;
      })
    : Promise.resolve(null);

  let redditComments: Comment[] = [];
  if (sources.includes("reddit")) {
    const results = await searchReddit(query);
    yield { event: "search_results", data: results };
    redditComments = await getRedditComments(results);
  }

  const twitter = await twitterTask;
  const tweets = twitter?.comments ?? [];
  if (twitter) yield { event: "twitter_results", data: { search_queries: twitter.searchQueries, threads: twitter.threads } };
  const replies = twitter ? getTwitterReplies(twitter).catch(() => [] as Comment[]) : Promise.resolve([] as Comment[]);

  normalizeTwitterScores(redditComments, tweets);
  const early = interleave(redditComments, tweets);
  log.info(`${early.length} comments (${redditComments.length} reddit, ${tweets.length} x posts) after ${Date.now() - start}ms`);
  if (!early.length) {
    yield { event: "error", data: { message: "No discussions found for this question. Try rephrasing it." } };
    return;
  }

  let stats: SourceStats | null = null;
  const all = replies.then((r) => {
    const twitterAll = [...tweets, ...r];
    normalizeTwitterScores(redditComments, twitterAll);
    log.info(`+${r.length} x replies after ${Date.now() - start}ms`);
    stats = {
      reddit: { threads: new Set(redditComments.map((c) => c.post_url)).size, comments: redditComments.length },
      twitter: { posts: tweets.length, replies: r.length, queries: twitter?.searchQueries ?? [] },
    };
    return r;
  });
  async function* statsEvent(): AsyncGenerator<StreamEvent> {
    await all;
    yield { event: "source_stats", data: stats };
  }
  yield* merge(statsEvent(), insightEvents(early, query), opinionEvents(early, all, query, start + CLASSIFY_DEADLINE_MS));
  log.info(`done in ${Date.now() - start}ms`);
}
