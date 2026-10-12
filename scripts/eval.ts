import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { completeJson } from "../src/llm.ts";

/**
 * End-to-end quality eval against a deployed site: streams each query through the real API, runs hard checks,
 * then has an independent model grade the result like a normal user would.
 *
 *   npm run eval -- [--base=https://...] [--limit=N] [--concurrency=N] [--queries=file.txt] [--judge=model]
 */
const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.slice(2).split("=");
    return [k, v ?? "true"];
  }),
);
const BASE = args.base ?? "https://useconsensus.io";
const CONCURRENCY = Number(args.concurrency ?? 4);
const JUDGE = args.judge ?? "openai/gpt-5.4-mini";
const STREAM_TIMEOUT_MS = 75_000;

interface Run {
  query: string;
  ms: number;
  firstOpinionMs: number | null;
  events: Record<string, number>;
  error: string | null;
  sources: { title: string; subreddit: string | null }[];
  xQueries: string[];
  xThreads: { title: string }[];
  insights: { insight_phrase: string; sentiment: string; upvotes: number }[];
  opinions: {
    title: string;
    description: string;
    percentage?: number;
    total_upvotes: number;
    comments: { source: string; score: number; content: string }[];
  }[];
}

async function stream(query: string): Promise<Run> {
  const run: Run = { query, ms: 0, firstOpinionMs: null, events: {}, error: null, sources: [], xQueries: [], xThreads: [], insights: [], opinions: [] };
  const start = Date.now();
  try {
    const res = await fetch(`${BASE}/api/search/streaming/v2?query=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const lines = block.split("\n");
        const event = lines.find((l) => l.startsWith("event: "))?.slice(7);
        const raw = lines.find((l) => l.startsWith("data: "))?.slice(6);
        if (!event || !raw) continue;
        run.events[event] = (run.events[event] ?? 0) + 1;
        const data = JSON.parse(raw);
        if (event === "search_results") run.sources = data;
        else if (event === "twitter_results") {
          run.xQueries = data.search_queries;
          run.xThreads = data.threads;
        } else if (event === "insights_batch") run.insights.push(...data);
        else if (event === "first_batch") run.firstOpinionMs ??= Date.now() - start;
        else if (event === "final_opinion") {
          run.opinions.push({
            title: data.title,
            description: data.description,
            percentage: data.percentage,
            total_upvotes: data.total_upvotes,
            comments: data.comments_support.map((c: any) => ({ source: c.source, score: c.score, content: String(c.content).slice(0, 280) })),
          });
        } else if (event === "error") run.error = data.message;
      }
    }
  } catch (e) {
    run.error = String(e);
  }
  run.ms = Date.now() - start;
  return run;
}

interface Checks {
  completed: boolean;
  underTimeLimit: boolean;
  hasOpinions: boolean;
  percentagesSumTo100: boolean;
  hasReddit: boolean;
  hasX: boolean;
  hasInsights: boolean;
  everyOpinionHasEvidence: boolean;
}

function check(run: Run): Checks {
  const real = run.opinions.filter((o) => o.title !== "other");
  const sum = real.reduce((s, o) => s + (o.percentage ?? 0), 0);
  const all = run.opinions.flatMap((o) => o.comments);
  return {
    completed: !!run.events.complete && !run.error,
    underTimeLimit: run.ms < 58_000,
    hasOpinions: real.length >= 2,
    percentagesSumTo100: real.length === 0 || Math.abs(sum - 100) <= 1.5,
    hasReddit: all.some((c) => c.source === "reddit"),
    hasX: all.some((c) => c.source === "twitter"),
    hasInsights: run.insights.length >= 3,
    everyOpinionHasEvidence: real.every((o) => o.comments.length > 0),
  };
}

interface Verdict {
  relevance: number;
  opinion_quality: number;
  classification_accuracy: number;
  insight_quality: number;
  representativeness: number;
  overall: number;
  biggest_problem: string;
  notes: string;
}

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    relevance: { type: "integer" },
    opinion_quality: { type: "integer" },
    classification_accuracy: { type: "integer" },
    insight_quality: { type: "integer" },
    representativeness: { type: "integer" },
    overall: { type: "integer" },
    biggest_problem: { type: "string" },
    notes: { type: "string" },
  },
  required: ["relevance", "opinion_quality", "classification_accuracy", "insight_quality", "representativeness", "overall", "biggest_problem", "notes"],
};

function judgePrompt(run: Run) {
  const opinions = run.opinions
    .map((o) => {
      const sample = o.comments.slice(0, 6).map((c) => `      - [${c.source}, ${c.score}] ${c.content.replace(/\s+/g, " ")}`).join("\n");
      return `  * ${o.title} (${o.percentage ?? "-"}%): ${o.description}\n    supporting comments:\n${sample}`;
    })
    .join("\n");
  return `You are evaluating a social-listening product that answers "what do real people think about X?" by reading Reddit and X (Twitter), grouping comments into opinions, and showing a poll.

How the poll is computed: each comment counts as one vote for at most one option, weighted by 1 + ln(1 + upvotes) so popular comments count more but one viral post cannot dominate; X's combined weight is capped at 40% when Reddit is present; comments with no clear stance go to "other", which is not part of the percentages. Only the top few comments per option are shown below.

Judge it the way a sharp, ordinary user would: is this result useful, accurate and trustworthy for the question asked? Be fair, not harsh for its own sake. Score each 1-10 (10 = excellent, 7 = solid, 5 = mediocre, 3 = poor).

- relevance: are the sources and comments actually about the question?
- opinion_quality: are the opinions distinct, specific, non-overlapping, and covering the real sides of the debate?
- classification_accuracy: do the supporting comments genuinely express the opinion they are filed under?
- insight_quality: are the key insights specific, concrete and interesting rather than generic?
- representativeness: does the poll split look like a plausible reading of the evidence (not skewed by a single viral post or by off-topic content)?
- overall: would you trust and use this answer?

QUESTION: ${run.query}

REDDIT THREADS: ${run.sources.map((s) => `${s.title} (${s.subreddit})`).join(" | ")}
X SEARCHES: ${run.xQueries.join(" | ")}
X TWEETS: ${run.xThreads.slice(0, 12).map((t) => t.title).join(" | ")}

OPINION POLL:
${opinions || "(none)"}

KEY INSIGHTS:
${run.insights.slice(0, 15).map((i) => `  - (${i.sentiment}, ${i.upvotes} upvotes) ${i.insight_phrase}`).join("\n") || "(none)"}

Return JSON with the six integer scores, "biggest_problem" (one sentence, or "none"), and "notes" (one or two sentences).`;
}

async function judge(run: Run): Promise<Verdict | null> {
  if (!run.opinions.length) return null;
  try {
    return await completeJson<Verdict>(judgePrompt(run), JUDGE_SCHEMA, { model: JUDGE, maxTokens: 1500, timeoutMs: 90_000 });
  } catch (e) {
    console.error(`judge failed for "${run.query}": ${e}`);
    return null;
  }
}

async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (xs: boolean[]) => `${((xs.filter(Boolean).length / Math.max(1, xs.length)) * 100).toFixed(0)}%`;

if (args.rejudge) {
  const dir = args.rejudge;
  const files = (await readdir(dir)).filter((f) => /^\d+\.json$/.test(f)).sort();
  const runs: Run[] = await Promise.all(files.map(async (f) => JSON.parse(await readFile(`${dir}/${f}`, "utf8")).run));
  const verdicts = (await pool(runs, CONCURRENCY, judge)).filter((v): v is Verdict => !!v);
  const dims = ["relevance", "opinion_quality", "classification_accuracy", "insight_quality", "representativeness", "overall"] as const;
  console.log(`rejudged ${verdicts.length}/${runs.length} runs in ${dir} with ${JUDGE}`);
  for (const d of dims) console.log(`- ${d}: ${mean(verdicts.map((v) => v[d])).toFixed(2)}`);
  console.log(`- share scoring overall >= 7: ${pct(verdicts.map((v) => v.overall >= 7))}`);
  for (const v of [...verdicts].sort((a, b) => a.representativeness - b.representativeness).slice(0, 12)) {
    console.log(`  (rep ${v.representativeness}, overall ${v.overall}) ${v.biggest_problem}`);
  }
  process.exit(0);
}

const queryFile = args.queries ?? "scripts/eval-queries.txt";
let queries = (await readFile(queryFile, "utf8")).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
if (args.offset) queries = queries.slice(Number(args.offset));
if (args.stride) queries = queries.filter((_, i) => i % Number(args.stride) === 0);
if (args.limit) queries = queries.slice(0, Number(args.limit));

const outDir = `eval/runs/${new Date().toISOString().replace(/[:.]/g, "-")}`;
await mkdir(outDir, { recursive: true });
console.log(`running ${queries.length} queries against ${BASE} (concurrency ${CONCURRENCY}, judge ${JUDGE}) -> ${outDir}`);

const results = await pool(queries, CONCURRENCY, async (query, i) => {
  const run = await stream(query);
  const checks = check(run);
  const verdict = await judge(run);
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  console.log(
    `[${i + 1}/${queries.length}] ${(run.ms / 1000).toFixed(0)}s overall=${verdict?.overall ?? "-"} ${failed.length ? `FAIL(${failed.join(",")})` : "ok"}  ${query}` +
      (verdict && verdict.overall <= 5 ? `\n      -> ${verdict.biggest_problem}` : ""),
  );
  const result = { run, checks, verdict };
  await writeFile(`${outDir}/${String(i).padStart(3, "0")}.json`, JSON.stringify(result, null, 2));
  return result;
});

const verdicts = results.map((r) => r.verdict).filter((v): v is Verdict => !!v);
const dims = ["relevance", "opinion_quality", "classification_accuracy", "insight_quality", "representativeness", "overall"] as const;
const checkNames = Object.keys(results[0]!.checks) as (keyof Checks)[];
const worst = results.filter((r) => r.verdict).sort((a, b) => a.verdict!.overall - b.verdict!.overall).slice(0, 15);

const summary = [
  `# Eval ${outDir}`,
  `${results.length} queries, ${verdicts.length} judged by ${JUDGE}`,
  ``,
  `## Hard checks`,
  ...checkNames.map((k) => `- ${k}: ${pct(results.map((r) => r.checks[k]))}`),
  `- median latency: ${(results.map((r) => r.run.ms).sort((a, b) => a - b)[Math.floor(results.length / 2)]! / 1000).toFixed(1)}s`,
  `- median time to first opinions: ${((results.map((r) => r.run.firstOpinionMs ?? 0).sort((a, b) => a - b)[Math.floor(results.length / 2)] ?? 0) / 1000).toFixed(1)}s`,
  ``,
  `## Judge scores (mean, 1-10)`,
  ...dims.map((d) => `- ${d}: ${mean(verdicts.map((v) => v[d])).toFixed(2)}`),
  `- share scoring overall >= 7: ${pct(verdicts.map((v) => v.overall >= 7))}`,
  ``,
  `## Lowest scoring`,
  ...worst.map((r) => `- (${r.verdict!.overall}) ${r.run.query}: ${r.verdict!.biggest_problem}`),
  ``,
  `## Errors`,
  ...results.filter((r) => r.run.error).map((r) => `- ${r.run.query}: ${r.run.error}`),
].join("\n");

await writeFile(`${outDir}/summary.md`, summary);
console.log(`\n${summary}`);
