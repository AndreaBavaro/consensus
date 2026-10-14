/** Step 5: allowlisted subs always searched, deny-listed subs never fetched, native-language planner queries. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeNet } from "./helpers/fakes.ts";
import { collectReddit, planRedditSearches, type FetchedThread } from "../src/v3/reddit.ts";

const W = { sinceEpoch: 0, untilEpoch: Number.POSITIVE_INFINITY };
const hit = (sub: string, id: string) => ({ title: `${sub} thread ${id}`, link: `https://www.reddit.com/r/${sub}/comments/${id}/x/` });
const planner = (p: string) =>
  p.includes("We build a public-opinion poll from Reddit threads")
    ? JSON.stringify({ queries: ["moving to italy from canada"], subreddits: ["ItalyExpat", "expats"], core: "canada to italy", native: { it: ["trasferirsi in italia dal canada", "errori trasferimento italia", "canadesi in italia", "vivere in italia canadese", "quinta in più"] } })
    : undefined;

test("default plan: planner prompt has no native field and Serper gets no hl/gl", async () => {
  const net = installFakeNet({ llm: planner });
  try {
    const plan = await planRedditSearches("Biggest mistake when moving from Canada to Italy");
    assert.ok(!net.llmCalls[0]!.prompt.includes("native"));
    assert.deepEqual(plan.siteQueries, ["canada to italy site:reddit.com/r/ItalyExpat", "canada to italy site:reddit.com/r/expats"]);
    assert.equal(plan.nativeQueries, undefined);
  } finally {
    net.restore();
  }
});

test("subs, deny-subs and lang shape the searches and the fetched threads", async () => {
  const net = installFakeNet({
    llm: planner,
    serper: (b) => ({ organic: b.q.includes("site:") ? [hit("ItalyExpat", "a1")] : [hit("ItalyTravel", "d1"), hit("Italian", "d2"), hit("ItalyExpat", "a2"), hit("expats", "a3")] }),
  });
  const fetched: string[] = [];
  const fetchThread = async (id: string): Promise<FetchedThread> => {
    fetched.push(id);
    return { id, title: id, url: `https://www.reddit.com/comments/${id}/`, community: null, numComments: 0, posts: [] };
  };
  const hits: string[] = [];
  try {
    const r = await collectReddit("Biggest mistake when moving from Canada to Italy", W, () => {}, (h) => hits.push(...h.map((x) => x.url)), undefined, {
      subs: ["ItalyExpat", "MoveToIreland"],
      denySubs: ["Italian", "ItalyTravel"],
      lang: ["it"],
      fetchThread,
    });
    const qs = net.serperCalls.map((b) => b.q);
    // Planner's subs, plus every allowlisted sub not already there.
    assert.ok(qs.includes("canada to italy site:reddit.com/r/MoveToIreland"));
    assert.equal(qs.filter((q) => q === "canada to italy site:reddit.com/r/ItalyExpat").length, 1);
    // At most 4 native queries, each with hl/gl.
    const native = net.serperCalls.filter((b) => b.hl === "it");
    assert.equal(native.length, 4);
    assert.ok(native.every((b) => b.gl === "it" && b.q.endsWith(" reddit")));
    assert.ok(r.queries.includes("trasferirsi in italia dal canada"));
    assert.equal(net.serperCalls.filter((b) => !b.hl && ("hl" in b || "gl" in b)).length, 0);
    // Denied subs never fetched nor reported as hits.
    assert.deepEqual(fetched.sort(), ["a1", "a2", "a3"]);
    assert.ok(!hits.some((u) => /\/r\/(Italian|ItalyTravel)\//.test(u)));
  } finally {
    net.restore();
  }
});
