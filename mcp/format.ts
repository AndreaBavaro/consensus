import type { Poll, Post, Reason, V3Event, V3Source } from "../src/v3/types.ts";

export const SITE = "https://useconsensus.io";

export interface Quote {
  text: string;
  author: string;
  source: V3Source;
  community: string | null;
  score: number;
  url: string;
}

export interface SummaryOption {
  id: string;
  title: string;
  description: string;
  percent: number;
  count: number;
  by_source: Record<V3Source, number>;
  /** One-sentence reason written by the pipeline (`reasons` event), when available. */
  why: string | null;
  quotes: Quote[];
}

export interface Summary {
  id: string | null;
  query: string | null;
  url: string | null;
  cached_at: string | null;
  since: string | null;
  until: string | null;
  sources: V3Source[];
  total_opinions: number;
  reddit: { threads: number; opinions: number };
  x: { posts: number; opinions: number };
  options: SummaryOption[];
  /** Named picks that were too small to be their own option. */
  other_breakdown: { title: string; count: number }[];
  status: string | null;
  cost_usd: number | null;
  error: string | null;
}

/** Repairs UTF-8 text that was decoded as Latin-1 somewhere upstream ("â€™" -> "’"). */
export function fixMojibake(s: string): string {
  if (!/[ÃâÂ][\u0080-¿]/.test(s)) return s;
  const fixed = Buffer.from(s, "latin1").toString("utf8");
  return fixed.includes("�") ? s : fixed;
}

const byRelevance = (a: Post, b: Post) => (b.relevance ?? 0) - (a.relevance ?? 0) || b.rank - a.rank || b.score - a.score;

/** Reduces a recorded event stream to the final poll with one reason and a few quotes per option. */
export function summarize(events: V3Event[], opts: { quotesPerOption?: number } = {}): Summary {
  const quotesPerOption = opts.quotesPerOption ?? 4;
  let meta: Record<string, any> | null = null;
  let poll: Poll | null = null;
  let done: Record<string, any> | null = null;
  let error: string | null = null;
  const reasons = new Map<string, Reason>();
  const posts = new Map<string, Post>();

  for (const e of events) {
    const d = e.data as any;
    switch (e.event) {
      case "meta":
        meta = d;
        break;
      case "poll":
        // Later polls are more complete; the final one carries `final: true`.
        if (!poll || !poll.final || d.final) poll = d as Poll;
        break;
      case "reasons":
        reasons.set((d as Reason).option_id, d as Reason);
        break;
      case "posts":
        for (const p of (d as { posts: Post[] }).posts) posts.set(p.id, p); // last version of a post wins (Other splits re-sort)
        break;
      case "done":
        done = d;
        break;
      case "error":
        error = d?.message ?? String(d);
        break;
    }
  }

  const options: SummaryOption[] = (poll?.options ?? [])
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((o) => {
      const own = [...posts.values()].filter((p) => p.option === o.id && p.strength >= 1).sort(byRelevance);
      return {
        id: o.id,
        title: o.title,
        description: o.description,
        percent: o.percent,
        count: o.count,
        by_source: o.by_source,
        why: reasons.get(o.id)?.summary ? fixMojibake(reasons.get(o.id)!.summary) : null,
        quotes: own.slice(0, quotesPerOption).map((p) => ({
          text: fixMojibake(p.text).replace(/\s+/g, " ").trim().slice(0, 400),
          author: p.source === "reddit" ? `u/${p.author.handle}` : `@${p.author.handle}`,
          source: p.source,
          community: p.community,
          score: p.score,
          url: p.url,
        })),
      };
    });

  const id = meta?.id ?? done?.id ?? null;
  const query = meta?.query ?? null;
  return {
    id,
    query,
    url: id ? `${SITE}/search?id=${id}${query ? `&q=${encodeURIComponent(query)}` : ""}` : null,
    cached_at: meta?.cached_at ?? null,
    since: meta?.since ?? null,
    until: meta?.until ?? null,
    sources: meta?.sources ?? [],
    total_opinions: poll?.total_opinions ?? 0,
    reddit: poll?.sources.reddit ?? { threads: 0, opinions: 0 },
    x: poll?.sources.x ?? { posts: 0, opinions: 0 },
    options,
    other_breakdown: poll?.other_breakdown ?? [],
    status: done?.status ?? null,
    cost_usd: typeof done?.cost?.total_usd === "number" ? done.cost.total_usd : null,
    error,
  };
}

/** Compact Markdown for the tool's text block; the full object goes in `structuredContent`. */
export function toMarkdown(s: Summary): string {
  const lines: string[] = [];
  if (s.query) lines.push(`# ${s.query}`);
  const window = s.since || s.until ? ` · window ${s.since ?? "…"} to ${s.until ?? "today"}` : "";
  lines.push(`${s.total_opinions} opinions from ${s.reddit.threads} Reddit threads and ${s.x.posts} X posts${window}${s.url ? ` · ${s.url}` : ""}`);
  if (s.error) lines.push(`\nError: ${s.error}`);
  for (const o of s.options) {
    lines.push(`\n## ${o.title} — ${o.percent}% (${o.count})`);
    if (o.why) lines.push(o.why);
    for (const q of o.quotes) lines.push(`- "${q.text}" — ${q.author}${q.community ? ` in ${q.community}` : ""} (${q.score} ${q.source === "reddit" ? "points" : "likes"}) ${q.url}`);
  }
  if (s.other_breakdown.length) lines.push(`\nAlso mentioned: ${s.other_breakdown.map((b) => `${b.title} (${b.count})`).join(", ")}`);
  if (s.cost_usd != null) lines.push(`\nSearch cost: $${s.cost_usd.toFixed(3)}${s.status ? ` · status ${s.status}` : ""}`);
  return lines.join("\n");
}
