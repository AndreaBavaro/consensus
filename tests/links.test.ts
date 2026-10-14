import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installFakeNet, fakeCollectReddit, fakeProfiles, fakeSubs, collect } from "./helpers/fakes.ts";
import { TEXTS } from "./helpers/synthetic.ts";
import { runV3 } from "../src/v3/run.ts";
import { toLinksOnly, saveRun } from "../src/np/links.ts";

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

test("links-only events keep every link and no post text", async () => {
  const net = installFakeNet({
    llm: (p) => (p.includes("These posts all chose the answer") ? JSON.stringify({ summary: "s", points: [{ text: "label", post: 0, quote: p.match(/\[0\] (.{30})/)?.[1] ?? "" }] }) : undefined),
  });
  try {
    const events = await collect(runV3({ query: "Canadians who moved to Portugal, do you regret it", sources: ["reddit"] }, { collectReddit: fakeCollectReddit() as any, fetchRedditProfiles: fakeProfiles(), fetchSubredditInfo: fakeSubs() }));
    // Themes carry quotes with post text; make sure one is present so stripping is exercised.
    events.push({ event: "themes", data: { themes: [{ id: "t0", title: "Paperwork", description: "d", option_ids: [], count: 1, percent: 1, by_option: {}, by_source: { reddit: 1, x: 0 }, post_ids: ["t1_c1"], quotes: [{ post_id: "t1_c1", url: "https://www.reddit.com/x", text: TEXTS[0]!, source: "reddit", author: "user1" }] }] } });
    const before = strings(events);
    const links = new Set(before.filter((s) => s.startsWith("https://www.reddit.com/")));
    const stripped = toLinksOnly(events as any);
    const after = strings(stripped);
    for (const t of TEXTS) assert.ok(!after.some((s) => s.includes(t.slice(0, 40))), `post text leaked: ${t.slice(0, 40)}`);
    assert.ok(after.every((s) => s.length <= 300), "a string over 300 chars survived");
    for (const l of links) assert.ok(after.includes(l), `link lost: ${l}`);
    const posts = stripped.filter((e) => e.event === "posts").flatMap((e: any) => e.data.posts);
    assert.ok(posts.length > 0);
    for (const p of posts) {
      assert.deepEqual(Object.keys(p.author), ["handle", "profile_url"]);
      for (const k of ["id", "url", "thread_url", "thread_title", "community", "created_at", "score", "option", "strength"]) assert.ok(k in p, `missing ${k}`);
      assert.equal("text" in p, false);
    }
    const dir = mkdtempSync(join(tmpdir(), "np-"));
    await saveRun(join(dir, "r.json"), { query: "q", events: events as any }, "links");
    const saved = readFileSync(join(dir, "r.json"), "utf8");
    for (const t of TEXTS) assert.ok(!saved.includes(t.slice(0, 40)));
    await saveRun(join(dir, "f.json"), { query: "q", events: events as any }, "full");
    assert.ok(readFileSync(join(dir, "f.json"), "utf8").includes(TEXTS[0]!.slice(0, 40)));
  } finally {
    net.restore();
  }
});
