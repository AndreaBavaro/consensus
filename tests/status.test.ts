/** Step 1: a run whose LLM or search provider is down ends with status "error", never "empty", and does so quickly. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeNet, fakeCollectReddit, fakeProfiles, fakeSubs, collect } from "./helpers/fakes.ts";

process.env.OPTIONS_FALLBACK_MS = "1500";
const { runV3 } = await import("../src/v3/run.ts");
const extras = { fetchRedditProfiles: fakeProfiles(), fetchSubredditInfo: fakeSubs() };
const done = (events: any[]) => events.find((e) => e.event === "done")?.data;

test("every LLM call fails -> status error, llm_unavailable, no sorting calls", async () => {
  const net = installFakeNet({ llm: () => ({ status: 503, body: { error: "down" } }) });
  try {
    const t0 = Date.now();
    const events = await collect(runV3({ query: "Canadians who moved to Portugal, do you regret it", sources: ["reddit"] }, { collectReddit: fakeCollectReddit() as any, ...extras }));
    const d = done(events);
    assert.equal(d.status, "error");
    assert.equal(d.error_reason, "llm_unavailable");
    assert.ok(Date.now() - t0 < 1500 + 4000, `took ${Date.now() - t0}ms`);
    assert.equal(net.llmCalls.filter((c) => c.prompt.includes("You are sorting posts")).length, 0);
  } finally {
    net.restore();
  }
});

test("a hanging LLM gateway is cut off at OPTIONS_FALLBACK_MS", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = ((_u: any, init?: any) =>
    new Promise((_, reject) => {
      const no = () => reject(new DOMException("aborted", "AbortError"));
      if (init?.signal?.aborted) no();
      else init?.signal?.addEventListener("abort", no);
    })) as typeof fetch;
  try {
    const t0 = Date.now();
    const events = await collect(runV3({ query: "Canadians who moved to Portugal, do you regret it", sources: ["reddit"] }, { collectReddit: fakeCollectReddit() as any, ...extras }));
    assert.equal(done(events).status, "error");
    assert.equal(done(events).error_reason, "llm_unavailable");
    assert.ok(Date.now() - t0 < 1500 + 4000, `took ${Date.now() - t0}ms`);
  } finally {
    globalThis.fetch = real;
  }
});

test("Serper never answers successfully -> status error, search_unavailable, no options call", async () => {
  const net = installFakeNet({ serper: () => ({ status: 401 }) });
  try {
    const events = await collect(runV3({ query: "Canadians who moved to Portugal, do you regret it", sources: ["reddit"] }, extras));
    const d = done(events);
    assert.equal(d.status, "error");
    assert.equal(d.error_reason, "search_unavailable");
    assert.equal(net.llmCalls.filter((c) => /You run a public opinion poll|Write the 2 to 4 poll options/.test(c.prompt)).length, 0);
  } finally {
    net.restore();
  }
});

test("calls succeed -> no error_reason", async () => {
  const net = installFakeNet();
  try {
    const d = done(await collect(runV3({ query: "Canadians who moved to Portugal, do you regret it", sources: ["reddit"] }, { collectReddit: fakeCollectReddit() as any, ...extras })));
    assert.notEqual(d.status, "error");
    assert.equal("error_reason" in d, false);
  } finally {
    net.restore();
  }
});
