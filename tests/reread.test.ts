/** Re-read of saved Reddit posts for validation: per-post status, by-id lookup, overlap check, no text on disk. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRedditRef, rereadPosts, maxSharedRun, quoteFound, toJsonRecord, indexById, parseInput, type FetchResult } from "../src/np/reread.ts";

const comment = (id: string, body: string, extra: Record<string, unknown> = {}, replies: unknown[] = []) => ({
  kind: "t1",
  data: { id, name: `t1_${id}`, body, author: body === "[deleted]" ? "[deleted]" : "someone", score: 7, created_utc: 1_760_000_000, parent_id: "t3_th1", permalink: `/r/x/comments/th1/t/${id}/`, replies: replies.length ? { kind: "Listing", data: { children: replies } } : "", ...extra },
});
const listing = (post: Record<string, unknown>, comments: unknown[]) => [
  { kind: "Listing", data: { children: [{ kind: "t3", data: { id: "th1", name: "t3_th1", title: "Thread title", subreddit: "MoveToIreland", selftext: "Opening post text here", author: "op", score: 12, created_utc: 1_750_000_000, ...post } }] } },
  { kind: "Listing", data: { children: comments } },
];
const URL = (cid?: string) => `https://www.reddit.com/r/MoveToIreland/comments/th1/some_slug/${cid ? `${cid}/` : ""}`;

test("parseRedditRef reads thread and comment ids from URLs and fullnames", () => {
  assert.deepEqual(parseRedditRef(URL("abc12")), { threadId: "th1", commentId: "abc12", fullname: "t1_abc12" });
  assert.deepEqual(parseRedditRef(URL()), { threadId: "th1", commentId: undefined, fullname: "t3_th1" });
  assert.deepEqual(parseRedditRef("https://www.reddit.com/r/torino/comments/1p5de9e/affitti_impossibili_in_città/nqibiyd/"), { threadId: "1p5de9e", commentId: "nqibiyd", fullname: "t1_nqibiyd" });
  assert.deepEqual(parseRedditRef("t3_th1"), { threadId: "th1", commentId: undefined, fullname: "t3_th1" });
  assert.equal(parseRedditRef("https://example.com/x"), null);
});

test("statuses: live, deleted, removed, not_found, thread 404, fetch_failed", async () => {
  const calls: string[] = [];
  const fetchPath = async (path: string): Promise<FetchResult> => {
    calls.push(path);
    if (path.includes("/comments/gone")) return { status: "not_found" };
    if (path.includes("/comments/fail")) return { status: "failed" };
    if (path.includes("/_/live1")) return { status: "ok", body: listing({}, [comment("par1", "Parent comment text", {}, [comment("live1", "I waited six weeks for the PPS email.", { parent_id: "t1_par1" })])]) };
    if (path.includes("/_/del1")) return { status: "ok", body: listing({}, [comment("del1", "[deleted]")]) };
    if (path.includes("/_/rem1")) return { status: "ok", body: listing({}, [comment("rem1", "[removed]")]) };
    if (path.includes("/_/miss1")) return { status: "ok", body: listing({}, []) };
    if (path.includes("/comments/th1?")) return { status: "ok", body: listing({}, []) };
    throw new Error(`unexpected ${path}`);
  };
  const recs = await rereadPosts(
    [
      { id: "1", url: URL("live1"), paraphrase: "Waited six weeks just for the PPS email." },
      { id: "2", url: URL("del1") },
      { id: "3", url: URL("rem1") },
      { id: "4", url: URL("miss1") },
      { id: "5", url: "https://www.reddit.com/r/x/comments/gone/s/c1/" },
      { id: "6", url: "https://www.reddit.com/r/x/comments/fail/s/c1/" },
      { id: "7", url: URL() },
    ],
    { fetchPath },
  );
  assert.deepEqual(recs.map((r) => r.status), ["live", "deleted", "removed", "not_found", "not_found", "fetch_failed", "live"]);
  const live = recs[0]!;
  assert.equal(live.text, "I waited six weeks for the PPS email.");
  assert.equal(live.score, 7);
  assert.equal(live.date, "2025-10-09");
  assert.equal(live.community, "r/MoveToIreland");
  assert.equal(live.thread_title, "Thread title");
  assert.equal(live.parent_excerpt, "Parent comment text");
  assert.equal(recs[6]!.text, "Thread title\nOpening post text here");
  assert.ok(calls.some((c) => c === "/comments/th1/_/live1?context=2&raw_json=1"), "comment fetched by focused permalink");
});

test("a deleted opener and a moderator-removed opener are classified", async () => {
  const mk = (post: Record<string, unknown>) => async (): Promise<FetchResult> => ({ status: "ok", body: listing(post, []) });
  const [d] = await rereadPosts([{ id: "a", url: URL() }], { fetchPath: mk({ selftext: "[deleted]", author: "[deleted]", removed_by_category: "deleted" }) });
  const [r] = await rereadPosts([{ id: "b", url: URL() }], { fetchPath: mk({ selftext: "[removed]", removed_by_category: "moderator" }) });
  assert.equal(d!.status, "deleted");
  assert.equal(r!.status, "removed");
});

test("the same permalink is fetched once", async () => {
  let n = 0;
  const fetchPath = async (): Promise<FetchResult> => (n++, { status: "ok", body: listing({}, [comment("c1", "A real comment body")]) });
  await rereadPosts([{ id: "1", url: URL("c1") }, { id: "2", url: URL("c1") }], { fetchPath });
  assert.equal(n, 1);
});

test("maxSharedRun counts the longest run of shared words, case and punctuation folded", () => {
  assert.equal(maxSharedRun("Waited six weeks just for the email.", "I waited six weeks for the email giving a date"), 3);
  assert.equal(maxSharedRun("nothing in common", "totally different words"), 0);
  assert.equal(maxSharedRun("«Llama por teléfono, no escribas»", "Llama por teléfono, no escribas. Siempre."), 5);
});

test("quoteFound matches a verbatim quote after folding quotes, case and whitespace", () => {
  assert.equal(quoteFound("«Llama por teléfono, no escribas»", "Consejo: llama  por teléfono, no escribas!"), true);
  assert.equal(quoteFound("«il pagamento all'agenzia»", "Il pagamento all’agenzia lo fai dopo"), true);
  assert.equal(quoteFound("«something else»", "Consejo: llama por teléfono"), false);
});

test("JSON records never carry the post text; index by row id and fullname", async () => {
  const fetchPath = async (): Promise<FetchResult> => ({ status: "ok", body: listing({}, [comment("c1", "A secret body that must stay in memory")]) });
  const recs = await rereadPosts([{ id: "701", url: URL("c1"), paraphrase: "secret body" }], { fetchPath });
  const json = JSON.stringify(recs.map(toJsonRecord));
  assert.ok(!json.includes("must stay in memory"));
  assert.ok(!json.includes("Parent"));
  const rec = toJsonRecord(recs[0]!);
  assert.equal(rec.max_shared_run, 2);
  assert.equal(rec.quote_found, true);
  assert.match(rec.text_sha256!, /^[0-9a-f]{12}$/);
  const idx = indexById(recs.map(toJsonRecord));
  assert.equal(idx["701"]!.fullname, "t1_c1");
  assert.equal(idx["t1_c1"]!.id, "701");
});

test("parseInput reads TSV rows and bare URL lines", () => {
  const rows = parseInput(`701\t${URL("c1")}\tA paraphrase\n# comment\n${URL("c2")}\n\n`);
  assert.deepEqual(rows, [
    { id: "701", url: URL("c1"), paraphrase: "A paraphrase" },
    { id: "2", url: URL("c2"), paraphrase: undefined },
  ]);
});
