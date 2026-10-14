import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeNet, fakeCollectReddit, fakeProfiles, fakeSubs, collect } from "./helpers/fakes.ts";
import { runV3 } from "../src/v3/run.ts";

test("a run with budgetUsd stops sorting once spend reaches it and flags budget_stop", async () => {
  const net = installFakeNet(); // every fake LLM call costs $0.001
  try {
    const events = await collect(runV3({ query: "Canadians who moved to Portugal, do you regret it", sources: ["reddit"], budgetUsd: 0.0005 }, { collectReddit: fakeCollectReddit() as any, fetchRedditProfiles: fakeProfiles(), fetchSubredditInfo: fakeSubs() }));
    const done = events.find((e) => e.event === "done")!.data as any;
    assert.ok(done.quality.flags.includes("budget_stop"));
    assert.equal(net.llmCalls.filter((c) => c.prompt.includes("You are sorting posts")).length, 0);
  } finally {
    net.restore();
  }
});

test("the cap stops at 90% of budgetUsd, leaving room for calls already in flight and quote paraphrases", async () => {
  const net = installFakeNet(); // options call costs $0.001, which is 91% of $0.0011
  try {
    const events = await collect(runV3({ query: "Canadians who moved to Portugal, do you regret it", sources: ["reddit"], budgetUsd: 0.0011 }, { collectReddit: fakeCollectReddit() as any, fetchRedditProfiles: fakeProfiles(), fetchSubredditInfo: fakeSubs() }));
    assert.ok((events.find((e) => e.event === "done")!.data as any).quality.flags.includes("budget_stop"));
    assert.equal(net.llmCalls.filter((c) => c.prompt.includes("You are sorting posts")).length, 0);
  } finally {
    net.restore();
  }
});
