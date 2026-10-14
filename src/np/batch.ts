/**
 * Research batch runner (--profile=newpostcode or --research): one search at a time, Reddit only unless asked,
 * a budget checked BEFORE each search, a manifest row per finished question, and resume by slug.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { saveRun } from "./links.ts";
import type { StoreMode } from "../v3/profile.ts";
import type { SearchRequest, V3Event, V3Source } from "../v3/types.ts";

export interface BatchLine {
  query: string;
  since: string | undefined;
  until: string | undefined;
}

/** "question | since | until"; since and until are optional and may be left empty. */
export function parseBatchLine(line: string): BatchLine {
  const [q, since, until] = line.split("|").map((s) => s.trim());
  return { query: q!, since: since || undefined, until: until || undefined };
}

/** Same slug rule as the default batch writer, plus the until date. */
export const slugOf = (l: BatchLine) =>
  (l.query + (l.since ? `-since-${l.since}` : "") + (l.until ? `-until-${l.until}` : "")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

export interface ManifestRow {
  slug: string;
  query: string;
  since: string | null;
  until: string | null;
  status: string;
  cost: number;
  opinions: number;
  file: string;
  finished_at: string;
}

/** Statuses that count as finished: a resume does not pay for them again. */
const FINISHED = new Set(["ok", "thin"]);

export async function readManifest(dir: string): Promise<ManifestRow[]> {
  try {
    return (await readFile(join(dir, "manifest.jsonl"), "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/** Total cost of one finished run: LLM + X + Serper, plus the proxy estimate when a price per GB is set. */
export const runCost = (done: any): number => Number(done?.cost?.total_usd ?? 0) + Number(done?.cost?.oxylabs_usd ?? 0);

export interface BatchOptions {
  lines: string[];
  outDir: string;
  budgetUsd?: number;
  store: StoreMode;
  sources?: V3Source[];
  run: (req: SearchRequest) => AsyncIterable<V3Event>;
  /** Extra request fields every search gets (profile settings). */
  request?: Partial<SearchRequest>;
  /** Per-question request fields (seen ids, since-last); the line's own since/until win. */
  requestFor?: (line: BatchLine) => Partial<SearchRequest>;
  /** Called with each finished run before it is saved (quote paraphrases, seen-state updates); may push events and returns any extra USD it spent. */
  afterRun?: (run: { line: BatchLine; events: (V3Event & { t_ms: number })[] }) => Promise<number | void>;
  log?: (s: string) => void;
}

export async function runResearchBatch(o: BatchOptions): Promise<{ rows: ManifestRow[]; skipped: string[]; stopped: "budget" | null; spent: number }> {
  const log = o.log ?? (() => {});
  await mkdir(o.outDir, { recursive: true });
  const done = new Set((await readManifest(o.outDir)).filter((r) => FINISHED.has(r.status)).map((r) => r.slug));
  const rows: ManifestRow[] = [];
  const skipped: string[] = [];
  let spent = 0;
  let maxCost = 0;
  let stopped: "budget" | null = null;
  for (const raw of o.lines) {
    const line = parseBatchLine(raw);
    const slug = slugOf(line);
    if (done.has(slug)) {
      skipped.push(slug);
      log(`skip  ${slug} (already finished)`);
      continue;
    }
    if (o.budgetUsd !== undefined && spent + maxCost > o.budgetUsd) {
      stopped = "budget";
      log(`stop  budget: spent $${spent.toFixed(4)} + max per search $${maxCost.toFixed(4)} would pass $${o.budgetUsd}`);
      break;
    }
    const t0 = Date.now();
    const events: (V3Event & { t_ms: number })[] = [];
    const per = o.requestFor?.(line) ?? {};
    const req: SearchRequest = { ...o.request, ...per, query: line.query, since: line.since ?? per.since, until: line.until ?? per.until, sources: o.sources ?? o.request?.sources ?? ["reddit"], ...(o.budgetUsd !== undefined ? { budgetUsd: o.budgetUsd - spent } : {}) };
    for await (const e of o.run(req)) events.push({ ...e, t_ms: Date.now() - t0 });
    const d = events.find((e) => e.event === "done")?.data as any;
    const poll = [...events].reverse().find((e) => e.event === "poll")?.data as any;
    const cost = runCost(d) + Number((await o.afterRun?.({ line, events })) ?? 0);
    spent += cost;
    maxCost = Math.max(maxCost, cost);
    const file = `${slug}.json`;
    await saveRun(join(o.outDir, file), { query: line.query, since: line.since, until: line.until, events }, o.store);
    const row: ManifestRow = { slug, query: line.query, since: line.since ?? null, until: line.until ?? null, status: d?.status ?? "error", cost, opinions: poll?.total_opinions ?? 0, file, finished_at: new Date().toISOString() };
    await appendFile(join(o.outDir, "manifest.jsonl"), `${JSON.stringify(row)}\n`);
    rows.push(row);
    log(`${row.status.padEnd(5)} $${cost.toFixed(4)} ${row.opinions} opinions | ${line.query}`);
  }
  return { rows, skipped, stopped, spent };
}
