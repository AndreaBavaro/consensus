import { logger } from "../lib/log.ts";
import type { Comment, Insight } from "../lib/types.ts";

export type { Insight };
import { completeJson } from "../llm.ts";
import { formatCommentsForPrompt, relativeTime } from "./format.ts";

const log = logger("insights");
const BATCH_SIZE = 70;
const MAX_INSIGHTS_PER_BATCH = 6;

const SCHEMA = {
  type: "object",
  properties: {
    consensus_insights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          insight_phrase: { type: "string" },
          comment_indices: { type: "array", items: { type: "integer" } },
          sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
        },
        required: ["insight_phrase", "comment_indices", "sentiment"],
      },
    },
  },
  required: ["consensus_insights"],
};


function temporalContext(comments: Comment[]): string | null {
  const timestamps = comments.flatMap((c) => [c.created_utc, c.post_created_utc]).filter((t): t is number => !!t);
  return timestamps.length ? relativeTime(Math.max(...timestamps)) : null;
}

async function generateInsights(comments: Comment[], query: string): Promise<Insight[]> {
  if (!comments.length) return [];
  const commentsText = formatCommentsForPrompt(comments, true);

  const prompt = `You pull the most useful first-hand insights out of Reddit and X comments for someone asking: "${query}"

Write up to ${MAX_INSIGHTS_PER_BATCH} insights from the comments below.
- Each insight is one concrete takeaway a person could not easily get from a generic article: a specific experience, number, tip, gotcha, comparison or surprising detail.
- Ground every insight in the comments and list the indices of the comments that support it. Skip anything only one vague comment hints at.
- Write it the way a knowledgeable friend would say it: direct, one or two sentences, no "users say" or "commenters mention".
- Bold the two or three words that carry the key point with **markdown**. Do not bold brand names alone.
- No generic advice (e.g. "it depends on your needs"), no duplicates, nothing off-topic, nothing from ads or spam.
- sentiment is positive, negative or neutral toward the subject of the question.

Comments:
${commentsText}`;

  const result = await completeJson<{ consensus_insights?: { insight_phrase?: string; comment_indices?: number[]; sentiment?: string }[] }>(
    prompt,
    SCHEMA,
  );

  return (result.consensus_insights ?? [])
    .filter((i) => i.insight_phrase?.trim())
    .map((i) => {
      const supporting = (i.comment_indices ?? [])
        .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < comments.length)
        .map((idx) => ({ ...comments[idx]!, index: idx }));
      return {
        insight_phrase: i.insight_phrase!.trim(),
        sentiment: i.sentiment ?? "neutral",
        supporting_comments: supporting,
        upvotes: supporting.reduce((sum, c) => sum + (c.upvotes ?? c.score ?? 0), 0),
        temporal_context: temporalContext(supporting),
      };
    })
    .filter((i) => i.supporting_comments.length > 0);
}

/** Run insight batches of 70 in parallel and yield each as soon as it completes. */
export async function* generateBatchInsights(comments: Comment[], query: string): AsyncGenerator<Insight[]> {
  const batches: Comment[][] = [];
  for (let i = 0; i < comments.length; i += BATCH_SIZE) batches.push(comments.slice(i, i + BATCH_SIZE));

  const pending = new Map(
    batches.map((batch, i) => [
      i,
      generateInsights(batch, query).then(
        (insights) => ({ i, insights }),
        (e) => {
          log.error(`batch ${i} failed`, { error: String(e) });
          return { i, insights: [] as Insight[] };
        },
      ),
    ]),
  );
  while (pending.size) {
    const { i, insights } = await Promise.race(pending.values());
    pending.delete(i);
    if (insights.length) yield insights;
  }
}
