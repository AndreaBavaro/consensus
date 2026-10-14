import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBatchLine, runResearchBatch } from "../src/np/batch.ts";
import type { SearchRequest } from "../src/v3/types.ts";

function fakeRun(cost: number, seen: SearchRequest[], conc = { now: 0, max: 0 }) {
  return async function* (req: SearchRequest) {
    seen.push(req);
    conc.now++;
    conc.max = Math.max(conc.max, conc.now);
    await new Promise((r) => setTimeout(r, 5));
    yield { event: "meta", data: { id: "x", query: req.query } };
    yield { event: "posts", data: { posts: [{ id: "t1_a", text: "secret post text that must not be saved", url: "https://www.reddit.com/r/a/comments/1/x/a/", author: { handle: "u" } }] } };
    yield { event: "poll", data: { final: true, total_opinions: 42, options: [] } };
    yield { event: "done", data: { status: "ok", cost: { total_usd: cost } } };
    conc.now--;
  } as any;
}

test("batch line format: question | since | until", () => {
  assert.deepEqual(parseBatchLine("Is Portugal worth it | 2025-01-01 | 2026-06-30"), { query: "Is Portugal worth it", since: "2025-01-01", until: "2026-06-30" });
  assert.deepEqual(parseBatchLine("Is Portugal worth it"), { query: "Is Portugal worth it", since: undefined, until: undefined });
  assert.deepEqual(parseBatchLine("q || 2026-01-01"), { query: "q", since: undefined, until: "2026-01-01" });
});

test("one search at a time, Reddit only, stops before a search would pass the budget, manifest per finished question", async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-batch-"));
  const seen: SearchRequest[] = [];
  const conc = { now: 0, max: 0 };
  const r = await runResearchBatch({ lines: ["q one | 2025-01-01", "q two", "q three"], outDir: dir, budgetUsd: 0.1, store: "links", run: fakeRun(0.04, seen, conc) });
  assert.equal(conc.max, 1);
  assert.equal(seen.length, 2, "third search would take spent 0.08 + max 0.04 over 0.10");
  assert.equal(r.stopped, "budget");
  assert.deepEqual(seen[0]!.sources, ["reddit"]);
  assert.equal(seen[0]!.since, "2025-01-01");
  const rows = readFileSync(join(dir, "manifest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["cost", "file", "finished_at", "opinions", "query", "since", "slug", "status", "until"].sort());
  assert.equal(rows[0].opinions, 42);
  assert.ok(existsSync(join(dir, rows[0].file)));
  assert.ok(!readFileSync(join(dir, rows[0].file), "utf8").includes("secret post text"));
  // The budget left for the next search is passed down so a single run can stop itself too.
  assert.ok(Math.abs(seen[1]!.budgetUsd! - 0.06) < 1e-9);
});

test("re-running skips slugs already finished", async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-batch-"));
  const first: SearchRequest[] = [];
  await runResearchBatch({ lines: ["q one", "q two"], outDir: dir, budgetUsd: 1, store: "links", run: fakeRun(0.01, first) });
  const second: SearchRequest[] = [];
  const r = await runResearchBatch({ lines: ["q one", "q two", "q three"], outDir: dir, budgetUsd: 1, store: "links", run: fakeRun(0.01, second) });
  assert.deepEqual(second.map((s) => s.query), ["q three"]);
  assert.deepEqual(r.skipped, ["q-one", "q-two"]);
});

test("afterRun spend counts toward the budget and its events are saved", async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-batch-"));
  const seen: SearchRequest[] = [];
  const r = await runResearchBatch({
    lines: ["q one", "q two"],
    outDir: dir,
    budgetUsd: 0.05,
    store: "links",
    run: fakeRun(0.01, seen),
    afterRun: async ({ events }) => {
      events.push({ event: "quotes", data: { rows: [], dropped: 0 }, t_ms: 0 } as any);
      return 0.02;
    },
  });
  assert.equal(r.rows[0]!.cost, 0.03);
  assert.equal(seen.length, 1, "second search: spent 0.03 + max 0.03 > 0.05");
  assert.ok(readFileSync(join(dir, r.rows[0]!.file), "utf8").includes('"quotes"'));
});

test("requestFor adds per-question request fields (seen ids, since-last); a line's own since wins", async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-batch-"));
  const seen: SearchRequest[] = [];
  await runResearchBatch({
    lines: ["q one", "q two | 2024-01-01"],
    outDir: dir,
    store: "links",
    run: fakeRun(0.01, seen),
    requestFor: (line) => ({ skipIds: [`seen-${line.query}`], since: "2026-09-14" }),
  });
  assert.deepEqual(seen.map((s) => [s.skipIds, s.since]), [[["seen-q one"], "2026-09-14"], [["seen-q two"], "2024-01-01"]]);
});

test("a batch stops after two failed runs in a row (error, or empty with posts collected)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "np-batch-"));
  const seen: SearchRequest[] = [];
  const failing = async function* (req: SearchRequest) {
    seen.push(req);
    yield { event: "poll", data: { final: true, total_opinions: 0, options: [] } };
    yield { event: "done", data: { status: "empty", pool: { collected: 300, sorted: 0 }, cost: { total_usd: 0.02 } } };
  } as any;
  const r = await runResearchBatch({ lines: ["a", "b", "c", "d"], outDir: dir, store: "links", run: failing });
  assert.equal(seen.length, 2);
  assert.equal(r.stopped, "failing");
});
