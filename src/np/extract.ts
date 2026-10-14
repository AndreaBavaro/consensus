/**
 * Extraction pass (research runs, --extract): turns first-hand posts that describe the poster's own steps, problems,
 * workarounds, decisions or paid help into coded records. A record holds codes, links and checked paraphrases only.
 * Every claim must quote a short evidence span from the post; spans are checked against the text in memory and then
 * dropped, so no post text is ever stored.
 */
import { completeJson } from "../llm.ts";
import { CODEBOOK } from "./codebook.ts";
import { checkParaphrase } from "./quotes.ts";
import type { Post } from "../v3/types.ts";

export const WHAT = ["wrong_order", "missed_deadline", "wrong_document", "no_appointment", "appointment_cancelled", "long_wait", "no_response", "refused_by_office", "inconsistent_officials", "lost_status_while_waiting", "validity_gap", "status_reversed", "card_not_delivered", "cannot_travel", "portal_error", "unexpected_cost", "paid_help_failed", "account_frozen", "coverage_gap", "scam", "misread_rule", "other"] as const;
const OUTCOME = ["delay", "money_lost", "refused", "had_to_redo", "stuck", "resolved", "-"] as const;
export const FIX = ["lawyer", "agency_fixer", "went_in_person", "other_office", "called_or_emailed_repeatedly", "booked_before_flying", "used_receipt", "escalated_complaint", "requested_written_proof", "ombudsman", "appeal", "court_action", "tacit_approval", "resubmitted", "changed_route", "waited", "local_help", "online_portal", "paid_private", "other"] as const;
const FOUND_OUT = ["before", "at_office", "after", "-"] as const;
const TRIGGERS = ["cost_of_living_ca", "housing_ca", "winters", "politics", "career", "family_ties", "heritage_citizenship", "lifestyle", "healthcare", "retirement", "remote_work", "adventure", "safety", "kids_education"] as const;
const CRITERIA = ["cost", "climate", "language", "healthcare", "taxes", "visa_ease", "family", "safety", "lifestyle", "jobs", "english", "community"] as const;
const PAID = ["lawyer", "relocation_agent", "accountant_xborder", "translator", "apostille_service", "visa_agency", "fixer", "school_consultant", "other"] as const;
const WORTH = ["+", "-", "~", "?"] as const;
const HOUSEHOLD = ["solo", "couple", "family_kids", "retiree", "-"] as const;
const INCOME = ["remote_na", "local_job", "pension", "passive", "student", "-"] as const;
const ROUTE = ["citizenship_descent", "eu_family", "family_reunification", "golden_visa", "digital_nomad", "elective_residence", "d6", "d7", "d8", "non_lucrative", "visitor", "work_permit", "critical_skills", "stamp_1g", "student", "youth_mobility", "-"] as const;
const CONSULATE = ["toronto", "montreal", "vancouver", "ottawa", "other", "-"] as const;
const PASSPORTS = ["CA", "US", "EU_IT", "EU_IE", "EU_PT", "EU_ES", "EU_FR", "EU_OT", "UK", "OT"] as const;
const EMOTION = ["relief", "frustration", "anxiety", "regret", "joy", "isolation", "neutral"] as const;
const DESTS = ["IT", "IE", "PT", "ES", "FR"] as const;

type Of<T extends readonly string[]> = T[number];

export interface Incident {
  step: string;
  what: Of<typeof WHAT>;
  outcome: Of<typeof OUTCOME>;
  /** What finally worked (only when the poster says it worked). */
  fix: Of<typeof FIX> | null;
  /** Everything the poster tried, including what did not work. */
  tried: Of<typeof FIX>[];
  found_out: Of<typeof FOUND_OUT>;
  /** ≤25-word paraphrase that passed checkParaphrase, or null. */
  gist: string | null;
}

export interface ExtractRecord {
  /** 2: incidents carry tried vs worked fixes, advice to others is excluded, steps are distinct. */
  v: 2;
  post_id: string;
  url: string;
  thread_url: string | null;
  community: string | null;
  created_at: string | null;
  score: number;
  handle: string;
  /** Destination the post is about (from the poster tags or the steps), CA for Canada-exit posts, "-" if unclear. */
  country: string;
  phase: string;
  firsthand: string;
  who: { household: Of<typeof HOUSEHOLD>; partner_non_eu: boolean | null; passports: Of<typeof PASSPORTS>[]; income: Of<typeof INCOME>; route: Of<typeof ROUTE>; consulate: Of<typeof CONSULATE>; region: string | null };
  incidents: Incident[];
  /** Step codes in the order the poster says they did them. */
  steps: string[];
  triggers: Of<typeof TRIGGERS>[];
  chose: { picked: string; over: string[]; because: Of<typeof CRITERIA>[] } | null;
  paid_for: { what: Of<typeof PAID>; worth: Of<typeof WORTH> }[];
  emotion: Of<typeof EMOTION>;
  valence: "+" | "-" | "~";
  /** Mentions a rule that has changed (NHR, AIMA, DL36/2025, EES): context, not current experience. */
  rule_dependent: boolean;
  /** Contains a fee, wait or threshold: goes to "facts to verify", never published. */
  has_fact_claim: boolean;
  /** Share of evidence spans found verbatim in the post (checked in memory). */
  grounded: number;
}

type TextPost = Pick<Post, "id" | "url" | "thread_url" | "community" | "created_at" | "score" | "tags"> & { text: string; author: { handle: string } };

const pick = <T extends readonly string[]>(list: T, v: unknown, fallback: T[number]): T[number] => (typeof v === "string" && (list as readonly string[]).includes(v) ? v : fallback);
const picks = <T extends readonly string[]>(list: T, v: unknown): T[number][] => [...new Set((Array.isArray(v) ? v : []).filter((x): x is T[number] => typeof x === "string" && (list as readonly string[]).includes(x)))];
const stepCode = (v: unknown) => (typeof v === "string" && v in CODEBOOK ? v : "other");
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

const MIN_GROUNDED = 0.6;

/** Cleans one model record against the vocabularies and the post text; null when too little of it is grounded. */
export function validateRecord(raw: any, post: TextPost): ExtractRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const text = norm(post.text);
  let spans = 0;
  let found = 0;
  /** Each claim carries an evidence span; ungrounded claims are dropped and counted against the record. */
  const grounded = (x: any) => {
    spans++;
    const ok = typeof x?.evidence === "string" && x.evidence.trim().length >= 3 && text.includes(norm(x.evidence));
    if (ok) found++;
    return ok;
  };
  const incidents: Incident[] = (Array.isArray(raw.incidents) ? raw.incidents : [])
    .slice(0, 3)
    .filter(grounded)
    // Advice to the reader ("hire a lawyer") is not something that happened to the poster.
    .filter((x: any) => x.own !== false)
    .map((x: any) => {
      const gist = typeof x.gist === "string" && x.gist.trim() && checkParaphrase(post.text, x.gist.trim()).ok ? x.gist.trim() : null;
      const fix = x.fix == null ? null : pick(FIX, x.fix, "other");
      const worked = x.worked === true;
      const tried = picks(FIX, [...(Array.isArray(x.tried) ? x.tried : []), ...(fix && !worked ? [fix] : [])]);
      return { step: stepCode(x.step), what: pick(WHAT, x.what, "other"), outcome: pick(OUTCOME, x.outcome, "-"), fix: worked ? fix : null, tried, found_out: pick(FOUND_OUT, x.found_out, "-"), gist };
    });
  // Distinct steps in first-mentioned order; "other" says nothing about the order.
  const steps = [...new Set((Array.isArray(raw.steps) ? raw.steps : []).filter(grounded).map((x: any) => stepCode(x.step)))].filter((x) => x !== "other") as string[];
  const paid_for = (Array.isArray(raw.paid_for) ? raw.paid_for : []).filter(grounded).map((x: any) => ({ what: pick(PAID, x.what, "other"), worth: pick(WORTH, x.worth, "?") }));
  const triggerList = (Array.isArray(raw.triggers) ? raw.triggers : []).filter((x: any) => typeof x === "object" && grounded(x));
  const triggers = picks(TRIGGERS, triggerList.map((x: any) => x.code));
  const chose = raw.chose && typeof raw.chose === "object" && grounded(raw.chose) && pick(DESTS, raw.chose.picked, "IT") === raw.chose.picked
    ? { picked: raw.chose.picked as string, over: picks(DESTS, raw.chose.over), because: picks(CRITERIA, raw.chose.because) }
    : null;
  if (!spans || found / spans < MIN_GROUNDED) return null;
  const who = raw.who ?? {};
  const region = typeof who.region === "string" && /^[\p{L} .'-]{2,40}$/u.test(who.region.trim()) ? who.region.trim().toLowerCase() : null;
  const tags = post.tags;
  const stepCountry = [...incidents.map((i) => i.step), ...steps].find((s) => s !== "other")?.split(":")[0]?.toUpperCase();
  return {
    v: 2,
    post_id: post.id,
    url: post.url,
    thread_url: post.thread_url ?? null,
    community: post.community ?? null,
    created_at: post.created_at ?? null,
    score: post.score,
    handle: post.author.handle,
    country: tags?.dest && tags.dest !== "-" && tags.dest !== "OT" ? tags.dest : (stepCountry ?? "-"),
    phase: tags?.phase ?? "-",
    firsthand: tags?.firsthand ?? "-",
    who: {
      household: pick(HOUSEHOLD, who.household, "-"),
      partner_non_eu: typeof who.partner_non_eu === "boolean" ? who.partner_non_eu : null,
      passports: picks(PASSPORTS, who.passports),
      income: pick(INCOME, who.income, "-"),
      route: pick(ROUTE, who.route, "-"),
      consulate: pick(CONSULATE, who.consulate, "-"),
      region,
    },
    incidents,
    steps,
    triggers,
    chose,
    paid_for,
    emotion: pick(EMOTION, raw.emotion, "neutral"),
    valence: pick(["+", "-", "~"] as const, raw.valence, "~"),
    rule_dependent: raw.rule_dependent === true,
    has_fact_claim: raw.has_fact_claim === true,
    grounded: Math.round((found / spans) * 1000) / 1000,
  };
}

export function extractPrompt(query: string, posts: TextPost[]): string {
  const steps = Object.entries(CODEBOOK).map(([k, v]) => `${k} = ${v.label}`).join("\n");
  return `Research question: "${query}"
Each post below is by someone describing their OWN move (to or within Italy, Ireland, Portugal, Spain or France, or leaving Canada). Code what THEY say happened to them. Never guess: leave a field empty, null or "-" when the post does not say it.

For EVERY incident, step, paid-for item, trigger and choice, add "evidence": 3 to 12 words copied EXACTLY from the post that show it. Claims without exact evidence are discarded.

Fields per post:
- who, ONLY what the post states (never guess from tone; "my wife" or "my husband" = couple, "our kids" = family_kids): household (${HOUSEHOLD.join("|")}), partner_non_eu (true|false|null), passports (${PASSPORTS.join("|")}), income (${INCOME.join("|")}), route (${ROUTE.join("|")}; use the exact visa named, e.g. a D6 is d6, not d8), consulate (${CONSULATE.join("|")}), region (city or region named, or null)
- incidents (0 to 3 things that went wrong FOR THE POSTER): step (a code below; for renewals use the renewal code), what (${WHAT.join("|")}), outcome (${OUTCOME.join("|")}), own (true only if it happened to the poster or their household; advice to the reader such as "go in person" or "hire a lawyer" is own=false), tried (everything they tried: ${FIX.join("|")}), fix (the one thing that finally resolved it, or null), worked (true only if the poster says the fix resolved it), found_out (${FOUND_OUT.join("|")}), gist (your own words, at most 25 words, third person; never copy 8 words in a row; only numbers and names that appear in the post), evidence
- steps: the DISTINCT steps they took, in the order they took them, each {step, evidence}; empty if they give no order; never repeat a step
- triggers: why they MOVED ABROAD (not why they stay, and not why they chose a lawyer), each {code: ${TRIGGERS.join("|")}, evidence}; usually empty
- chose: {picked: ${DESTS.join("|")}, over: [...], because: [${CRITERIA.join("|")}], evidence} or null
- paid_for: help they paid for, each {what: ${PAID.join("|")}, worth: +|-|~|?, evidence}
- emotion (${EMOTION.join("|")}), valence (+|-|~)
- rule_dependent: true if it depends on a rule that has changed (NHR, AIMA, golden visa, Italy's 2025 citizenship decree, EES)
- has_fact_claim: true if it states a fee, a waiting time or a threshold

Step codes:
${steps}

Posts:
${posts.map((p, i) => `[${i}] ${p.text.replace(/\s+/g, " ").slice(0, 2000)}`).join("\n")}

Return {"items":[{"i":0,"who":{...},"incidents":[...],"steps":[...],"triggers":[...],"chose":null,"paid_for":[...],"emotion":"...","valence":"~","rule_dependent":false,"has_fact_claim":false}]}.`;
}

export const EXTRACT_BATCH = 10;

export interface ExtractOptions {
  complete?: (prompt: string, schema: object | undefined, opts: object) => Promise<{ items?: any[] }>;
  query?: string;
  signal?: AbortSignal;
}

/** One call per batch of 10; records that fail grounding are rejected and counted, failed calls are counted. */
export async function extractRecords(posts: TextPost[], o: ExtractOptions = {}): Promise<{ records: ExtractRecord[]; rejected: number; failed_batches: number }> {
  const complete = o.complete ?? ((p, s, opts) => completeJson<{ items?: any[] }>(p, s, opts, 1));
  const records: ExtractRecord[] = [];
  let rejected = 0;
  let failed = 0;
  const batches = Array.from({ length: Math.ceil(posts.length / EXTRACT_BATCH) }, (_, b) => posts.slice(b * EXTRACT_BATCH, (b + 1) * EXTRACT_BATCH));
  await Promise.all(
    batches.map(async (batch) => {
      let got: { items?: any[] } = {};
      try {
        got = await complete(extractPrompt(o.query ?? "", batch), undefined, { maxTokens: 450 * batch.length + 300, timeoutMs: 60_000, signal: o.signal });
      } catch {
        failed++;
        return;
      }
      batch.forEach((p, i) => {
        const r = validateRecord((got.items ?? []).find((x) => x?.i === i), p);
        if (r) records.push(r);
        else rejected++;
      });
    }),
  );
  return { records, rejected, failed_batches: failed };
}
