import { logger } from "../lib/log.ts";
import type { Comment, Opinion } from "../lib/types.ts";
import { completeJson } from "../llm.ts";
import { formatCommentsForPrompt } from "./format.ts";

const log = logger("opinions");
const MAX_OPINIONS = 6;

const SCHEMA = {
  type: "object",
  properties: {
    opinions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
        },
        required: ["title", "description"],
      },
    },
  },
  required: ["opinions"],
};

function buildPrompt(comments: Comment[], query: string): string {
  return `You run a public opinion poll built from real Reddit and X comments. Read the comments about "${query}" and write the poll options: the distinct positions people actually take.

How to write the options:
- 3 to 6 options. Each must be a clear, one-sided answer to "${query}" that a commenter could plainly agree with.
- Options must be mutually exclusive: a person holding one should not also hold another. Never write two options that are the same stance in different words (e.g. "Remote is better than office" and "Office is not better than remote" are the same option).
- Cover every side that has real support in the comments. Add at most ONE middle or conditional option (e.g. "Hybrid is best" or "It depends on your situation"), and only if many comments take it. Never split the middle ground into several options.
- Yes/no questions: the yes side, the no side, and at most one or two conditional positions.
- X vs Y: "X is better than Y", "Y is better than X", plus a middle option if common.
- "Best X" or recommendation questions: one option per specific named pick that several comments recommend, using the exact name. Skip picks only one comment mentions.
- Titles: short (under 12 words), plain, and name the specific things from the question. No vague titles.
- Descriptions: one sentence giving the main reason people hold that position, grounded in what the comments say.
- Ignore spam, ads and comments that are off-topic for the question.
- Plain text only: no markdown, no quotation marks.

Comments:
${formatCommentsForPrompt(comments)}`;
}

export async function generateOpinions(comments: Comment[], query: string): Promise<Opinion[]> {
  if (!comments.length) return [];
  try {
    const result = await completeJson<{ opinions?: { title?: string; description?: string }[] }>(buildPrompt(comments, query), SCHEMA, {
      maxTokens: 1500,
    });
    return (result.opinions ?? [])
      .filter((o) => o.title?.trim())
      .slice(0, MAX_OPINIONS)
      .map((o) => ({ title: o.title!.trim(), description: o.description?.trim() ?? "" }));
  } catch (e) {
    log.error("opinion generation failed", { error: String(e) });
    return [];
  }
}
