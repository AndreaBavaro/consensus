/** Step 7: section-6 Markdown from saved runs, offline. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { exportMarkdown, loadRun } from "../src/np/export.ts";

const GOLDEN = new URL("./fixtures/np-export.golden.md", import.meta.url);
const url = (i: number) => `https://www.reddit.com/r/PortugalExpats/comments/abc/x/c${i}/`;

export const okRun = {
  query: "Canadians who moved to Portugal, do you regret it",
  store: "links",
  events: [
    { event: "meta", data: { id: "AbCdEfGh12345678", query: "Canadians who moved to Portugal, do you regret it", started_at: "2026-10-14T09:00:00.000Z" } },
    { event: "plan", data: { options: [{ id: "o0", title: "No regrets" }, { id: "o1", title: "Regret it" }, { id: "other", title: "Other", is_other: true }] } },
    {
      event: "poll",
      data: {
        final: true,
        total_opinions: 40,
        sources: { reddit: { threads: 7, opinions: 40 }, x: { posts: 0, opinions: 0 } },
        options: [
          { id: "o0", title: "No regrets", count: 24, percent: 60, is_other: false, recent_share: 0.75 },
          { id: "o1", title: "Regret it", count: 9, percent: 22.5, is_other: false, recent_share: 0.333 },
          { id: "other", title: "Other", count: 7, percent: 17.5, is_other: true, recent_share: 0.5 },
        ],
        subsets: { first_hand_na: { total: 20, options: [{ id: "o0", count: 14, percent: 70 }, { id: "o1", count: 5, percent: 25 }, { id: "other", count: 1, percent: 5 }] } },
      },
    },
    { event: "reasons", data: { option_id: "o0", summary: "Slower pace and lower costs; most say paperwork was the only pain.", points: [] } },
    { event: "reasons", data: { option_id: "o1", summary: "Low salaries and AIMA waits of many months.", points: [] } },
    {
      event: "quotes",
      data: {
        dropped: 1,
        cost_usd: 0.0011,
        rows: [
          { post_id: "t1_1", option: "o0", paraphrase: "Moved from Calgary in 2023; says daily life is calmer and cheaper.", sentiment: "+", community: "r/PortugalExpats", date: "2025-11-12", handle: "user1", url: url(1), country: "PT", phase: "first-year" },
          { post_id: "t1_2", option: "o1", paraphrase: "Paid about 3000 euros in fees and waited eleven months for the AIMA card.", sentiment: "-", community: "r/PortugalExpats", date: "2024-02-01", handle: "user2", url: url(2), country: "PT", phase: "settled" },
        ],
      },
    },
    { event: "done", data: { id: "AbCdEfGh12345678", status: "ok", cost: { llm_usd: 0.04, x_usd: 0, serper_usd: 0.017, total_usd: 0.057 }, quality: { flags: ["other_heavy_test"] } } },
  ],
};

export const errRun = {
  query: "Biggest mistake when moving from Canada to Italy",
  store: "links",
  events: [
    { event: "meta", data: { id: "ZzYyXxWw98765432", started_at: "2026-10-14T09:05:00.000Z" } },
    { event: "poll", data: { final: true, total_opinions: 0, sources: { reddit: { threads: 0, opinions: 0 }, x: { posts: 0, opinions: 0 } }, options: [] } },
    { event: "done", data: { id: "ZzYyXxWw98765432", status: "error", error_reason: "search_unavailable", cost: { total_usd: 0.001 }, quality: { flags: ["reddit_empty"] } } },
  ],
};

test("np-export: golden Markdown from synthetic runs", () => {
  const md = exportMarkdown([okRun as any, errRun as any], { quoteStart: 51 });
  if (process.env.UPDATE_SNAPSHOT === "1" || !existsSync(GOLDEN)) writeFileSync(GOLDEN, md);
  assert.equal(md, readFileSync(GOLDEN, "utf8"));
});

test("np-export: Other over 15% is flagged, quotes are numbered from --quote-start, money and waits go to facts to verify", () => {
  const md = exportMarkdown([okRun as any], { quoteStart: 51 });
  assert.match(md, /\| 17\.5% \| ⚠ Other >15% \|/);
  assert.match(md, /^\| 51 \| Moved from Calgary/m);
  assert.match(md, /^\| 52 \| Paid about 3000 euros/m);
  assert.match(md, /- \[ \] .*3000 euros in fees/);
  assert.match(md, /- \[ \] .*AIMA waits of many months/);
  assert.ok(!/- \[ \] .*calmer and cheaper/.test(md));
});

test("loadRun accepts the research format, the old batch format and a bare event array", () => {
  assert.equal(loadRun(okRun).query, okRun.query);
  assert.equal(loadRun({ query: "q", since: "2025-01-01", events: [] }).since, "2025-01-01");
  assert.equal(loadRun([{ event: "meta", data: { query: "bare" } }]).query, "bare");
});

test("fillMissingQuotes spends nothing unless --paraphrase, and only on runs that still hold post text", async () => {
  const { fillMissingQuotes } = await import("../src/np/export.ts");
  const p = { id: "t1_1", option: "o0", strength: 3, relevance: 1, rank: 1, text: "We moved from Calgary and love the slower pace in Lisbon.", url: url(1), community: "r/PortugalExpats", created_at: "2025-01-01T00:00:00Z", author: { handle: "u1" }, tags: { firsthand: "S", origin: "CA", dest: "PT", phase: "E", lang: "en" } };
  const full = () => loadRun({ query: "q", store: "full", events: [{ event: "posts", data: { posts: [p] } }] });
  const links = () => loadRun({ query: "q", store: "links", events: [{ event: "posts", data: { posts: [{ ...p, text: undefined }] } }] });
  let calls = 0;
  const complete = async () => (calls++, { items: [{ i: 0, paraphrase: "Moved from Calgary; enjoys the calmer pace in Lisbon.", sentiment: "+" }] });
  const a = [full(), links()];
  await fillMissingQuotes(a, { paraphrase: false, perOption: 5, complete });
  assert.equal(calls, 0);
  const r = await fillMissingQuotes(a, { paraphrase: true, perOption: 5, complete });
  assert.equal(calls, 1);
  assert.equal(a[0]!.events.at(-1)!.event, "quotes");
  assert.deepEqual(r.skippedNoText, ["q"]);
});

const extractRun = {
  query: "Canadians in Portugal, what slowed down your AIMA residence card",
  store: "links",
  events: [
    { event: "meta", data: { id: "Ex12345678", started_at: "2026-10-14T09:00:00.000Z" } },
    { event: "poll", data: { final: true, total_opinions: 30, sources: { reddit: { threads: 5, opinions: 30 } }, options: [{ id: "o0", title: "AIMA backlog", count: 30, percent: 100 }] } },
    {
      event: "extract",
      data: {
        v: 1, candidates: 3, eligible: 3, rejected: 1, failed_batches: 0, cost_usd: 0.004,
        records: [1, 2].map((i) => ({
          v: 1, post_id: `t1_${i}`, url: url(i), thread_url: `https://www.reddit.com/r/PortugalExpats/comments/t${i}/x/`, community: "r/PortugalExpats", created_at: "2026-01-01T00:00:00Z", score: 3, handle: `u${i}`, country: "PT", phase: "Y", firsthand: "S",
          who: { household: "couple", partner_non_eu: null, passports: ["CA"], income: "remote_na", route: "d7", consulate: "toronto", region: null },
          incidents: [{ step: "pt:aima-first", what: "long_wait", outcome: "resolved", fix: "lawyer", tried: ["lawyer"], found_out: "at_office", gist: `Waited most of a year for AIMA; a lawyer got the slot (${i}).` }],
          steps: [], triggers: [], chose: null, paid_for: [], emotion: "frustration", valence: "-", rule_dependent: true, has_fact_claim: true, grounded: 1,
        })),
      },
    },
    { event: "done", data: { id: "Ex12345678", status: "ok", cost: { total_usd: 0.08 } } },
  ],
};

test("np-export: extracted experiences, draft themes without numbers, and the sidecar", async () => {
  const { exportMarkdown, sidecarFor } = await import("../src/np/export.ts");
  const md = exportMarkdown([loadRun(extractRun)], { quoteStart: 1 });
  assert.match(md, /## Extracted experiences/);
  assert.match(md, /\| First AIMA residence appointment \| long wait \| 2 \| 2 \| 2 \| 2 \| 2 \| lawyer \(2\) \| lawyer \(2\) \|/);
  assert.match(md, /- Waited most of a year for AIMA; a lawyer got the slot \(1\)\. https:\/\/www\.reddit\.com/);
  const themes = md.slice(md.indexOf("## Themes for publication"), md.indexOf("##", md.indexOf("## Themes for publication") + 5));
  assert.match(themes, /First AIMA residence appointment: long waits\. A fix movers describe: hiring a lawyer\./);
  assert.ok(!/\d/.test(themes.replace("## Themes for publication (draft, needs human wording)", "")), "themes carry no numbers");
  assert.ok(!/\b(often|most|many|majority|usually)\b/i.test(themes), "themes carry no frequency words");
  const side = sidecarFor([loadRun(extractRun)], "pt-aima", { timelineIds: [], runDate: "2026-10-14" });
  assert.equal(side.incidents[0]!.threads, 2);
  assert.ok(!JSON.stringify(side).includes("Waited most"));
});

test("themes skip 'waited' and 'other' as the fix; paid help shows unknown worth", async () => {
  const { exportMarkdown } = await import("../src/np/export.ts");
  const run = JSON.parse(JSON.stringify(extractRun));
  const ex = run.events.find((e: any) => e.event === "extract").data;
  ex.records[0].incidents[0].fix = "waited";
  ex.records[1].incidents[0].fix = "waited";
  ex.records[0].paid_for = [{ what: "lawyer", worth: "?" }];
  const md = exportMarkdown([loadRun(run)], { quoteStart: 1 });
  assert.match(md, /First AIMA residence appointment: long waits\.\n/);
  assert.ok(!md.includes("waiting it out"));
  assert.match(md, /lawyer \(1; worth it \+ 0 \/ - 0 \/ ~ 0 \/ unknown 1\)/);
});

test("incident table names every code in words and shows what people tried", async () => {
  const { exportMarkdown } = await import("../src/np/export.ts");
  const run = JSON.parse(JSON.stringify(extractRun));
  run.events.find((e: any) => e.event === "extract").data.records[0].incidents[0].what = "no_response";
  const md = exportMarkdown([loadRun(run)], { quoteStart: 1 });
  assert.match(md, /\| Step \| What went wrong \| Authors \| Threads \| Posts \| Last 24 months \| Changed rule \| Worked \| Tried \|/);
  assert.match(md, /\| First AIMA residence appointment \| no response from the office \| 1 \| 1 \| 1 \| 1 \| 1 \| lawyer \(1\) \| lawyer \(1\) \|/);
});

test("every problem and fix code has words in the export", async () => {
  const { WHAT, FIX } = await import("../src/np/extract.ts");
  const { WHAT_LABEL, FIX_LABEL } = await import("../src/np/export.ts");
  assert.deepEqual(WHAT.filter((c) => !WHAT_LABEL[c]), []);
  assert.deepEqual(FIX.filter((c) => !FIX_LABEL[c]), []);
});
