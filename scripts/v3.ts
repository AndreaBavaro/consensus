/**
 * Runs the v3 pipeline from the terminal and records the stream.
 *   npm run v3 -- "is hubspot worth it for a small business" [--since=2025-10-11] [--until=...] [--sources=reddit,x] [--out=file.json] [--quiet]
 *   npm run v3 -- --batch=questions.txt --out-dir=runs/x [--concurrency=3]   (one question per line, "q | since")
 * New Postcode research (see src/v3/profile.ts): --profile=newpostcode (or CONSENSUS_PROFILE=newpostcode) and
 *   --store=links|full (links-only saves no post text; default full, links under the profile).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { runV3 } from "../src/v3/run.ts";
import { resolveProfile } from "../src/v3/profile.ts";
import { saveRun } from "../src/np/links.ts";
import type { V3Event, V3Source } from "../src/v3/types.ts";

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")) as [string, string][]);
const words = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const sources = (args.sources ?? "reddit,x").split(",") as V3Source[];
const profile = resolveProfile(args);
/** Today's file formats are kept unless a profile or --store asks for the research writer. */
const researchWriter = profile.name !== "default" || args.store !== undefined;

async function one(query: string, since?: string, until?: string, quiet = false) {
  const t0 = Date.now();
  const at = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;
  const events: (V3Event & { t: number })[] = [];
  let posts = 0;
  let lastProgress = 0;
  for await (const e of runV3({ query, since, until, sources })) {
    events.push({ ...e, t: Date.now() - t0 });
    const d = e.data as any;
    if (quiet) continue;
    if (e.event === "plan") console.log(`[${at()}] plan: ${d.options.map((o: any) => o.title).join(" | ")}`);
    else if (e.event === "posts") posts += d.posts.length;
    else if (e.event === "progress" && Date.now() - lastProgress > 3000) {
      lastProgress = Date.now();
      console.log(`[${at()}] ${d.stage}: reddit ${d.reddit.threads} threads/${d.reddit.posts} posts${d.reddit.done ? " (done)" : ""}, x ${d.x.posts}${d.x.done ? " (done)" : ""}, sorted ${d.sorted}/${d.pool}, shown ${posts}`);
    } else if (e.event === "poll" && d.final) {
      console.log(`[${at()}] FINAL POLL ${d.total_opinions} opinions (${d.sources.reddit.threads} threads, ${d.sources.x.posts} X posts), leads ${d.leads.total}`);
      for (const o of d.options) console.log(`        ${String(o.percent).padStart(5)}% ${String(o.count).padStart(5)}  ${o.title}  [r ${o.by_source.reddit} / x ${o.by_source.x}, leads ${o.leads}]`);
      console.log(`        pool ${JSON.stringify(d.pool)}`);
    } else if (e.event === "reasons") console.log(`[${at()}] why ${d.option_id}: ${d.summary}`);
    else if (e.event === "authors") console.log(`[${at()}] reddit profiles: ${Object.keys(d.profiles).length}`);
    else if (e.event === "error") console.log(`[${at()}] ERROR ${JSON.stringify(d)}`);
    else if (e.event === "done") console.log(`[${at()}] done ${d.status} ${d.total_ms}ms cost $${d.cost.total_usd} ${JSON.stringify(d.cost)} timing ${JSON.stringify(d.timing)} calls ${JSON.stringify(d.calls)} coverage ${d.coverage}%`);
  }
  return { query, since, events };
}

if (args.batch) {
  const lines = (await readFile(args.batch, "utf8")).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const dir = args["out-dir"] ?? "runs/v3";
  await mkdir(dir, { recursive: true });
  const conc = Number(args.concurrency ?? 3);
  let i = 0;
  const rows: any[] = [];
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (i < lines.length) {
        const [q, since] = lines[i++]!.split("|").map((s) => s.trim());
        const r = await one(q!, since || undefined, undefined, true);
        const done = r.events.find((e) => e.event === "done")?.data as any;
        const poll = [...r.events].reverse().find((e) => e.event === "poll")?.data as any;
        const firstPoll = r.events.find((e) => e.event === "poll");
        const row = {
          query: q,
          since,
          status: done?.status ?? "error",
          ms: done?.total_ms,
          first_poll_ms: firstPoll?.t,
          final_poll_ms: r.events.find((e) => e.event === "poll" && (e.data as any).final)?.t,
          usd: done?.cost?.total_usd,
          opinions: poll?.total_opinions,
          leads: poll?.leads?.total,
          options: poll?.options?.map((o: any) => `${o.title} ${o.percent}% (${o.count})`),
          pool: poll?.pool,
          errors: r.events.filter((e) => e.event === "error").map((e) => e.data),
        };
        rows.push(row);
        await writeFile(`${dir}/${(q! + (since ? `-since-${since}` : "")).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80)}.json`, JSON.stringify(r));
        console.log(`${row.status.padEnd(5)} ${String(((row.ms ?? 0) / 1000).toFixed(1)).padStart(5)}s first ${((row.first_poll_ms ?? 0) / 1000).toFixed(1)}s $${row.usd} ${row.opinions} opinions ${row.leads} leads | ${q}\n        ${row.options?.join(" | ")}`);
      }
    }),
  );
  await writeFile(`${dir}/summary.json`, JSON.stringify(rows, null, 1));
} else {
  const r = await one(words.join(" ") || "is hubspot worth it for a small business", args.since, args.until, "quiet" in args);
  const events = r.events.map(({ t, ...e }) => ({ ...e, t_ms: t }));
  if (args.out && researchWriter) await saveRun(args.out, { query: r.query, since: r.since, until: args.until, events }, profile.store);
  else if (args.out) await writeFile(args.out, JSON.stringify(events, null, 1));
}
