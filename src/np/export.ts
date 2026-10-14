/**
 * Section 6 exporter (BRIEF-CONSENSUS.md): saved runs -> Markdown with the polls table, a block per question, the
 * quote-bank rows, facts to verify, and the thin/empty/error log. Works offline from saved files.
 */
import { addQuotes, formatQuoteRow, postsFromEvents, type QuoteRow } from "./quotes.ts";

export interface LoadedRun {
  query: string;
  since: string | null;
  until: string | null;
  store: string | null;
  events: { event: string; data: any }[];
}

/** Research files ({query, store, events}), old batch files ({query, since, events}) and bare event arrays (--out). */
export function loadRun(raw: any): LoadedRun {
  const events = Array.isArray(raw) ? raw : (raw.events ?? []);
  const meta = events.find((e: any) => e.event === "meta")?.data ?? {};
  return { query: raw.query ?? meta.query ?? "(unknown question)", since: raw.since ?? meta.since ?? null, until: raw.until ?? meta.until ?? null, store: raw.store ?? null, events };
}

const OTHER_FLAG_PCT = 15;
/** Money, fees and waits: claims in anecdotes that must be checked on an official page before use. */
const FACT_RE = /[$€£]|\b\d[\d,.]*\s*(k|euros?|eur|dollars?|cad|usd)\b|\bfees?\b|\bcosts?\b|\btax(es)?\b|\brent\b|\bsalar(y|ies)\b|\b(days?|weeks?|months?|years?)\b[^.]*\bwait|\bwait[^.]*\b(days?|weeks?|months?)\b|\b\d+\s*(days?|weeks?|months?)\b/i;

const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const money = (n: number) => `$${n.toFixed(4)}`;

function view(r: LoadedRun) {
  const ev = r.events;
  const meta = ev.find((e) => e.event === "meta")?.data ?? {};
  const final = [...ev].reverse().find((e) => e.event === "poll" && e.data.final)?.data ?? [...ev].reverse().find((e) => e.event === "poll")?.data;
  const done = ev.find((e) => e.event === "done")?.data ?? {};
  const quotes = ev.find((e) => e.event === "quotes")?.data as { rows: QuoteRow[]; dropped: number; cost_usd?: number } | undefined;
  const reasons = new Map<string, string>(ev.filter((e) => e.event === "reasons").map((e) => [e.data.option_id, e.data.summary]));
  const options: any[] = final?.options ?? [];
  const other = options.find((o) => o.is_other);
  const cost = Number(done.cost?.total_usd ?? 0) + Number(done.cost?.oxylabs_usd ?? 0) + Number(quotes?.cost_usd ?? 0);
  return {
    id: done.id ?? meta.id ?? null,
    date: (meta.started_at ?? "").slice(0, 10) || "unknown",
    status: done.status ?? "unknown",
    errorReason: done.error_reason ?? null,
    flags: (done.quality?.flags ?? []) as string[],
    opinions: final?.total_opinions ?? 0,
    threads: final?.sources?.reddit?.threads ?? 0,
    options,
    otherPct: other?.percent ?? 0,
    subset: final?.subsets?.first_hand_na as { total: number; options: { id: string; percent: number }[] } | undefined,
    reasons,
    quotes,
    cost,
  };
}

export function exportMarkdown(runs: LoadedRun[], o: { quoteStart: number }): string {
  const views = runs.map((r) => ({ r, v: view(r) }));
  const out: string[] = [];
  out.push("## Polls", "", "| Question | Opinions | Threads | Top 3 options | Id | Cost | Date run | Status | Other % | Flag |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const { r, v } of views) {
    const top = v.options.filter((x) => !x.is_other).slice(0, 3).map((x) => `${cell(x.title)} ${x.percent}%`).join(" · ") || "-";
    const flag = v.otherPct > OTHER_FLAG_PCT ? "⚠ Other >15%" : "";
    out.push(`| ${cell(r.query)} | ${v.opinions} | ${v.threads} | ${top} | ${v.id ?? "-"} | ${money(v.cost)} | ${v.date} | ${v.status} | ${v.otherPct}% | ${flag} |`);
  }

  out.push("", "## Per question");
  let n = o.quoteStart;
  const facts: string[] = [];
  const log: string[] = [];
  for (const { r, v } of views) {
    if (v.status !== "ok") log.push(`- ${r.query}: ${v.status}${v.errorReason ? ` (${v.errorReason})` : ""}, ${v.opinions} opinions${v.flags.length ? `; flags ${v.flags.join(", ")}` : ""}`);
    if (!v.options.length) continue;
    out.push("", `### ${r.query}`, "", "| Option | % | Count | Why | First-hand NA % | Recent share |", "|---|---|---|---|---|---|");
    for (const x of v.options) {
      const sub = v.subset?.options.find((s) => s.id === x.id);
      const why = v.reasons.get(x.id);
      out.push(`| ${cell(x.title)} | ${x.percent}% | ${x.count} | ${why ? cell(why) : "-"} | ${sub ? `${sub.percent}% of ${v.subset!.total}` : "-"} | ${typeof x.recent_share === "number" ? `${Math.round(x.recent_share * 100)}%` : "-"} |`);
      if (why && FACT_RE.test(why)) facts.push(`- [ ] "${cell(why)}" (why line, ${cell(x.title)}): ${r.query}`);
    }
    if (!v.quotes) {
      log.push(`- ${r.query}: paraphrases missing (run np-export with --paraphrase on a full-store file)`);
      continue;
    }
    if (!v.quotes.rows.length) continue;
    out.push("", "| # | Paraphrase (≤25 words) | Where · date | Link | Tags |", "|---|---|---|---|---|");
    const order = new Map(v.options.map((x, i) => [x.id, i]));
    for (const q of [...v.quotes.rows].sort((a, b) => (order.get(a.option) ?? 99) - (order.get(b.option) ?? 99))) {
      out.push(formatQuoteRow(n, q));
      if (FACT_RE.test(q.paraphrase)) facts.push(`- [ ] #${n} "${cell(q.paraphrase)}" ${q.url} (${q.date ?? "undated"}): verify on the official page`);
      n++;
    }
    if (v.quotes.dropped) out.push("", `${v.quotes.dropped} paraphrase(s) failed the check twice and were dropped.`);
  }

  out.push("", "## Facts to verify", "", ...(facts.length ? facts : ["None surfaced."]));
  out.push("", "## Thin, empty and error runs", "", ...(log.length ? log : ["None."]));
  return `${out.join("\n")}\n`;
}

/**
 * Paraphrases runs that have no quotes event yet. Only with --paraphrase (it spends), and only for runs saved with
 * post text (store full); a links-only run has no text to paraphrase from and is listed instead.
 */
export async function fillMissingQuotes(runs: LoadedRun[], o: { paraphrase: boolean; perOption: number; complete?: Parameters<typeof addQuotes>[3] }): Promise<{ spentUsd: number; skippedNoText: string[] }> {
  let spentUsd = 0;
  const skippedNoText: string[] = [];
  if (!o.paraphrase) return { spentUsd, skippedNoText };
  for (const r of runs) {
    if (r.events.some((e) => e.event === "quotes")) continue;
    if (!postsFromEvents(r.events).length) {
      skippedNoText.push(r.query);
      continue;
    }
    spentUsd += await addQuotes(r.query, r.events, o.perOption, o.complete);
  }
  return { spentUsd, skippedNoText };
}
