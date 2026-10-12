/**
 * Count invariants (KAN-409). Every number the UI shows must equal the number of posts it lists:
 *  - option.count = posts streamed with that option; option.by_source.reddit + .x = option.count
 *  - poll.total_opinions = sum of option counts; sources.<s>.opinions = opinions from that source
 *  - theme.by_option[o] = theme posts whose option is o; theme.by_option_source[o][s] = those from source s
 *  - theme.post_ids lists every tagged post (so the filtered list length equals the shown count)
 * `reconcile*` recompute from the posts, log any drift and return the fixed objects; `countIssues` only reports.
 */
import type { Poll, Post, Theme, V3Source } from "./types.ts";

const SOURCES: V3Source[] = ["reddit", "x"];

export interface CountIssue {
  where: string;
  expected: number;
  got: number;
}

/** Mismatches between a poll/themes and the posts they describe (posts = final state of every streamed post). */
export function countIssues(poll: Poll, posts: Iterable<Post>, themes: Theme[] = []): CountIssue[] {
  const list = [...posts];
  const issues: CountIssue[] = [];
  const push = (where: string, expected: number, got: number) => expected !== got && issues.push({ where, expected, got });
  const byOpt = new Map<string, Post[]>();
  for (const p of list) if (p.option) byOpt.set(p.option, [...(byOpt.get(p.option) ?? []), p]);
  let total = 0;
  for (const o of poll.options) {
    const ps = byOpt.get(o.id) ?? [];
    total += o.count;
    push(`option ${o.id} count`, ps.length, o.count);
    for (const s of SOURCES) push(`option ${o.id} ${s}`, ps.filter((p) => p.source === s).length, o.by_source[s]);
    push(`option ${o.id} reddit+x`, o.count, o.by_source.reddit + o.by_source.x);
  }
  const known = new Set(poll.options.map((o) => o.id));
  const orphan = list.filter((p) => p.option && !known.has(p.option)).length;
  push("posts with an option not in the poll", 0, orphan);
  push("total_opinions", total, poll.total_opinions);
  for (const s of SOURCES) push(`sources.${s}.opinions`, list.filter((p) => p.option && p.source === s).length, poll.sources[s].opinions);
  const byId = new Map(list.map((p) => [p.id, p]));
  for (const t of themes) {
    const ps = t.post_ids.map((id) => byId.get(id)).filter((p): p is Post => !!p && !!p.option);
    push(`theme ${t.id} post_ids streamed`, t.post_ids.length, ps.length);
    push(`theme ${t.id} count`, ps.length, t.count);
    const opts = new Set([...Object.keys(t.by_option), ...ps.map((p) => p.option!)]);
    for (const o of opts) {
      const mine = ps.filter((p) => p.option === o);
      push(`theme ${t.id} by_option ${o}`, mine.length, t.by_option[o] ?? 0);
      if (t.by_option_source) for (const s of SOURCES) push(`theme ${t.id} ${o} ${s}`, mine.filter((p) => p.source === s).length, t.by_option_source[o]?.[s] ?? 0);
    }
    for (const s of SOURCES) push(`theme ${t.id} by_source ${s}`, ps.filter((p) => p.source === s).length, t.by_source[s]);
  }
  return issues;
}

/** Recomputes every theme count from its post ids and the posts' current options; drops ids that were never streamed. */
export function reconcileThemes(themes: Theme[], posts: Map<string, Post>, totalOpinions: number): Theme[] {
  return themes
    .map((t) => {
      const ps = t.post_ids.map((id) => posts.get(id)).filter((p): p is Post => !!p && !!p.option);
      const byOption: Record<string, number> = {};
      const byOptionSource: Record<string, Record<V3Source, number>> = {};
      for (const p of ps) {
        byOption[p.option!] = (byOption[p.option!] ?? 0) + 1;
        (byOptionSource[p.option!] ??= { reddit: 0, x: 0 })[p.source]++;
      }
      return {
        ...t,
        post_ids: ps.map((p) => p.id),
        count: ps.length,
        percent: totalOpinions ? Math.round((ps.length / totalOpinions) * 1000) / 10 : 0,
        by_option: byOption,
        by_option_source: byOptionSource,
        by_source: { reddit: ps.filter((p) => p.source === "reddit").length, x: ps.filter((p) => p.source === "x").length },
        option_ids: t.option_ids.filter((o) => (byOption[o] ?? 0) > 0),
        quotes: t.quotes.filter((q) => ps.some((p) => p.id === q.post_id)),
      };
    })
    .filter((t) => t.count > 0);
}
