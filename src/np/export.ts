/**
 * Section 6 exporter (BRIEF-CONSENSUS.md): saved runs -> Markdown with the polls table, a block per question, the
 * quote-bank rows, facts to verify, and the thin/empty/error log. Works offline from saved files.
 */
import { addQuotes, formatQuoteRow, postsFromEvents, type QuoteRow } from "./quotes.ts";
import { aggregate, toSidecar } from "./aggregate.ts";
import type { ExtractRecord } from "./extract.ts";

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

  const records = runs.flatMap(extractRecordsOf);
  if (records.length) out.push("", ...extractSection(records));

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

const extractRecordsOf = (r: LoadedRun): ExtractRecord[] => r.events.filter((e) => e.event === "extract").flatMap((e) => e.data.records ?? []);

export const WHAT_LABEL: Record<string, string> = {
  wrong_order: "steps done in the wrong order", missed_deadline: "missed deadlines", wrong_document: "wrong or missing documents", no_appointment: "no appointments available",
  long_wait: "long waits", no_response: "no response from the office", appointment_cancelled: "appointments cancelled", validity_gap: "a gap between permits", status_reversed: "a decision reversed", card_not_delivered: "the card never arriving", cannot_travel: "being unable to travel while waiting",
  portal_error: "online portal errors", paid_help_failed: "paid help that did not deliver", refused_by_office: "refusals at the office", inconsistent_officials: "officials giving different answers", lost_status_while_waiting: "status lapsing while waiting",
  unexpected_cost: "unexpected costs", account_frozen: "frozen or closed accounts", coverage_gap: "gaps in health coverage", scam: "scams", misread_rule: "misreading the rule", other: "other problems",
};
export const FIX_LABEL: Record<string, string> = {
  lawyer: "hiring a lawyer", agency_fixer: "using an agency or fixer", went_in_person: "going in person", other_office: "trying another office", called_or_emailed_repeatedly: "calling or emailing repeatedly",
  booked_before_flying: "booking before flying", used_receipt: "relying on the application receipt", escalated_complaint: "escalating a complaint", requested_written_proof: "asking for written proof", ombudsman: "going to the ombudsman", appeal: "filing an appeal", court_action: "taking court action", tacit_approval: "relying on tacit approval", resubmitted: "resubmitting the application", changed_route: "changing route", waited: "waiting it out",
  local_help: "help from a local", online_portal: "using the online portal", paid_private: "paying for a private option", other: "another workaround",
};
const singular = (s: string) => s.replace(/^long waits$/, "long wait");

/** Research-file sections for extraction: ranked incidents with fixes, paraphrased examples, and draft publication themes. */
function extractSection(records: ExtractRecord[]): string[] {
  const a = aggregate(records);
  const out = [
    "## Extracted experiences",
    "",
    `${a.first_hand_posts} first-hand posts coded from ${a.saturation.threads} threads; ${Math.round(a.saturation.new_in_last_two * 100)}% of incident types first appeared in the last two threads (lower = closer to saturation).`,
    "",
    "| Step | What went wrong | Threads | Posts | Last 24 months | Worked | Tried |",
    "|---|---|---|---|---|---|---|",
    ...a.incidents.map((i) => `| ${i.step_label} | ${singular(WHAT_LABEL[i.what] ?? i.what)} | ${i.threads} | ${i.posts} | ${i.recent_posts} | ${i.fixes.map((f) => `${f.fix} (${f.posts})`).join(", ") || "-"} | ${i.tried.map((f) => `${f.fix} (${f.posts})`).join(", ") || "-"} |`),
    "",
    "Examples (paraphrased, internal only):",
    ...records.flatMap((r) => r.incidents.filter((i) => i.gist).map((i) => `- ${i.gist} ${r.url} (${r.created_at?.slice(0, 10) ?? "undated"}${r.rule_dependent ? ", depends on a changed rule" : ""})`)).slice(0, 30),
  ];
  for (const [country, steps] of Object.entries(a.order)) out.push("", `Usual order stated by movers (${country}): ${steps.map((s) => s.step).join(" → ")}`);
  if (a.paid_for.length) out.push("", "Paid help: " + a.paid_for.map((p) => `${p.what} (${p.posts}; worth it + ${p.worth["+"]} / - ${p.worth["-"]} / ~ ${p.worth["~"]} / unknown ${p.worth["?"]})`).join(", "));
  // Plain-language candidates only: no counts, no frequency words (anecdotes stay anecdotes).
  const themes = a.incidents
    .filter((i) => i.threads >= 2)
    .slice(0, 8)
    .map((i) => {
      // Waiting it out or an unnamed workaround is not advice anyone can act on.
      const fix = i.fixes.find((f) => f.fix !== "waited" && f.fix !== "other");
      return `- ${i.step_label}: ${WHAT_LABEL[i.what] ?? i.what}.${fix ? ` A fix movers describe: ${FIX_LABEL[fix.fix] ?? fix.fix}.` : ""}`;
    });
  out.push("", "## Themes for publication (draft, needs human wording)", "", ...(themes.length ? themes : ["None reported in two or more threads yet."]));
  return out;
}

/** Sidecar for newpostcode/data/forum/<batch>.json from every extract event in the given runs. */
export function sidecarFor(runs: LoadedRun[], batch: string, o: { timelineIds?: string[]; runDate: string }) {
  return toSidecar(batch, aggregate(runs.flatMap(extractRecordsOf)), o);
}
