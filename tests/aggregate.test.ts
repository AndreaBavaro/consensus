/** Aggregating extraction records into incident rankings, step order, paid help and the app sidecar. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, toSidecar } from "../src/np/aggregate.ts";

const rec = (i: number, thread: string, over: any = {}) => ({
  v: 1, post_id: `t1_${i}`, url: `https://www.reddit.com/r/PortugalExpats/comments/${thread}/x/${i}/`, thread_url: `https://www.reddit.com/r/PortugalExpats/comments/${thread}/x/`,
  community: "r/PortugalExpats", created_at: i < 4 ? "2026-01-01T00:00:00Z" : "2022-01-01T00:00:00Z", score: 1, handle: `u${i}`, country: "PT", phase: "Y", firsthand: "S",
  who: { household: "couple", partner_non_eu: null, passports: ["CA"], income: "remote_na", route: "d7", consulate: "toronto", region: null },
  incidents: [{ step: "pt:aima", what: "long_wait", outcome: "delay", fix: i % 2 ? "lawyer" : null, tried: ["called_or_emailed_repeatedly"], found_out: "at_office", gist: `gist ${i}` }],
  steps: ["pt:nif", "pt:bank-account", "pt:aima"], triggers: ["housing_ca"], chose: null, paid_for: i === 1 ? [{ what: "lawyer", worth: "+" }] : [],
  emotion: "frustration", valence: "-", rule_dependent: false, has_fact_claim: false, grounded: 1, ...over,
});
const NOW = Date.parse("2026-10-14T00:00:00Z");

test("aggregate: incidents ranked by distinct threads with fixes, recency and links", () => {
  const records = [rec(1, "a"), rec(2, "a"), rec(3, "b"), rec(4, "c"), rec(5, "c", { incidents: [{ step: "pt:nif", what: "wrong_document", outcome: "had_to_redo", fix: "lawyer", tried: [], found_out: "after", gist: null }], steps: [] })];
  const a = aggregate(records as any, { now: NOW });
  assert.deepEqual(a.incidents[0], {
    country: "PT", step: "pt:aima", step_label: "AIMA appointment and residence card (unspecified)", rule: null, what: "long_wait",
    threads: 3, posts: 4, recent_posts: 3, fixes: [{ fix: "lawyer", posts: 2 }], tried: [{ fix: "called_or_emailed_repeatedly", posts: 4 }], links: [records[0]!.url, records[1]!.url, records[2]!.url, records[3]!.url],
  });
  assert.equal(a.incidents[1]!.step, "pt:nif");
  assert.equal(a.incidents[1]!.rule, "pt-nif");
  // Usual order: mean position across posts that state an order.
  assert.deepEqual(a.order.PT!.map((s) => s.step), ["pt:nif", "pt:bank-account", "pt:aima"]);
  assert.deepEqual(a.paid_for, [{ what: "lawyer", posts: 1, worth: { "+": 1, "-": 0, "~": 0, "?": 0 }, links: [records[0]!.url] }]);
  assert.equal(a.facets.route.d7, 5);
  assert.equal(a.first_hand_posts, 5);
  // Saturation: share of (step, what) pairs first seen in the last two threads.
  assert.equal(a.saturation.threads, 3);
  assert.equal(a.saturation.new_in_last_two, 0.5);
});

test("sidecar: coded records only, timeline ids matched, no paraphrases", () => {
  const s = toSidecar("pt-aima", aggregate([rec(1, "a")] as any, { now: NOW }), { timelineIds: ["pt-d7-05-aima", "pt-d7-01-nif"], runDate: "2026-10-14" });
  assert.equal(s.batch, "pt-aima");
  assert.deepEqual(s.incidents[0]!.timeline_steps, ["pt-d7-05-aima"]);
  assert.ok(!JSON.stringify(s).includes("gist"));
});

test("sidecar leaves out the who facets (internal only until they are accurate)", () => {
  const s = toSidecar("pt-aima", aggregate([rec(1, "a")] as any, { now: NOW }), { runDate: "2026-10-14" });
  assert.equal("facets" in s, false);
  assert.ok("facets" in aggregate([rec(1, "a")] as any, { now: NOW }));
});

test("sidecar incidents carry app_steps (New Postcode timeline/checklist keys) next to the rule slug", () => {
  const r = rec(1, "a", { incidents: [{ step: "ca:broker", what: "account_frozen", outcome: "stuck", fix: null, tried: [], found_out: "after", gist: null }] });
  const s = toSidecar("x", aggregate([r, rec(2, "b")] as any, { now: NOW }), { runDate: "2026-10-14" });
  const broker = s.incidents.find((i) => i.step === "ca:broker")!;
  assert.deepEqual(broker.app_steps, ["broker-non-resident", "bank-iban"]);
  assert.deepEqual(s.incidents.find((i) => i.step === "pt:aima")!.app_steps, []);
});
