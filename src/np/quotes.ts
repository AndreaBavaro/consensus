/**
 * Quote-bank rows for New Postcode research. The quoting rule allows close paraphrases of 25 words or fewer, checked
 * against the original text, so a row never carries post text. Paraphrases are written while the run's posts are in
 * memory; the original text is never saved.
 */
import { completeJson } from "../llm.ts";
import { meterStore, newMeter } from "../lib/meter.ts";
import type { Post, PostTags } from "../v3/types.ts";

export type Sentiment = "+" | "-" | "~";

export interface QuoteRow {
  post_id: string;
  option: string;
  paraphrase: string;
  sentiment: Sentiment;
  community: string | null;
  /** YYYY-MM-DD of the post. */
  date: string | null;
  handle: string;
  url: string;
  /** Destination country, or CA when the post is about the Canada side, EU when it names none. */
  country: string;
  phase: string;
}

const MAX_WORDS = 25;
const RUN = 8;
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
const numbers = (s: string) => new Set((s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, "")));

/**
 * Deterministic check of one paraphrase: at most 25 words, no run of 8 words copied from the original, and no digits
 * or capitalised names (beyond each sentence's first word) that the original does not contain.
 */
export function checkParaphrase(original: string, paraphrase: string): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const pw = words(paraphrase);
  if (pw.length > MAX_WORDS) reasons.push("too_long");
  const ow = words(original);
  const grams = new Set<string>();
  for (let i = 0; i + RUN <= ow.length; i++) grams.add(ow.slice(i, i + RUN).join(" "));
  for (let i = 0; i + RUN <= pw.length; i++)
    if (grams.has(pw.slice(i, i + RUN).join(" "))) {
      reasons.push("verbatim_run");
      break;
    }
  const on = numbers(original);
  if ([...numbers(paraphrase)].some((n) => !on.has(n))) reasons.push("invented_number");
  const lowerOrig = original.toLowerCase();
  const names = paraphrase
    .split(/(?<=[.!?;:])\s+/)
    .flatMap((sentence) => (sentence.match(/[\p{L}\p{N}']+/gu) ?? []).slice(1))
    .filter((w) => /^\p{Lu}/u.test(w) && w !== "I");
  if (names.some((n) => !lowerOrig.includes(n.toLowerCase()))) reasons.push("invented_name");
  return { ok: reasons.length === 0, reasons };
}

type TextPost = Post & { text: string };

/** Strength-3 posts by first-hand posters (S own experience, L locals), best relevance first, `perOption` per option. */
export function selectQuotes(posts: TextPost[], perOption: number): TextPost[] {
  const picked = new Map<string, TextPost[]>();
  const eligible = posts
    .filter((p) => p.option && p.strength === 3 && (p.tags?.firsthand === "S" || p.tags?.firsthand === "L"))
    .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0) || b.rank - a.rank);
  for (const p of eligible) {
    const list = picked.get(p.option!) ?? picked.set(p.option!, []).get(p.option!)!;
    if (list.length < perOption) list.push(p);
  }
  return [...picked.values()].flat();
}

const PHASE: Record<string, string> = { P: "planning", A: "arriving", Y: "first-year", E: "settled", R: "returned", X: "leaving-Canada" };
const countryOf = (t?: PostTags) => (t?.dest && t.dest !== "-" ? t.dest : t?.origin === "CA" ? "CA" : "EU");

const SCHEMA = {
  type: "object",
  properties: { items: { type: "array", items: { type: "object", properties: { i: { type: "integer" }, paraphrase: { type: "string" }, sentiment: { type: "string", enum: ["+", "-", "~"] } }, required: ["i", "paraphrase", "sentiment"] } } },
  required: ["items"],
};

function prompt(query: string, posts: TextPost[], retry: boolean): string {
  return `Research question: "${query}"
For each post below, write ONE close paraphrase in English of what the poster says about their own experience, 25 words or fewer, third person, present tense ("Moved from Calgary; says ..."). Rules:
- Your own words: never copy 8 or more words in a row from the post.
- Keep every fact exactly: only use numbers, places and names that appear in the post. Never add a number, place, name or detail the post does not contain.
- No usernames, no real names of people.
sentiment: "+" positive about the move or place, "-" negative, "~" mixed.${retry ? "\nThese are second attempts: the first paraphrases copied the post, ran too long, or added a number or name. Paraphrase more loosely and shorter." : ""}

Posts:
${posts.map((p, i) => `[${i}] ${p.text.replace(/\s+/g, " ").slice(0, 1500)}`).join("\n")}

Return {"items":[{"i":0,"paraphrase":"...","sentiment":"+"}]}.`;
}

export interface BuildQuotesOptions {
  perOption: number;
  /** LLM call; defaults to the configured gateway. Tests pass a fake. */
  complete?: (prompt: string, schema: object, opts: object) => Promise<{ items?: { i?: number; paraphrase?: string; sentiment?: string }[] }>;
  signal?: AbortSignal;
}

/** One LLM call for the whole batch, one retry call for the rejects, then rejects are dropped and counted. */
export async function buildQuotes(query: string, posts: TextPost[], o: BuildQuotesOptions): Promise<{ rows: QuoteRow[]; dropped: number }> {
  const complete = o.complete ?? ((p, s, opts) => completeJson(p, s, opts, 1));
  const chosen = selectQuotes(posts, o.perOption);
  const rows = new Map<string, QuoteRow>();
  let todo = chosen;
  for (let attempt = 0; attempt < 2 && todo.length; attempt++) {
    let got: Awaited<ReturnType<NonNullable<BuildQuotesOptions["complete"]>>> = {};
    try {
      got = await complete(prompt(query, todo, attempt > 0), SCHEMA, { maxTokens: 80 * todo.length + 200, timeoutMs: 30_000, signal: o.signal });
    } catch {
      got = {};
    }
    const failed: TextPost[] = [];
    todo.forEach((p, i) => {
      const item = (got.items ?? []).find((x) => x.i === i);
      const para = item?.paraphrase?.trim();
      if (!para || !checkParaphrase(p.text, para).ok) return failed.push(p);
      rows.set(p.id, {
        post_id: p.id,
        option: p.option!,
        paraphrase: para,
        sentiment: item!.sentiment === "+" || item!.sentiment === "-" ? item!.sentiment : "~",
        community: p.community,
        date: p.created_at?.slice(0, 10) ?? null,
        handle: p.author.handle,
        url: p.url,
        country: countryOf(p.tags),
        phase: PHASE[p.tags?.phase ?? ""] ?? "-",
      });
    });
    todo = failed;
  }
  return { rows: chosen.flatMap((p) => rows.get(p.id) ?? []), dropped: todo.length };
}

const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

/** `| # | paraphrase | r/sub · YYYY-MM-DD · u/handle | link | COUNTRY · phase · sentiment |` */
export function formatQuoteRow(n: number, q: QuoteRow): string {
  return `| ${n} | ${cell(q.paraphrase)} | ${q.community ?? "reddit"} · ${q.date ?? "undated"} · u/${q.handle} | ${q.url} | ${q.country} · ${q.phase} · ${q.sentiment} |`;
}

/** Posts as last streamed (refine passes re-send moved posts), with their in-memory text. */
export function postsFromEvents(events: { event: string; data: any }[]): TextPost[] {
  const byId = new Map<string, TextPost>();
  for (const e of events) if (e.event === "posts") for (const p of e.data.posts) byId.set(p.id, { ...byId.get(p.id), ...p });
  return [...byId.values()].filter((p) => typeof p.text === "string");
}

/** Appends a `quotes` event (rows hold paraphrases and links only) to a finished run's events. */
export async function addQuotes(query: string, events: { event: string; data: any }[], perOption: number, complete?: BuildQuotesOptions["complete"]): Promise<number> {
  // Metered on its own: this call happens after the run's `done`, so its spend is reported here and added by the caller.
  const m = newMeter();
  const r = await meterStore.run(m, () => buildQuotes(query, postsFromEvents(events), { perOption, complete }));
  const cost_usd = Math.round(m.llmUsd * 10_000) / 10_000;
  events.push({ event: "quotes", data: { ...r, cost_usd } });
  return cost_usd;
}
