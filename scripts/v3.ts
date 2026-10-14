/**
 * Runs the v3 pipeline from the terminal and records the stream.
 *   npm run v3 -- "is hubspot worth it for a small business" [--since=2025-10-11] [--until=...] [--sources=reddit,x] [--out=file.json] [--quiet]
 *   npm run v3 -- --batch=questions.txt --out-dir=runs/x [--concurrency=3]   (one question per line, "q | since")
 * New Postcode research (see src/v3/profile.ts): --profile=newpostcode (or CONSENSUS_PROFILE=newpostcode) and
 *   --store=links|full (links-only saves no post text; default full, links under the profile).
 *   --budget-usd=N, --subs=a,b, --deny-subs=c,d, --lang=it,pt, --research (batch rules without the profile).
 *   --seen=state.json [--family=name] [--since-last]   count only opinions not counted before; adds a diff event.
 *   --cache-dir=.np-cache --cache-ttl-days=N   opt-in thread cache (stores post text locally); --purge-cache empties it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { runV3 } from "../src/v3/run.ts";
import { profileRequest, resolveProfile } from "../src/v3/profile.ts";
import { saveRun } from "../src/np/links.ts";
import { runResearchBatch } from "../src/np/batch.ts";
import { addQuotes } from "../src/np/quotes.ts";
import { diffAgainst, familyOf, loadState, recordRun, saveState, sinceLast, skipIdsFor } from "../src/np/seen.ts";
import { cachedDeps, purgeCache } from "../src/np/cache.ts";
import type { V3Event, V3Source } from "../src/v3/types.ts";

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")) as [string, string][]);
const words = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const profile = resolveProfile(args);
// Research runs are Reddit only unless --sources says otherwise.
const sources = (args.sources ?? (profile.research ? "reddit" : "reddit,x")).split(",") as V3Source[];
/** Today's file formats are kept unless a profile or --store asks for the research writer. */
const researchWriter = profile.name !== "default" || args.store !== undefined;

if ("purge-cache" in args) {
  const dir = args["cache-dir"] ?? ".np-cache";
  console.log(`purged ${await purgeCache(dir)} cached threads from ${dir}`);
  process.exit(0);
}
if (args["cache-dir"] && !args["cache-ttl-days"]) throw new Error("--cache-dir needs --cache-ttl-days=N (the cache stores post text locally; choose how long)");
const deps = args["cache-dir"] ? cachedDeps(args["cache-dir"], Number(args["cache-ttl-days"])) : {};
const state = args.seen ? await loadState(args.seen) : null;
const family = (q: string) => args.family ?? familyOf(q);
/** --seen: skip opinions counted before; --since-last: start where the family's last run did. */
const seenRequest = (q: string): { skipIds?: string[]; since?: string } =>
  state ? { skipIds: [...skipIdsFor(state, family(q))], ...("since-last" in args && sinceLast(state, family(q)) ? { since: sinceLast(state, family(q)) } : {}) } : {};
/** Appends the diff against the family's previous run and records this run in the state file. */
async function afterSeen(q: string, events: { event: string; data: any }[]) {
  if (!state) return;
  events.push({ event: "diff", data: diffAgainst(state, family(q), events) });
  recordRun(state, family(q), events);
  await saveState(args.seen!, state);
}

async function one(query: string, since?: string, until?: string, quiet = false) {
  const t0 = Date.now();
  const at = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;
  const events: (V3Event & { t: number })[] = [];
  let posts = 0;
  let lastProgress = 0;
  const seenReq = seenRequest(query);
  for await (const e of runV3({ ...seenReq, query, since: since ?? seenReq.since, until, sources, ...profileRequest(profile), ...(args["budget-usd"] !== undefined && !args.batch ? { budgetUsd: Number(args["budget-usd"]) } : {}) }, deps)) {
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

if (args.batch && profile.research) {
  // Research batch: one at a time, Reddit only unless --sources, budget stop, manifest.jsonl, resume by slug.
  const lines = (await readFile(args.batch, "utf8")).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const r = await runResearchBatch({
    lines,
    outDir: args["out-dir"] ?? "runs/np",
    budgetUsd: args["budget-usd"] !== undefined ? Number(args["budget-usd"]) : undefined,
    store: profile.store,
    sources: args.sources ? sources : ["reddit"],
    request: profileRequest(profile),
    requestFor: (line) => seenRequest(line.query),
    run: (req) => runV3(req, deps),
    afterRun: async ({ line, events }) => {
      const usd = profile.tags && profile.quotesPerOption > 0 ? await addQuotes(line.query, events, profile.quotesPerOption) : 0;
      await afterSeen(line.query, events);
      return usd;
    },
    log: (l) => console.log(l),
  });
  console.log(`spent $${r.spent.toFixed(4)}${r.stopped ? ` (stopped: ${r.stopped})` : ""}, ${r.rows.length} run, ${r.skipped.length} skipped`);
} else if (args.batch) {
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
  if (profile.tags && profile.quotesPerOption > 0) {
    const usd = await addQuotes(r.query, events, profile.quotesPerOption);
    console.log(`quote bank: ${(events.at(-1)!.data as any).rows.length} rows, $${usd} for paraphrases`);
  }
  await afterSeen(r.query, events);
  const diff = events.find((e) => e.event === "diff")?.data as any;
  if (diff) console.log(`diff vs ${diff.previous_date}: ${diff.options.map((o: any) => `${o.title} ${o.share}%${o.change === null ? " (new)" : ` (${o.change >= 0 ? "+" : ""}${o.change})`}`).join(" | ")}`);
  if (args.out && researchWriter) await saveRun(args.out, { query: r.query, since: r.since, until: args.until, events }, profile.store);
  else if (args.out) await writeFile(args.out, JSON.stringify(events, null, 1));
}
