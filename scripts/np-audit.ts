/**
 * Hand audit of extraction records: re-reads a sample of the coded posts from Reddit (in memory only) and prints each
 * record next to its post text so a person can judge it. Nothing is written to disk.
 *   npx tsx --env-file=.env scripts/np-audit.ts runs/np/pilot.json [--n=50] [--seed=1]
 *   npx tsx --env-file=.env scripts/np-audit.ts --urls=links.txt      (one Reddit post or comment URL per line)
 */
import { readFile } from "node:fs/promises";
import { fetchThread } from "../src/v3/reddit.ts";
import { loadRun } from "../src/np/export.ts";
import type { ExtractRecord } from "../src/np/extract.ts";

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("="))) as Record<string, string>;
if (args.urls) {
  // Validation mode: print each listed post or comment, read in memory only.
  const urls = (await readFile(args.urls, "utf8")).split("\n").map((l) => l.trim()).filter((l) => l.startsWith("https://"));
  const cache = new Map<string, Awaited<ReturnType<typeof fetchThread>>>();
  let i = 0;
  for (const url of urls) {
    const m = url.match(/comments\/(\w+)\/[^/]*\/(\w+)?/);
    const tid = m?.[1];
    if (!tid) continue;
    if (!cache.has(tid)) cache.set(tid, await fetchThread(tid, { sinceEpoch: 0, untilEpoch: Number.POSITIVE_INFINITY }));
    const t = cache.get(tid);
    const p = m?.[2] ? t?.posts.find((x) => x.id === `t1_${m[2]}`) : t?.posts.find((x) => x.kind === "opener");
    const date = p?.created_utc ? new Date(p.created_utc * 1000).toISOString().slice(0, 10) : "?";
    console.log(`\n===== #${++i} ${url}\nTHREAD ${t?.title ?? "(not found)"} | ${t?.community ?? ""}\nDATE ${date} SCORE ${p?.score ?? "?"}\nPOST ${p ? p.text.replace(/\s+/g, " ").slice(0, 1500) : "(deleted or not found)"}`);
  }
  process.exit(0);
}
const file = argv.find((a) => !a.startsWith("--"))!;
const run = loadRun(JSON.parse(await readFile(file, "utf8")));
const records: ExtractRecord[] = run.events.filter((e) => e.event === "extract").flatMap((e) => e.data.records);
// Deterministic shuffle so a re-run audits the same sample.
let seed = Number(args.seed ?? 1);
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const sample = [...records].sort(() => rand() - 0.5).slice(0, Number(args.n ?? 50));
const byThread = new Map<string, ExtractRecord[]>();
for (const r of sample) {
  const id = (r.thread_url ?? r.url).match(/comments\/(\w+)/)?.[1];
  if (id) (byThread.get(id) ?? byThread.set(id, []).get(id)!).push(r);
}
let n = 0;
for (const [id, rs] of byThread) {
  const t = await fetchThread(id, { sinceEpoch: 0, untilEpoch: Number.POSITIVE_INFINITY });
  for (const r of rs) {
    const p = t?.posts.find((x) => x.id === r.post_id);
    const { url: _u, thread_url: _t, community: _c, handle: _h, ...codes } = r;
    console.log(`\n===== #${++n} ${r.url}\nCODES ${JSON.stringify(codes)}\nPOST ${p ? p.text.replace(/\s+/g, " ").slice(0, 1500) : "(deleted or not found)"}`);
  }
}
