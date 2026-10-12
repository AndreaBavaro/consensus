import { logger } from "../lib/log.ts";
import type { ClassifiedComment, Comment, Opinion, Source, SourceCount, StreamEvent } from "../lib/types.ts";
import { env } from "../lib/env.ts";
import { streamText } from "../llm.ts";

const log = logger("classifier");
const BATCH_SIZE = 12;
/** DeepSeek through OpenRouter keeps ~5s per batch up to ~40 parallel streams; beyond that connections start dropping. */
const MAX_CONCURRENT = 40;
const MAX_COMMENTS = 900;
/** Comments the classifier rates below this relevance are not counted as votes, even if it picked a side. */
const MIN_RELEVANCE = 0.7;
const FIRST_BATCH_THRESHOLD = 5;
const OTHER = "other";

function buildPrompt(comments: Comment[], opinions: Opinion[], query: string): string {
  const opinionsText = opinions.map((o, i) => `[${i}] ${o.title}: ${o.description}`).join("\n");
  const flat = (t: string, n: number) => t.replace(/\s+/g, " ").trim().slice(0, n);
  const commentsText = comments
    .map((c, i) => {
      const isThreadStart = c.comment_url === c.post_url;
      const context = !isThreadStart && c.post_title ? ` (replying in thread: ${flat(c.post_title, 140)})` : "";
      return `[${i}]${context} ${flat(c.content, 1200)}`;
    })
    .join("\n\n");

  return `You are tallying a public opinion poll on the question: "${query}"

POLL OPTIONS:
${opinionsText}

COMMENTS:
${commentsText}

For each comment, decide which single poll option the commenter is clearly arguing for, if any.
- Pick the option only if the comment itself states or plainly implies that position. Do not infer a stance from a passing mention.
- Use the thread title to read short replies (e.g. "No" or "Absolutely" answering the thread's question), but judge the reply's own stance, not the thread's.
- Return [] when the comment is neutral, mixed, only asks a question, is a joke without a stance, is off-topic, is an ad or spam, or argues for something that is not one of the options.
- Return [] for news, product announcements, launch hype, specs lists, deals and feature updates that do not state the poster's own verdict on the question.
- Return [] when the comment is about a different product, person or topic that merely shares a word with the question.
- Return at most one option index per comment.
- ai_score is how well the comment answers the question itself: 1.0 = gives a clear verdict with a concrete reason or experience; 0.8 = clear verdict, little reason; 0.5 = related but no verdict on this question; 0.2 = about something else; 0.0 = spam.

Output one JSON object per line, one line per comment, nothing else:
{"index": 0, "supporting_indices": [2], "ai_score": 0.9}
{"index": 1, "supporting_indices": [], "ai_score": 0.3}`;
}

interface Classification {
  index: number;
  themes: string[];
  aiScore: number;
}

/** Stream one batch through the classifier model, yielding each `{index, supporting_indices, ai_score}` as it arrives. */
async function* classifyBatch(comments: Comment[], opinions: Opinion[], query: string, signal: AbortSignal): AsyncGenerator<Classification> {
  let buffer = "";
  for await (const text of streamText(buildPrompt(comments, opinions, query), { model: env.classifierModel, signal, noReasoning: true })) {
    buffer += text.replaceAll("```", "").replaceAll("json", "");
    while (true) {
      const start = buffer.indexOf("{");
      if (start === -1) break;
      const end = buffer.indexOf("}", start);
      if (end === -1) break;
      const chunk = buffer.slice(start, end + 1);
      buffer = buffer.slice(end + 1);
      try {
        const data = JSON.parse(chunk) as { index?: unknown; supporting_indices?: unknown; ai_score?: unknown };
        const index = data.index;
        const indices = data.supporting_indices;
        if (
          typeof index === "number" && Number.isInteger(index) && index >= 0 && index < comments.length &&
          Array.isArray(indices) && indices.every((i) => Number.isInteger(i) && i >= 0 && i < opinions.length)
        ) {
          yield { index, themes: (indices as number[]).slice(0, 1).map((i) => opinions[i]!.title), aiScore: Number(data.ai_score ?? 0) };
        }
      } catch {
        continue;
      }
    }
  }
}

interface OpinionStats {
  title: string;
  description: string;
  firstBatch: ClassifiedComment[];
  remaining: ClassifiedComment[];
  totalUpvotes: number;
  /** Log-damped upvotes per source, so one viral post cannot decide the poll on its own. */
  weight: Record<Source, number>;
}

const voteWeight = (score: number | undefined) => 1 + Math.log1p(Math.max(0, score ?? 0));
/** Options backed by fewer comments than this are folded into "other" rather than shown as a poll result. */
const MIN_SUPPORTING_COMMENTS = 2;
/**
 * X "Top" search favours viral takes, so X's combined weight is capped relative to Reddit's: at most 40% of the
 * poll when both sources are present.
 */
const MAX_X_TO_REDDIT_RATIO = 2 / 3;

function subredditTotals(comments: ClassifiedComment[]): SourceCount[] {
  const counts = new Map<string, number>();
  for (const c of comments) if (c.subreddit) counts.set(c.subreddit, (counts.get(c.subreddit) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }));
}

/** Most on-point comments first, upvotes as the tiebreak, so the cards show reasons rather than the loudest replies. */
const byRelevance = (a: ClassifiedComment, b: ClassifiedComment) =>
  (b.ai_score ?? 0) * voteWeight(b.score) - (a.ai_score ?? 0) * voteWeight(a.score);
const SHOWN_COMMENTS = 30;

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]!);
    if (i < b.length) out.push(b[i]!);
  }
  return out;
}

/**
 * Classify comments against the opinions with the classifier model in parallel batches. Emits `first_batch` once 5 comments map to a real
 * opinion, then one `final_opinion` per opinion with log-damped upvote-weighted percentages when every batch is done or
 * `deadline` (epoch ms) passes, whichever is first, so the stream finishes inside the hosting time limit.
 */
export async function* classifyComments(
  initial: Comment[],
  opinions: Opinion[],
  query: string,
  deadline: number,
  later: Promise<Comment[]> = Promise.resolve([]),
): AsyncGenerator<StreamEvent> {
  if (!opinions.length) return;
  const comments = [...initial];
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));

  const stats = new Map<string, OpinionStats>(
    [...opinions, { title: OTHER, description: "" }].map((o) => [
      o.title,
      { title: o.title, description: o.description, firstBatch: [], remaining: [], totalUpvotes: 0, weight: { reddit: 0, twitter: 0 } },
    ]),
  );
  let firstBatchSent = false;
  let themedCount = 0;
  const queue: StreamEvent[] = [];
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };

  const firstBatchOpinions = () =>
    [...stats.values()]
      .filter((s) => s.firstBatch.length)
      .map((s) => ({
        title: s.title,
        description: s.description,
        comments_support: [...s.firstBatch].sort(byRelevance).slice(0, 10),
        total_upvotes: s.totalUpvotes,
        subreddit_total: subredditTotals([...s.firstBatch, ...s.remaining]),
      }));

  const batches: { offset: number; items: Comment[] }[] = [];
  const addBatches = (from: number) => {
    for (let i = from; i < comments.length; i += BATCH_SIZE) batches.push({ offset: i, items: comments.slice(i, i + BATCH_SIZE) });
  };
  addBatches(0);

  let next = 0;
  const worker = async () => {
    while (next < batches.length && !controller.signal.aborted) {
      const { offset, items } = batches[next++]!;
      try {
        for await (const { index, themes: picked, aiScore } of classifyBatch(items, opinions, query, controller.signal)) {
          const themes = aiScore >= MIN_RELEVANCE ? picked : [];
          const comment: ClassifiedComment = { ...comments[offset + index]!, supporting_themes: themes, ai_score: aiScore };
          for (const theme of themes.length ? themes : [OTHER]) {
            const s = stats.get(theme);
            if (!s) continue;
            if (!firstBatchSent && theme !== OTHER) themedCount++;
            (firstBatchSent ? s.remaining : s.firstBatch).push(comment);
            s.totalUpvotes += comment.score ?? 0;
            s.weight[comment.source] += voteWeight(comment.score);
          }
          if (!firstBatchSent && themedCount >= FIRST_BATCH_THRESHOLD) {
            queue.push({ event: "first_batch", data: { opinions: firstBatchOpinions() } });
            firstBatchSent = true;
            notify();
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) log.error(`batch at ${offset} failed`, { error: String(e) });
      }
    }
  };

  let done = false;
  // Workers start on the comments already here; the ones arriving later join the same pool when they land.
  const pool = Array.from({ length: MAX_CONCURRENT }, worker);
  const all = later
    .catch(() => [] as Comment[])
    .then((more) => {
      const from = comments.length;
      comments.push(...more.slice(0, Math.max(0, MAX_COMMENTS - from)));
      addBatches(from);
      return Promise.all([...pool, ...Array.from({ length: MAX_CONCURRENT }, worker)]);
    })
    .then(() => {
      done = true;
      notify();
    });

  while (!done || queue.length) {
    if (queue.length) {
      yield queue.shift()!;
      continue;
    }
    await new Promise<void>((r) => (wake = r));
  }
  await all;
  clearTimeout(deadlineTimer);
  if (controller.signal.aborted) log.warn(`deadline hit, finalizing with ${next}/${batches.length} batches started`);

  const dedupe = (s: OpinionStats) => {
    const seen = new Set<string>();
    return [...s.firstBatch, ...s.remaining].filter((c) => !seen.has(c.comment_url) && !!seen.add(c.comment_url));
  };
  const other = stats.get(OTHER)!;
  const real = [...stats.values()].filter((s) => {
    if (s.title === OTHER) return false;
    if (dedupe(s).length >= MIN_SUPPORTING_COMMENTS) return true;
    other.remaining.push(...dedupe(s));
    other.totalUpvotes += s.totalUpvotes;
    return false;
  });
  const redditWeight = real.reduce((sum, s) => sum + s.weight.reddit, 0);
  const xWeight = real.reduce((sum, s) => sum + s.weight.twitter, 0);
  const xScale = redditWeight > 0 && xWeight > redditWeight * MAX_X_TO_REDDIT_RATIO ? (redditWeight * MAX_X_TO_REDDIT_RATIO) / xWeight : 1;
  const weightOf = (s: OpinionStats) => s.weight.reddit + s.weight.twitter * xScale;
  const totalWeight = real.reduce((sum, s) => sum + weightOf(s), 0);
  const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
  for (const s of [...real].sort((a, b) => weightOf(b) - weightOf(a)).concat(other)) {
    const merged = dedupe(s);
    if (!merged.length) continue;
    yield {
      event: "final_opinion",
      data: {
        title: s.title,
        description: s.description,
        comments_support: interleave(
          merged.filter((c) => c.source === "reddit").sort(byRelevance),
          merged.filter((c) => c.source === "twitter").sort(byRelevance),
        ).slice(0, SHOWN_COMMENTS),
        total_upvotes: s.totalUpvotes,
        subreddit_total: subredditTotals(merged),
        ...(s.title !== OTHER && totalWeight > 0
          ? {
              percentage: share(weightOf(s), totalWeight),
              by_source: {
                reddit: { comments: merged.filter((c) => c.source === "reddit").length, percentage: share(s.weight.reddit, redditWeight) },
                twitter: { comments: merged.filter((c) => c.source === "twitter").length, percentage: share(s.weight.twitter, xWeight) },
              },
            }
          : {}),
      },
    };
  }
}
