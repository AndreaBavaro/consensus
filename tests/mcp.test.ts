/** Step 10: the prebuilt MCP server answers tools/list fast, and consensus_get reads local research runs first. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summarize } from "../mcp/format.ts";
import { toLinksOnly } from "../src/np/links.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const BUILT = join(ROOT, "dist/mcp/server.mjs");

before(() => {
  execSync("npm run -s build:mcp", { cwd: ROOT, stdio: "pipe" });
});

/** Starts the built server with no keys, sends JSON-RPC lines, resolves each response by id. */
function startServer(env: Record<string, string> = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/KEY|OXYLABS|TOKEN|SECRET|PASSWORD/i.test(k)));
  const child = spawn(process.execPath, [BUILT], { env: { ...clean, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  const waiting = new Map<number, (v: any) => void>();
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const msg = JSON.parse(line);
        waiting.get(msg.id)?.(msg);
      } catch {}
    }
  });
  let next = 1;
  const call = (method: string, params: unknown = {}) =>
    new Promise<any>((resolve) => {
      const id = next++;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const init = async () => {
    await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  };
  return { child, call, init, stop: () => child.kill() };
}

test("built server lists tools within 3 s, with the research inputs on consensus_search", async () => {
  const t0 = Date.now();
  const s = startServer();
  try {
    await s.init();
    const r = await s.call("tools/list");
    const ms = Date.now() - t0;
    assert.ok(ms < 3000, `tools/list took ${ms}ms`);
    const search = r.result.tools.find((t: any) => t.name === "consensus_search");
    for (const k of ["profile", "subs", "deny_subs", "lang", "budget_usd"]) assert.ok(k in search.inputSchema.properties, `missing input ${k}`);
  } finally {
    s.stop();
  }
});

const run = {
  query: "Canadians who moved to Portugal, do you regret it",
  store: "links",
  events: toLinksOnly([
    { event: "meta", data: { id: "LocalRun12345678", query: "Canadians who moved to Portugal, do you regret it", sources: ["reddit"] } },
    { event: "posts", data: { posts: [{ id: "t1_a", source: "reddit", option: "o0", strength: 3, rank: 1, relevance: 1, score: 5, text: "post text that is not saved", url: "https://www.reddit.com/r/PortugalExpats/comments/abc/x/a/", community: "r/PortugalExpats", author: { handle: "user1" } }] } },
    { event: "poll", data: { final: true, total_opinions: 1, sources: { reddit: { threads: 1, opinions: 1 }, x: { posts: 0, opinions: 0 } }, options: [{ id: "o0", index: 0, title: "No regrets", description: "", percent: 100, count: 1, by_source: { reddit: 1, x: 0 } }] } },
    { event: "quotes", data: { rows: [{ post_id: "t1_a", option: "o0", paraphrase: "Moved from Calgary; glad they did." }], dropped: 0 } },
    { event: "done", data: { id: "LocalRun12345678", status: "thin", cost: { total_usd: 0.05 } } },
  ]),
};

test("summarize handles links-only runs: paraphrase when there is one, never post text", () => {
  const s = summarize(run.events as any);
  assert.equal(s.options[0]!.quotes[0]!.text, "Moved from Calgary; glad they did.");
});

test("consensus_get answers from runs/mcp/<id>.json before trying the remote site", async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-mcp-"));
  writeFileSync(join(dir, "LocalRun12345678.json"), JSON.stringify(run));
  const s = startServer({ CONSENSUS_RUNS_DIR: dir });
  try {
    await s.init();
    const r = await s.call("tools/call", { name: "consensus_get", arguments: { id: "LocalRun12345678" } });
    const text = r.result.content[0].text as string;
    assert.match(text, /Canadians who moved to Portugal/);
    assert.match(text, /No regrets — 100%/);
    assert.match(text, /local research run/);
  } finally {
    s.stop();
  }
});
