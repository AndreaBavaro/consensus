/**
 * Aggregates extraction records (src/np/extract.ts) into what the product reads: incidents ranked by how many distinct
 * threads report them (with the fixes people describe), the usual step order per country, paid help, triggers, the
 * circumstances behind them, and a saturation check. The sidecar written for newpostcode/data/forum/ holds codes and
 * links only; paraphrases stay in the research Markdown.
 */
import { CODEBOOK, timelineStepFor } from "./codebook.ts";
import type { ExtractRecord } from "./extract.ts";

const RECENT_MS = 730 * 86_400_000;
const LINKS = 5;

const bump = (m: Record<string, number>, k: string | null | undefined) => {
  if (k) m[k] = (m[k] ?? 0) + 1;
};

export function aggregate(all: ExtractRecord[], o: { now?: number; destinations?: string[] } = {}) {
  const now = o.now ?? Date.now();
  // A block about given destinations drops posts tagged as moves elsewhere; unknown destinations ("-") stay.
  const records = o.destinations ? all.filter((r) => !r.dest || r.dest === "-" || o.destinations!.includes(r.dest)) : all;
  const excluded_other_destination = all.length - records.length;
  const recent = (r: ExtractRecord) => !!r.created_at && now - Date.parse(r.created_at) <= RECENT_MS;

  const inc = new Map<string, { country: string; step: string; what: string; threads: Set<string>; authors: Set<string>; posts: number; recent_posts: number; rule_dependent_posts: number; fixes: Record<string, number>; tried: Record<string, number>; links: string[] }>();
  for (const r of records)
    for (const i of r.incidents) {
      const country = i.step.includes(":") ? i.step.split(":")[0]!.toUpperCase() : r.country;
      const k = `${country}|${i.step}|${i.what}`;
      const e = inc.get(k) ?? inc.set(k, { country, step: i.step, what: i.what, threads: new Set(), authors: new Set(), posts: 0, recent_posts: 0, rule_dependent_posts: 0, fixes: {}, tried: {}, links: [] }).get(k)!;
      e.threads.add(r.thread_url ?? r.url);
      if (r.handle && r.handle !== "[deleted]") e.authors.add(r.handle);
      e.posts++;
      if (recent(r)) e.recent_posts++;
      if (r.rule_dependent) e.rule_dependent_posts++;
      bump(e.fixes, i.fix);
      for (const t of i.tried ?? []) bump(e.tried, t);
      if (e.links.length < LINKS && !e.links.includes(r.url)) e.links.push(r.url);
    }
  const incidents = [...inc.values()]
    .map((e) => ({
      country: e.country,
      step: e.step,
      step_label: CODEBOOK[e.step]?.label ?? e.step,
      rule: CODEBOOK[e.step]?.rule ?? null,
      what: e.what,
      threads: e.threads.size,
      /** Distinct posters: one person's several comments count once (validation 2026-10-14). */
      authors: e.authors.size,
      posts: e.posts,
      recent_posts: e.recent_posts,
      rule_dependent_posts: e.rule_dependent_posts,
      /** What finally worked, per the posters. */
      fixes: Object.entries(e.fixes).map(([fix, posts]) => ({ fix, posts })).sort((a, b) => b.posts - a.posts),
      /** Everything people tried, worked or not. */
      tried: Object.entries(e.tried).map(([fix, posts]) => ({ fix, posts })).sort((a, b) => b.posts - a.posts),
      links: e.links,
    }))
    .sort((a, b) => b.authors - a.authors || b.threads - a.threads || b.posts - a.posts);

  // Usual order per country: mean relative position of each step among posts that state an order of 2+ steps.
  const pos = new Map<string, Map<string, number[]>>();
  for (const r of records) {
    if (r.steps.length < 2) continue;
    r.steps.forEach((s, i) => {
      const c = s.includes(":") ? s.split(":")[0]!.toUpperCase() : r.country;
      const m = pos.get(c) ?? pos.set(c, new Map()).get(c)!;
      (m.get(s) ?? m.set(s, []).get(s)!).push(i / (r.steps.length - 1));
    });
  }
  const order = Object.fromEntries(
    [...pos].map(([c, m]) => [
      c,
      [...m].map(([step, ps]) => ({ step, mean_position: Math.round((ps.reduce((a, b) => a + b, 0) / ps.length) * 100) / 100, posts: ps.length })).sort((a, b) => a.mean_position - b.mean_position),
    ]),
  ) as Record<string, { step: string; mean_position: number; posts: number }[]>;

  const paid = new Map<string, { what: string; posts: number; worth: Record<"+" | "-" | "~" | "?", number>; links: string[] }>();
  for (const r of records)
    for (const p of r.paid_for) {
      const e = paid.get(p.what) ?? paid.set(p.what, { what: p.what, posts: 0, worth: { "+": 0, "-": 0, "~": 0, "?": 0 }, links: [] }).get(p.what)!;
      e.posts++;
      e.worth[p.worth]++;
      if (e.links.length < LINKS) e.links.push(r.url);
    }

  const triggers: Record<string, number> = {};
  const choices: Record<string, number> = {};
  const facets = { household: {} as Record<string, number>, route: {} as Record<string, number>, income: {} as Record<string, number>, consulate: {} as Record<string, number>, partner_non_eu: {} as Record<string, number> };
  for (const r of records) {
    r.triggers.forEach((t) => bump(triggers, t));
    if (r.chose) bump(choices, `${r.chose.picked} over ${r.chose.over.join("/") || "?"}${r.chose.because.length ? ` (${r.chose.because.join(", ")})` : ""}`);
    bump(facets.household, r.who.household);
    bump(facets.route, r.who.route);
    bump(facets.income, r.who.income);
    bump(facets.consulate, r.who.consulate);
    if (r.who.partner_non_eu !== null) bump(facets.partner_non_eu, String(r.who.partner_non_eu));
  }

  // Saturation: of the distinct (step, what) pairs, the share first seen in the last two threads read.
  const threadOrder: string[] = [];
  const firstSeen = new Map<string, number>();
  for (const r of records) {
    const t = r.thread_url ?? r.url;
    if (!threadOrder.includes(t)) threadOrder.push(t);
    for (const i of r.incidents) {
      const k = `${i.step}|${i.what}`;
      if (!firstSeen.has(k)) firstSeen.set(k, threadOrder.indexOf(t));
    }
  }
  const lastTwo = [...firstSeen.values()].filter((t) => t >= threadOrder.length - 2).length;

  return {
    first_hand_posts: records.length,
    excluded_other_destination,
    incidents,
    order,
    paid_for: [...paid.values()].sort((a, b) => b.posts - a.posts),
    triggers: Object.entries(triggers).map(([code, posts]) => ({ code, posts })).sort((a, b) => b.posts - a.posts),
    choices: Object.entries(choices).map(([choice, posts]) => ({ choice, posts })).sort((a, b) => b.posts - a.posts),
    facets,
    saturation: { threads: threadOrder.length, pairs: firstSeen.size, new_in_last_two: firstSeen.size ? Math.round((lastTwo / firstSeen.size) * 100) / 100 : 0 },
  };
}

export type Aggregate = ReturnType<typeof aggregate>;

/** newpostcode/data/forum/<batch>.json: codes, counts and links only (no paraphrases, no post text). */
export function toSidecar(batch: string, a: Aggregate, o: { timelineIds?: string[]; runDate: string }) {
  return {
    v: 1,
    batch,
    run_date: o.runDate,
    source: "reddit (Consensus research profile); themes only, never numbers or facts on the site",
    first_hand_posts: a.first_hand_posts,
    incidents: a.incidents.map(({ step_label: _l, ...i }) => ({ ...i, timeline_steps: timelineStepFor(i.step, o.timelineIds ?? []), app_steps: CODEBOOK[i.step]?.app ?? [] })),
    order: a.order,
    paid_for: a.paid_for,
    triggers: a.triggers,
    choices: a.choices,
    // `facets` (household, route, income, consulate) stay internal: the who codes audited at 64% precision.
    saturation: a.saturation,
  };
}
