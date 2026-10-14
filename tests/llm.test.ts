/** The Straitly gateway began ignoring reasoning:{enabled:false} on 2026-10-14; reasoning_effort:"none" is honoured. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeNet } from "./helpers/fakes.ts";
import { completeText } from "../src/llm.ts";

test("straitly: no-reasoning calls also send reasoning_effort none", async () => {
  let body: any;
  const net = installFakeNet({ llm: (_p, b) => ((body = b), "ok") });
  try {
    await completeText("hi", { model: "deepseek/deepseek-v4-1-flash" }, 0);
    assert.deepEqual(body.reasoning, { enabled: false });
    assert.equal(body.reasoning_effort, "none");
    await completeText("hi", { model: "gpt-6-luna" }, 0);
    assert.equal("reasoning_effort" in body, false, "reasoning-on calls are unchanged");
  } finally {
    net.restore();
  }
});

test("openrouter: request body unchanged", async () => {
  const saved = { s: process.env.STRAITLY_API_KEY, g: process.env.LLM_GATEWAY };
  process.env.LLM_GATEWAY = "openrouter";
  process.env.OPENROUTER_API_KEY = "test-not-a-key";
  const real = globalThis.fetch;
  let body: any;
  globalThis.fetch = (async (_u: any, init: any) => ((body = JSON.parse(init.body)), Response.json({ choices: [{ message: { content: "ok" } }], usage: { cost: 0 } }))) as typeof fetch;
  try {
    await completeText("hi", { model: "deepseek/deepseek-v4.1-flash" }, 0);
    assert.deepEqual(body.reasoning, { enabled: false });
    assert.equal("reasoning_effort" in body, false);
  } finally {
    globalThis.fetch = real;
    if (saved.g === undefined) delete process.env.LLM_GATEWAY;
    else process.env.LLM_GATEWAY = saved.g;
    delete process.env.OPENROUTER_API_KEY;
  }
});
