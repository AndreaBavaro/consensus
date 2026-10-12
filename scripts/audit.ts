import { readdir, readFile } from "node:fs/promises";
import { completeJson } from "../src/llm.ts";

/**
 * Precision audit of the classifier on a saved eval run: for every opinion's shown comments, ask a strong model
 * whether the comment really argues for that opinion.
 *
 *   npm run audit -- eval/runs/<run> [--model=openai/gpt-5.5] [--per-opinion=6]
 */
const dir = process.argv[2]!;
const flag = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const MODEL = flag("model", "openai/gpt-5.5");
const PER_OPINION = Number(flag("per-opinion", "6"));

const SCHEMA = {
  type: "object",
  properties: {
    labels: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, verdict: { type: "string", enum: ["supports", "partial", "wrong"] } },
        required: ["index", "verdict"],
      },
    },
  },
  required: ["labels"],
};

const files = (await readdir(dir)).filter((f) => /^\d+\.json$/.test(f));
const totals = { supports: 0, partial: 0, wrong: 0 };
const bySource: Record<string, typeof totals> = {};
const wrongExamples: string[] = [];

await Promise.all(
  files.map(async (f) => {
    const { run } = JSON.parse(await readFile(`${dir}/${f}`, "utf8"));
    const items: { opinion: string; source: string; content: string }[] = [];
    for (const o of run.opinions) {
      if (o.title === "other") continue;
      for (const c of o.comments.slice(0, PER_OPINION)) items.push({ opinion: o.title, source: c.source, content: c.content });
    }
    if (!items.length) return;
    const prompt = `Question being polled: "${run.query}"

Each item is a comment and the poll option it was counted as a vote for. Label each:
- supports: the comment clearly argues for that option
- partial: related and leaning that way, but weak, mixed or only implied
- wrong: does not argue for that option (neutral, off-topic, opposite, or a different option)

${items.map((it, i) => `[${i}] OPTION: ${it.opinion}\n    COMMENT: ${it.content.replace(/\s+/g, " ").slice(0, 280)}`).join("\n")}`;
    try {
      const { labels } = await completeJson<{ labels: { index: number; verdict: keyof typeof totals }[] }>(prompt, SCHEMA, {
        model: MODEL,
        maxTokens: 4000,
        timeoutMs: 120_000,
      });
      for (const { index, verdict } of labels) {
        const it = items[index];
        if (!it || !(verdict in totals)) continue;
        totals[verdict]++;
        (bySource[it.source] ??= { supports: 0, partial: 0, wrong: 0 })[verdict]++;
        if (verdict === "wrong" && wrongExamples.length < 25) wrongExamples.push(`${run.query} | ${it.opinion} | ${it.content.replace(/\s+/g, " ").slice(0, 140)}`);
      }
    } catch (e) {
      console.error(`audit failed for ${run.query}: ${e}`);
    }
  }),
);

const n = totals.supports + totals.partial + totals.wrong;
const rate = (t: typeof totals) => {
  const m = t.supports + t.partial + t.wrong;
  return `${m} labelled: ${((t.supports / m) * 100).toFixed(0)}% supports, ${((t.partial / m) * 100).toFixed(0)}% partial, ${((t.wrong / m) * 100).toFixed(0)}% wrong`;
};
console.log(`classifier audit by ${MODEL} on ${files.length} queries`);
console.log(`all: ${rate(totals)}`);
for (const [source, t] of Object.entries(bySource)) console.log(`${source}: ${rate(t)}`);
console.log(`\nwrong examples:\n${wrongExamples.map((w) => `- ${w}`).join("\n")}`);
if (!n) process.exit(1);
