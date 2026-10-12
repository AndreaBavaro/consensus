import type { Source } from "../src/lib/types.ts";
import { ALL_SOURCES, runConsensus } from "../src/pipeline/run.ts";

const args = process.argv.slice(2);
const sourcesArg = args.find((a) => a.startsWith("--sources="));
const sources = (sourcesArg?.split("=")[1]?.split(",") as Source[] | undefined) ?? ALL_SOURCES;
const query = args.filter((a) => !a.startsWith("--")).join(" ") || "iphone vs samsung";

const start = Date.now();
const elapsed = () => `${((Date.now() - start) / 1000).toFixed(1)}s`;

for await (const { event, data } of runConsensus(query, sources)) {
  const d = data as any;
  if (event === "search_results") console.log(`[${elapsed()}] reddit posts: ${d.length}`);
  else if (event === "twitter_results") console.log(`[${elapsed()}] x searches: ${d.search_queries.join(" | ")} -> ${d.threads.length} tweets`);
  else if (event === "insights_batch") console.log(`[${elapsed()}] insights: ${d.length}, e.g. ${d[0]?.insight_phrase.slice(0, 110)}`);
  else if (event === "first_batch") console.log(`[${elapsed()}] first_batch: ${d.opinions.length} opinions`);
  else if (event === "final_opinion") {
    const x = d.comments_support.filter((c: any) => c.source === "twitter").length;
    console.log(`[${elapsed()}]   ${String(d.percentage ?? "-").padStart(5)}%  ${d.title.slice(0, 70)}  (${d.comments_support.length - x} reddit, ${x} x shown)`);
  }
}
console.log(`[${elapsed()}] complete`);
