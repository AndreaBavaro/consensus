/** Extraction inside a research run: candidates include no-stance posts, records carry links only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeNet, fakeCollectReddit, fakeProfiles, fakeSubs, collect } from "./helpers/fakes.ts";
import { TEXTS } from "./helpers/synthetic.ts";
import { runV3 } from "../src/v3/run.ts";
import { toLinksOnly } from "../src/np/links.ts";

const Q = "Canadians who moved to Portugal, what slowed down your AIMA residence card";
const deps = () => ({ collectReddit: fakeCollectReddit() as any, fetchRedditProfiles: fakeProfiles(), fetchSubredditInfo: fakeSubs() });

test("extract: own-experience first-hand posts, including no-stance ones, become coded records with links only", async () => {
  const net = installFakeNet();
  try {
    const events = await collect(runV3({ query: Q, sources: ["reddit"], tags: true, extract: true }, deps()));
    const ex = events.find((e) => e.event === "extract")?.data as any;
    assert.ok(ex, "extract event emitted");
    assert.ok(ex.records.length > 0);
    const opinionIds = new Set(events.filter((e) => e.event === "posts").flatMap((e: any) => e.data.posts.filter((p: any) => p.option).map((p: any) => p.id)));
    assert.ok(ex.records.some((r: any) => !opinionIds.has(r.post_id)), "a no-stance post was extracted");
    assert.equal(ex.records.length + ex.rejected, ex.candidates);
    assert.ok(ex.cost_usd > 0);
    assert.equal(net.llmCalls.filter((c) => c.prompt.includes("Code what THEY say happened")).length, Math.ceil(ex.candidates / 10));
    const saved = JSON.stringify(toLinksOnly(events as any));
    for (const t of TEXTS) assert.ok(!saved.includes(t.slice(0, 40)), "post text leaked");
  } finally {
    net.restore();
  }
});

test("no extract flag -> no extraction calls and no extract event", async () => {
  const net = installFakeNet();
  try {
    const events = await collect(runV3({ query: Q, sources: ["reddit"], tags: true }, deps()));
    assert.equal(events.some((e) => e.event === "extract"), false);
    assert.equal(net.llmCalls.filter((c) => c.prompt.includes("Code what THEY say happened")).length, 0);
  } finally {
    net.restore();
  }
});
