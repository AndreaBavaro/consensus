/** Step 9: counted comments are skipped on later runs, share diffs vs the previous run, opt-in thread cache. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installFakeNet, fakeCollectReddit, fakeProfiles, fakeSubs, collect } from "./helpers/fakes.ts";
import { runV3 } from "../src/v3/run.ts";
import { emptyState, familyOf, recordRun, diffAgainst, skipIdsFor, sinceLast, loadState, saveState } from "../src/np/seen.ts";
import { cachedListing, purgeCache } from "../src/np/cache.ts";
import { fetchThread } from "../src/v3/reddit.ts";
import { meterStore, newMeter } from "../src/lib/meter.ts";

const Q = "Canadians who moved to Portugal, do you regret it";
const deps = () => ({ collectReddit: fakeCollectReddit() as any, fetchRedditProfiles: fakeProfiles(), fetchSubredditInfo: fakeSubs() });
const finalPoll = (events: any[]) => events.find((e) => e.event === "poll" && e.data.final).data;

test("skipIds: already-counted comments stay in the pool but are not sorted or counted", async () => {
  const net = installFakeNet();
  try {
    const skip = ["t1_c1", "t1_c3", "t1_c6"];
    const events = await collect(runV3({ query: Q, sources: ["reddit"], skipIds: skip }, deps()));
    const sortPrompts = net.llmCalls.filter((c) => c.prompt.includes("You are sorting posts")).map((c) => c.prompt).join("\n");
    assert.ok(!sortPrompts.includes("I love it here after two years in Lisbon"));
    assert.ok(sortPrompts.includes("Deep regret, the bureaucracy at AIMA"));
    const posted = events.filter((e) => e.event === "posts").flatMap((e: any) => e.data.posts.map((p: any) => p.id));
    assert.ok(skip.every((id) => !posted.includes(id)));
    assert.equal(finalPoll(events).total_opinions, 16 - 3);
    assert.equal((events.find((e) => e.event === "done")!.data as any).seen.skipped, 3);
  } finally {
    net.restore();
  }
});

test("state: record, skip set, since-last and diff", () => {
  const s = emptyState();
  const fam = familyOf(Q);
  assert.equal(fam, "canadians-who-moved-to-portugal-do-you-regret-it");
  assert.equal(sinceLast(s, fam), undefined);
  const run1 = [
    { event: "meta", data: { id: "a", started_at: "2026-09-14T10:00:00Z" } },
    { event: "posts", data: { posts: [{ id: "t1_x", kind: "comment", option: "o0", thread_url: "https://r/t1" }, { id: "t3_t1", kind: "opener", option: null, thread_url: "https://r/t1" }] } },
    { event: "poll", data: { final: true, options: [{ id: "o0", title: "No regrets", percent: 60 }, { id: "o1", title: "Regret it", percent: 40 }] } },
  ];
  assert.equal(diffAgainst(s, fam, run1 as any), null);
  recordRun(s, fam, run1 as any);
  assert.deepEqual([...skipIdsFor(s, fam)], ["t1_x"]);
  assert.deepEqual(s.families[fam]!.threads, ["https://r/t1"]);
  assert.equal(sinceLast(s, fam), "2026-09-14");
  const run2 = [
    { event: "meta", data: { id: "b", started_at: "2026-10-14T10:00:00Z" } },
    { event: "poll", data: { final: true, options: [{ id: "o0", title: "no regrets", percent: 50 }, { id: "o2", title: "Too early to tell", percent: 30 }, { id: "o1", title: "Regret it", percent: 20 }] } },
  ];
  assert.deepEqual(diffAgainst(s, fam, run2 as any), {
    previous_run: "a",
    previous_date: "2026-09-14",
    options: [
      { title: "no regrets", share: 50, previous: 60, change: -10 },
      { title: "Too early to tell", share: 30, previous: null, change: null },
      { title: "Regret it", share: 20, previous: 40, change: -20 },
    ],
    new_options: ["Too early to tell"],
  });
});

test("state file round-trip holds ids, links and shares only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-seen-"));
  const s = emptyState();
  recordRun(s, "fam", [{ event: "posts", data: { posts: [{ id: "t1_y", kind: "comment", option: "o0", text: "post text", thread_url: "https://r/t" }] } }] as any);
  await saveState(join(dir, "s.json"), s);
  const back = await loadState(join(dir, "s.json"));
  assert.deepEqual(back.families.fam!.comments, ["t1_y"]);
  assert.ok(!JSON.stringify(back).includes("post text"));
  assert.deepEqual(await loadState(join(dir, "missing.json")), emptyState());
});

test("thread cache: opt-in, reuses fresh listings without proxy bytes, refetches stale ones, purge empties it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-cache-"));
  let fetched = 0;
  const listing = [{ data: { children: [{ data: { id: "abc", title: "T", selftext: "opening post body text", permalink: "/r/x/comments/abc/t/", subreddit: "x", author: "a", created_utc: 1, score: 1 } }] } }, { data: { children: [] } }];
  const inner = async () => (fetched++, listing);
  const get = cachedListing(dir, 30, inner);
  const W = { sinceEpoch: 0, untilEpoch: Infinity };
  const m = newMeter();
  await meterStore.run(m, async () => {
    await fetchThread("abc", W, get);
    const bytes = m.oxylabsBytes;
    await fetchThread("abc", W, get);
    assert.equal(fetched, 1);
    assert.equal(m.oxylabsBytes, bytes, "a cache hit is not proxy traffic");
  });
  const old = Date.now() / 1000 - 31 * 86_400;
  utimesSync(join(dir, "abc.json"), old, old);
  await get("abc");
  assert.equal(fetched, 2);
  assert.equal(await purgeCache(dir), 1);
  assert.deepEqual(readdirSync(dir), []);
  assert.ok(existsSync(dir));
});
