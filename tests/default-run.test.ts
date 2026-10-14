/** Acceptance: with no profile and no flag, a run emits the same event sequence and fields as before this branch. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { installFakeNet, fakeCollectReddit, fakeProfiles, fakeSubs, collect } from "./helpers/fakes.ts";
import { runV3 } from "../src/v3/run.ts";

const SNAP = new URL("./fixtures/default-run.snapshot.json", import.meta.url);

/** Shape of a value: object keys (sorted, recursive), array element shapes merged, primitives as their type. */
function shape(v: unknown): unknown {
  if (Array.isArray(v)) {
    const merged: Record<string, unknown> = {};
    for (const x of v) Object.assign(merged, { [JSON.stringify(shape(x))]: shape(x) });
    return Object.values(merged);
  }
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape((v as any)[k])]));
  return v === null ? "null" : typeof v;
}

export function normalize(events: { event: string; data: any }[]) {
  const ev = events.filter((e) => e.event !== "progress");
  const finalAt = ev.findIndex((e) => e.event === "poll" && e.data.final);
  // Reasons, themes and profile events finish in any order after the final poll; compare them as a set.
  const head = ev.slice(0, finalAt + 1).map((e) => e.event);
  const tail = ev.slice(finalAt + 1).map((e) => e.event).sort();
  const shapes = Object.fromEntries([...new Set(ev.map((e) => e.event))].map((n) => [n, shape(ev.filter((e) => e.event === n).map((e) => e.data))]));
  const final = ev[finalAt]?.data;
  const done = ev.find((e) => e.event === "done")?.data;
  // timing keys vary with what ran, values with the clock; keep the keys.
  if (done) shapes.done = JSON.parse(JSON.stringify(shapes.done).replace(/"timing":\{[^}]*\}/, '"timing":"object"'));
  return {
    head,
    tail,
    shapes,
    poll: final?.options.map((o: any) => [o.title, o.count, o.percent]),
    posts: ev.filter((e) => e.event === "posts").flatMap((e) => e.data.posts.map((p: any) => [p.id, p.option, p.strength])),
    status: done?.status,
  };
}

test("default run: same events and fields as the recorded baseline", async () => {
  const net = installFakeNet();
  try {
    const events = await collect(runV3({ query: "Canadians who moved to Portugal, do you regret it", sources: ["reddit"] }, { collectReddit: fakeCollectReddit() as any, fetchRedditProfiles: fakeProfiles(), fetchSubredditInfo: fakeSubs() }));
    const got = normalize(events as any);
    if (process.env.UPDATE_SNAPSHOT === "1" || !existsSync(SNAP)) writeFileSync(SNAP, JSON.stringify(got, null, 1));
    assert.deepEqual(got, JSON.parse(readFileSync(SNAP, "utf8")));
    assert.equal(got.status, "thin");
  } finally {
    net.restore();
  }
});
