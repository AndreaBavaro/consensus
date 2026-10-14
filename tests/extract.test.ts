/** Extraction pilot: coded records (no post text) from first-hand posts, grounded in the text in memory only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CODEBOOK, timelineStepFor } from "../src/np/codebook.ts";
import { validateRecord, extractRecords, extractPrompt } from "../src/np/extract.ts";

const TEXT =
  "We applied for the D7 at VFS Toronto in March. Got the visa, but the AIMA appointment took nine months and our card expired while waiting. " +
  "Our lawyer finally got us a slot by emailing every week. Do your NIF and bank account before you fly, we did it remotely through a lawyer. " +
  "Honestly the lawyer was worth every euro.";
const post = { id: "t1_a", text: TEXT, url: "https://www.reddit.com/r/PortugalExpats/comments/x/y/a/", thread_url: "https://www.reddit.com/r/PortugalExpats/comments/x/y/", community: "r/PortugalExpats", created_at: "2025-06-01T00:00:00.000Z", score: 12, author: { handle: "u1" }, tags: { firsthand: "S", origin: "CA", dest: "PT", phase: "Y", lang: "en", own: true } };

const raw = {
  who: { household: "couple", partner_non_eu: null, passports: ["CA"], income: "remote_na", route: "d7", consulate: "toronto", region: "Lisbon" },
  incidents: [
    { step: "pt:aima", what: "long_wait", outcome: "resolved", own: true, tried: ["called_or_emailed_repeatedly"], fix: "lawyer", worked: true, found_out: "at_office", gist: "AIMA appointment took most of a year; a lawyer emailing weekly finally secured a slot.", evidence: "the AIMA appointment took nine months" },
    { step: "pt:made-up-step", what: "teleported", outcome: "stuck", fix: "magic", found_out: "-", gist: "the AIMA appointment took nine months and our card expired while waiting", evidence: "not in the post at all" },
  ],
  steps: [{ step: "pt:visa-application", evidence: "applied for the D7 at VFS Toronto" }, { step: "pt:nif", evidence: "Do your NIF and bank account before you fly" }, { step: "pt:aima", evidence: "AIMA appointment" }],
  triggers: [],
  chose: null,
  paid_for: [{ what: "lawyer", worth: "+", evidence: "the lawyer was worth every euro" }],
  emotion: "relief",
  valence: "~",
  rule_dependent: true,
  has_fact_claim: true,
};

test("codebook: country-prefixed step codes, rule slugs and timeline matching", () => {
  assert.ok(CODEBOOK["it:codice-fiscale"]!.rule === "it-codice-fiscale");
  assert.ok(CODEBOOK["ca:nr73"]!.rule === "nr73-residency-opinion");
  assert.equal(timelineStepFor("it:codice-fiscale", ["it-remote-work-11-codice-fiscale", "it-retire-09-codice-fiscale", "it-remote-work-13-residenza"]).join(","), "it-remote-work-11-codice-fiscale,it-retire-09-codice-fiscale");
});

test("validateRecord: cleans codes, checks gists, grounds every claim in the text, keeps no text", () => {
  const r = validateRecord(raw, post as any)!;
  assert.equal(r.country, "PT");
  assert.equal(r.incidents.length, 1, "the ungrounded incident is dropped");
  assert.deepEqual(r.incidents[0], { step: "pt:aima", what: "long_wait", outcome: "resolved", fix: "lawyer", tried: ["called_or_emailed_repeatedly"], found_out: "at_office", gist: "AIMA appointment took most of a year; a lawyer emailing weekly finally secured a slot." });
  assert.deepEqual(r.steps, ["pt:visa-application", "pt:nif", "pt:aima"]);
  assert.deepEqual(r.paid_for, [{ what: "lawyer", worth: "+" }]);
  assert.equal(r.who.consulate, "toronto");
  assert.equal(r.who.region, "lisbon");
  assert.equal(r.grounded, 0.833);
  assert.equal(r.url, post.url);
  const json = JSON.stringify(r);
  assert.ok(!json.includes("nine months") && !json.includes("evidence"), "no post text or evidence spans stored");
});

test("validateRecord: a gist that copies the post is dropped to null; a mostly ungrounded record is rejected", () => {
  const copy = { ...raw, incidents: [{ ...raw.incidents[0], gist: "the AIMA appointment took nine months and our card expired while waiting" }] };
  assert.equal(validateRecord(copy, post as any)!.incidents[0]!.gist, null);
  const bad = { ...raw, incidents: [raw.incidents[1]], steps: [{ step: "pt:nif", evidence: "nope" }], paid_for: [{ what: "lawyer", worth: "+", evidence: "nope" }] };
  assert.equal(validateRecord(bad, post as any), null);
});

test("extractRecords: batches of 10, one call each, records keyed by index, cost counted", async () => {
  const posts = Array.from({ length: 12 }, (_, i) => ({ ...post, id: `t1_${i}` }));
  const prompts: string[] = [];
  const complete = async (p: string) => {
    prompts.push(p);
    const n = (p.match(/^\[\d+\]/gm) ?? []).length;
    return { items: Array.from({ length: n }, (_, i) => ({ i, ...raw })) };
  };
  const r = await extractRecords(posts as any, { complete });
  assert.equal(prompts.length, 2);
  assert.equal(r.records.length, 12);
  assert.equal(r.rejected, 0);
  assert.ok(prompts[0]!.includes("pt:aima") && prompts[0]!.includes(TEXT.slice(0, 50)));
});

test("extractPrompt lists the codebook and asks for verbatim evidence", () => {
  const p = extractPrompt("q", [post as any]);
  assert.ok(p.includes("ca:nr73") && p.includes("evidence"));
});

test("v2: advice to others is dropped, fixes count only when they worked, steps are de-duplicated", () => {
  const v2 = {
    ...raw,
    incidents: [
      { step: "pt:aima-renewal", what: "no_response", outcome: "resolved", own: true, tried: ["called_or_emailed_repeatedly", "escalated_complaint"], fix: "lawyer", worked: true, found_out: "at_office", gist: null, evidence: "the AIMA appointment took nine months" },
      { step: "pt:aima", what: "long_wait", outcome: "delay", own: true, tried: ["called_or_emailed_repeatedly"], fix: "escalated_complaint", worked: false, found_out: "-", gist: null, evidence: "our card expired while waiting" },
      { step: "pt:nif", what: "wrong_order", outcome: "-", own: false, tried: [], fix: "booked_before_flying", worked: true, found_out: "-", gist: null, evidence: "Do your NIF and bank account before you fly" },
    ],
    steps: [{ step: "pt:aima", evidence: "AIMA appointment" }, { step: "pt:aima", evidence: "AIMA appointment" }, { step: "other", evidence: "We applied for the D7" }, { step: "pt:nif", evidence: "Do your NIF" }],
  };
  const r = validateRecord(v2, post as any)!;
  assert.equal(r.v, 2);
  assert.equal(r.incidents.length, 2, "advice (own=false) is not the poster's incident");
  assert.deepEqual(r.incidents[0]!.tried, ["called_or_emailed_repeatedly", "escalated_complaint"]);
  assert.equal(r.incidents[0]!.fix, "lawyer");
  assert.equal(r.incidents[0]!.step, "pt:aima-renewal");
  assert.equal(r.incidents[0]!.what, "no_response");
  assert.equal(r.incidents[1]!.fix, null, "a fix that did not work is only a try");
  assert.deepEqual(r.incidents[1]!.tried, ["called_or_emailed_repeatedly", "escalated_complaint"]);
  assert.deepEqual(r.steps, ["pt:aima", "pt:nif"]);
});

test("codes added after the second audit are accepted", () => {
  const r = validateRecord({ ...raw, incidents: [{ ...raw.incidents[0], step: "pt:permanent-residence", what: "validity_gap", tried: ["requested_written_proof"] }] }, post as any)!;
  assert.equal(r.incidents[0]!.step, "pt:permanent-residence");
  assert.equal(r.incidents[0]!.what, "validity_gap");
  assert.deepEqual(r.incidents[0]!.tried, ["requested_written_proof"]);
  for (const c of ["pt:visa-extension", "pt:chave-movel-digital"]) assert.ok(c in CODEBOOK);
  assert.equal(validateRecord({ ...raw, incidents: [{ ...raw.incidents[0], what: "appointment_cancelled" }] }, post as any)!.incidents[0]!.what, "appointment_cancelled");
});
