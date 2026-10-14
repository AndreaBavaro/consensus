/** Step 4: poster tags under the research profile; the default sorter prompt stays byte-identical. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeNet, fakeCollectReddit, fakeProfiles, fakeSubs, collect } from "./helpers/fakes.ts";
import { syntheticThread } from "./helpers/synthetic.ts";
import { parseLabels, sortPrompt, sortPromptCot } from "../src/v3/sort.ts";
import { researchStats } from "../src/np/subsets.ts";
import { runV3 } from "../src/v3/run.ts";

const Q = "Canadians who moved to Portugal, do you regret it";
const OPTS = [{ title: "No regrets", description: "Glad they moved." }, { title: "Regret it", description: "Wish they had stayed." }];
const golden = () => {
  const posts = syntheticThread().posts.slice(0, 6);
  posts[2]!.parent_text = "Did you move with kids?";
  return posts;
};

test("default prompts are byte-identical to today's", () => {
  assert.equal(sortPrompt(Q, OPTS, golden()), readFileSync(new URL("./fixtures/sort-prompt-default.txt", import.meta.url), "utf8"));
  assert.equal(sortPromptCot(Q, OPTS, golden()), readFileSync(new URL("./fixtures/sort-prompt-cot-default.txt", import.meta.url), "utf8"));
});

test("tags prompt asks for the tag columns and drops LEAD", () => {
  for (const p of [sortPrompt(Q, OPTS, golden(), true), sortPromptCot(Q, OPTS, golden(), true)]) {
    assert.ok(p.includes("<firsthand> <origin> <dest> <phase> <lang>"));
    assert.ok(!p.includes("LEAD ="));
  }
});

test("parser reads both line formats", () => {
  const plain = parseLabels("0 1 3 -\n1 S 0 -\n2 N 0 L", 3, 2);
  assert.deepEqual(plain.map((l) => l && [l.bucket, l.strength, l.intent]), [[1, 3, null], ["drop", 0, null], ["none", 0, "looking"]]);
  const tagged = parseLabels("0 0 3 S CA PT Y en\n1 | regrets it | 1 2 H - IT X it\n2 N 0 - - - - -", 3, 2, undefined, true);
  assert.deepEqual(tagged[0], { bucket: 0, strength: 3, intent: null, tags: { firsthand: "S", origin: "CA", dest: "PT", phase: "Y", lang: "en" } });
  assert.deepEqual(tagged[1]!.tags, { firsthand: "H", origin: "-", dest: "IT", phase: "X", lang: "it" });
  assert.equal(tagged[2]!.bucket, "none");
  // A tagged line is not read in default mode and vice versa.
  assert.equal(parseLabels("0 0 3 S CA PT Y en", 1, 2)[0], undefined);
  assert.equal(parseLabels("0 0 3 -", 1, 2, undefined, true)[0], undefined);
});

test("subset and recent_share math", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  const p = (option: string, firsthand: string, origin: string, monthsAgo: number) => ({ option, tags: { firsthand, origin, dest: "PT", phase: "Y", lang: "en" }, created_at: new Date(now - monthsAgo * 30.4 * 86_400_000).toISOString() });
  const posts = [p("o0", "S", "CA", 1), p("o0", "S", "US", 30), p("o0", "H", "CA", 1), p("o1", "S", "CA", 2), p("o1", "L", "-", 40), p("other", "S", "UK", 1)];
  const s = researchStats(posts as any, ["o0", "o1", "other"], now);
  assert.deepEqual(s.subsets.first_hand_na, { total: 3, options: [{ id: "o0", count: 2, percent: 66.7 }, { id: "o1", count: 1, percent: 33.3 }, { id: "other", count: 0, percent: 0 }] });
  assert.deepEqual(s.recent_share, { o0: 0.667, o1: 0.5, other: 1 });
});

test("a tagged run streams tags, no leads, and the final poll has subsets and recent_share", async () => {
  const net = installFakeNet();
  try {
    const events = await collect(runV3({ query: Q, sources: ["reddit"], tags: true }, { collectReddit: fakeCollectReddit() as any, fetchRedditProfiles: fakeProfiles(), fetchSubredditInfo: fakeSubs() }));
    const posts = events.filter((e) => e.event === "posts").flatMap((e: any) => e.data.posts);
    assert.ok(posts.length > 0 && posts.every((p: any) => p.tags?.dest === "PT" && p.intent === null));
    const final = events.find((e: any) => e.event === "poll" && e.data.final)!.data as any;
    assert.ok(final.subsets.first_hand_na.total > 0);
    assert.ok(final.options.every((o: any) => typeof o.recent_share === "number"));
    assert.ok(net.llmCalls.some((c) => c.prompt.includes("<firsthand>")));
  } finally {
    net.restore();
  }
});

test("research sorter line carries an optional own-experience column", () => {
  const p = sortPrompt(Q, OPTS, golden(), true);
  assert.ok(p.includes("<firsthand> <origin> <dest> <phase> <lang> <own>"));
  assert.ok(sortPromptCot(Q, OPTS, golden(), true).includes("<lang> <own>"));
  const got = parseLabels("0 N 0 S CA PT A en X\n1 0 3 S CA PT Y en -\n2 1 2 H - IT X it", 3, 2, undefined, true);
  assert.equal(got[0]!.tags!.own, true);
  assert.equal(got[0]!.bucket, "none");
  assert.equal(got[1]!.tags!.own, false);
  // A model that leaves the column off still parses; own is then unknown.
  assert.equal(got[2]!.tags!.own, undefined);
});
