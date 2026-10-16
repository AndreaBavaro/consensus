/**
 * Hand audit of extraction records: re-reads a sample of the coded posts from Reddit (in memory only) and prints each
 * record next to its post text so a person can judge it. Nothing is written to disk.
 *   npx tsx --env-file=.env scripts/np-audit.ts runs/np/pilot.json [--n=50] [--seed=1]
 *   npx tsx --env-file=.env scripts/np-audit.ts --urls=links.tsv [--json=out.json] [--chars=1500]
 *     (one URL per line, or id<TAB>url<TAB>paraphrase; prints status + text; --json saves status/overlap/hash, no text)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fetchThread } from "../src/v3/reddit.ts";
import { loadRun } from "../src/np/export.ts";
import type { ExtractRecord } from "../src/np/extract.ts";
import { indexById, parseInput, rereadPosts, toJsonRecord } from "../src/np/reread.ts";

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("="))) as Record<string, string>;
if (args.urls) {
  // Validation mode: re-read each listed post or comment in memory and print it with a machine-readable status.
  // Input: one URL per line, or TSV `id<TAB>url<TAB>paraphrase`. --json=<out> writes status, metadata, overlap and a
  // text hash per row (never the text), keyed by row id and fullname.
  const rows = parseInput(await readFile(args.urls, "utf8"));
  const stats = { fetches: 0, bytes: 0 };
  const recs = await rereadPosts(rows, { stats, concurrency: Number(args.concurrency ?? 4) });
  for (const r of recs) {
    const j = toJsonRecord(r);
    console.log(`\n===== #${r.id} ${r.url}\nSTATUS ${r.status} | THREAD ${r.thread_title ?? "(not found)"} | ${r.community ?? ""}\nDATE ${r.date ?? "?"} SCORE ${r.score ?? "?"}${j.max_shared_run !== null ? ` SHARED_RUN ${j.max_shared_run} QUOTE_FOUND ${j.quote_found}` : ""}${r.paraphrase ? `\nLINE ${r.paraphrase}` : ""}${r.parent_excerpt ? `\nPARENT ${r.parent_excerpt.replace(/\s+/g, " ").slice(0, 300)}` : ""}\nPOST ${r.text ? r.text.replace(/\s+/g, " ").slice(0, Number(args.chars ?? 1500)) : `(${r.status})`}`);
  }
  const counts = recs.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
  console.error(`rows ${recs.length} ${JSON.stringify(counts)} fetches ${stats.fetches} bytes ${stats.bytes}`);
  if (args.json) {
    const records = recs.map(toJsonRecord);
    await mkdir(dirname(args.json), { recursive: true });
    await writeFile(args.json, JSON.stringify({ run_at: new Date().toISOString(), input: args.urls, counts, proxy: { fetches: stats.fetches, bytes: stats.bytes }, records, by_id: indexById(records) }, null, 2));
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
