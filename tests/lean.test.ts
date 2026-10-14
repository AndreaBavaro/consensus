/** Step 8: research runs skip UI-only Reddit extras, deadlines come from env, proxy bytes are metered. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeNet, fakeCollectReddit, fakeProfiles, fakeSubs, fakeExtras, collect } from "./helpers/fakes.ts";
import { meter, meterStore, newMeter } from "../src/lib/meter.ts";

process.env.SPLIT_LATEST_MS = "12345";
process.env.DEEPEN_LATEST_MS = "23456";
const { runV3, SPLIT_LATEST_MS, DEEPEN_LATEST_MS } = await import("../src/v3/run.ts");
const { fetchThread } = await import("../src/v3/reddit.ts");
const Q = "Canadians who moved to Portugal, do you regret it";

test("split/deepen deadlines are env-configurable", () => {
  assert.equal(SPLIT_LATEST_MS, 12345);
  assert.equal(DEEPEN_LATEST_MS, 23456);
});

test("lean run makes zero /user/ and /r/about calls; default run makes them", async () => {
  const net = installFakeNet();
  try {
    const deps = { collectReddit: fakeCollectReddit() as any, fetchRedditProfiles: fakeProfiles(), fetchSubredditInfo: fakeSubs() };
    fakeExtras.profileCalls = fakeExtras.subCalls = 0;
    const lean = await collect(runV3({ query: Q, sources: ["reddit"], lean: true }, deps));
    assert.equal(fakeExtras.profileCalls + fakeExtras.subCalls, 0);
    assert.ok(!lean.some((e) => e.event === "authors" || e.event === "communities"));
    await collect(runV3({ query: Q, sources: ["reddit"] }, deps));
    assert.ok(fakeExtras.profileCalls > 0 && fakeExtras.subCalls > 0);
  } finally {
    net.restore();
  }
});

test("fetchThread adds the response size to oxylabsBytes", async () => {
  const listing = [{ data: { children: [{ data: { id: "abc", title: "T", selftext: "opening post text here", permalink: "/r/x/comments/abc/t/", subreddit: "x", author: "a", created_utc: 1, score: 1 } }] } }, { data: { children: [] } }];
  const m = newMeter();
  await meterStore.run(m, () => fetchThread("abc", { sinceEpoch: 0, untilEpoch: Infinity }, async () => listing));
  assert.equal(m.oxylabsBytes, Buffer.byteLength(JSON.stringify(listing)));
});

test("done.cost reports oxylabs_gb and oxylabs_usd on research runs; usd null without a price", async () => {
  const net = installFakeNet();
  const base = fakeCollectReddit();
  const collectReddit = (async (...a: Parameters<typeof base>) => {
    meter()!.oxylabsBytes += 2_000_000_000;
    return base(...a);
  }) as any;
  const deps = { collectReddit, fetchRedditProfiles: fakeProfiles(), fetchSubredditInfo: fakeSubs() };
  try {
    delete process.env.OXYLABS_USD_PER_GB;
    let d = (await collect(runV3({ query: Q, sources: ["reddit"], lean: true }, deps))).find((e) => e.event === "done")!.data as any;
    assert.equal(d.cost.oxylabs_gb, 2);
    assert.equal(d.cost.oxylabs_usd, null);
    process.env.OXYLABS_USD_PER_GB = "4";
    d = (await collect(runV3({ query: Q, sources: ["reddit"], lean: true }, deps))).find((e) => e.event === "done")!.data as any;
    assert.equal(d.cost.oxylabs_usd, 8);
    delete process.env.OXYLABS_USD_PER_GB;
    d = (await collect(runV3({ query: Q, sources: ["reddit"] }, deps))).find((e) => e.event === "done")!.data as any;
    assert.equal("oxylabs_gb" in d.cost, false);
  } finally {
    net.restore();
  }
});

test("research (lean) runs get longer deadlines than the web's 60-second stream; default runs keep today's", async () => {
  const { deadlinesFor } = await import("../src/v3/run.ts");
  const d = deadlinesFor({ query: "q", sources: ["reddit"] });
  assert.deepEqual([d.sort, d.finish], [40_000, 52_000]);
  const r = deadlinesFor({ query: "q", sources: ["reddit"], lean: true });
  assert.ok(r.sort >= 120_000 && r.finish >= r.sort + 20_000 && r.options >= 40_000);
});
