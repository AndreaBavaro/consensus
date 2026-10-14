/**
 * Monthly incremental research (--seen=<state.json>): which opinions each question family has already counted, so a
 * later run reports only new ones, plus the share diff against the previous run. The state holds ids, thread links,
 * dates and shares only, never post text.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface FamilyState {
  runs: { run_id: string | null; date: string | null; shares: Record<string, number> }[];
  /** Post ids already counted as opinions. */
  comments: string[];
  /** Thread links already opened. */
  threads: string[];
}
export interface SeenState {
  version: 1;
  families: Record<string, FamilyState>;
}
type Ev = { event: string; data: any };

export const emptyState = (): SeenState => ({ version: 1, families: {} });
export const familyOf = (query: string) => query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

export async function loadState(path: string): Promise<SeenState> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return emptyState();
  }
}
export async function saveState(path: string, s: SeenState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(s, null, 1));
}

export const skipIdsFor = (s: SeenState, family: string) => new Set(s.families[family]?.comments ?? []);

/** YYYY-MM-DD of the family's last recorded run, for --since-last. */
export const sinceLast = (s: SeenState, family: string): string | undefined => s.families[family]?.runs.at(-1)?.date ?? undefined;

const runMeta = (events: Ev[]) => events.find((e) => e.event === "meta")?.data ?? {};
const finalOptions = (events: Ev[]): { title: string; percent: number }[] =>
  ([...events].reverse().find((e) => e.event === "poll" && e.data.final)?.data?.options ?? []) as { title: string; percent: number }[];

/** Share change per option (matched by title, case-insensitive) against the family's previous run; null on a first run. */
export function diffAgainst(s: SeenState, family: string, events: Ev[]) {
  const prev = s.families[family]?.runs.at(-1);
  if (!prev) return null;
  const before = new Map(Object.entries(prev.shares).map(([t, v]) => [t.toLowerCase(), v]));
  const options = finalOptions(events).map((o) => {
    const p = before.get(o.title.toLowerCase());
    return { title: o.title, share: o.percent, previous: p ?? null, change: p === undefined ? null : Math.round((o.percent - p) * 10) / 10 };
  });
  return { previous_run: prev.run_id, previous_date: prev.date, options, new_options: options.filter((o) => o.previous === null).map((o) => o.title) };
}

/** Adds this run's counted opinions, opened threads and final shares to the family. */
export function recordRun(s: SeenState, family: string, events: Ev[]): void {
  const f = (s.families[family] ??= { runs: [], comments: [], threads: [] });
  const last = new Map<string, any>();
  for (const e of events) if (e.event === "posts") for (const p of e.data.posts) last.set(p.id, { ...last.get(p.id), ...p });
  const comments = new Set(f.comments);
  const threads = new Set(f.threads);
  for (const p of last.values()) {
    if (p.option) comments.add(p.id);
    if (p.thread_url) threads.add(p.thread_url);
  }
  f.comments = [...comments];
  f.threads = [...threads];
  const meta = runMeta(events);
  f.runs.push({ run_id: meta.id ?? null, date: meta.started_at ? String(meta.started_at).slice(0, 10) : null, shares: Object.fromEntries(finalOptions(events).map((o) => [o.title, o.percent])) });
}
