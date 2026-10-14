/** Step 6: quote-bank rows from strength-3 first-hand posts, paraphrased and checked so no post text is copied. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkParaphrase, selectQuotes, buildQuotes, formatQuoteRow } from "../src/np/quotes.ts";

const ORIG = "We moved from Calgary in 2023 and the AIMA appointment took eleven months, but the healthcare in Lisbon has been excellent for our kids.";

test("checkParaphrase: a close paraphrase passes", () => {
  assert.deepEqual(checkParaphrase(ORIG, "Moved from Calgary in 2023; waited almost a year for AIMA, yet says Lisbon healthcare has been great for the children."), { ok: true, reasons: [] });
});
test("checkParaphrase: over 25 words", () => {
  const long = Array.from({ length: 26 }, () => "word").join(" ");
  assert.deepEqual(checkParaphrase(ORIG, long).reasons, ["too_long"]);
});
test("checkParaphrase: an 8-word run copied from the original", () => {
  assert.ok(checkParaphrase(ORIG, "Says the AIMA appointment took eleven months, but the healthcare was fine.").reasons.includes("verbatim_run"));
  // Seven copied words in a row are fine.
  assert.ok(!checkParaphrase(ORIG, "Says the AIMA appointment took eleven months, but healthcare was fine.").reasons.includes("verbatim_run"));
});
test("checkParaphrase: a number the original does not have", () => {
  assert.deepEqual(checkParaphrase(ORIG, "Moved in 2023 and waited 14 months for AIMA.").reasons, ["invented_number"]);
});
test("checkParaphrase: a capitalised name the original does not have", () => {
  assert.deepEqual(checkParaphrase(ORIG, "Moved from Calgary, now loves living in Porto with the kids.").reasons, ["invented_name"]);
});

const post = (i: number, option: string, strength: number, firsthand: string, relevance: number, text = ORIG) => ({
  id: `t1_${i}`,
  option,
  strength,
  relevance,
  text,
  url: `https://www.reddit.com/r/PortugalExpats/comments/abc/x/c${i}/`,
  community: "r/PortugalExpats",
  created_at: "2025-11-12T10:00:00.000Z",
  author: { handle: `user${i}` },
  tags: { firsthand, origin: "CA", dest: "PT", phase: "Y", lang: "en" },
});

test("selectQuotes: strength 3, first-hand S or L, best relevance first, N per option", () => {
  const ps = [post(1, "o0", 3, "S", 0.5), post(2, "o0", 3, "L", 0.9), post(3, "o0", 2, "S", 1), post(4, "o0", 3, "H", 1), post(5, "o0", 3, "S", 0.7), post(6, "o1", 3, "S", 0.1)];
  assert.deepEqual(selectQuotes(ps as any, 2).map((p) => p.id), ["t1_2", "t1_5", "t1_6"]);
});

test("buildQuotes: one call per batch, one retry for rejects, then drop and count", async () => {
  const calls: string[] = [];
  const replies = [
    // First pass: #0 good, #1 copies an 8-word run.
    { items: [{ i: 0, paraphrase: "Moved from Calgary; waited almost a year for AIMA but praises Lisbon healthcare.", sentiment: "+" }, { i: 1, paraphrase: "the AIMA appointment took eleven months, but the healthcare", sentiment: "~" }] },
    // Retry for #1 still invents a number.
    { items: [{ i: 0, paraphrase: "Waited 14 months for AIMA.", sentiment: "-" }] },
  ];
  const complete = async (prompt: string) => {
    calls.push(prompt);
    return replies.shift() as any;
  };
  const r = await buildQuotes("Canadians who moved to Portugal, do you regret it", [post(1, "o0", 3, "S", 0.9), post(2, "o1", 3, "S", 0.8)] as any, { perOption: 5, complete });
  assert.equal(calls.length, 2);
  assert.equal(r.rows.length, 1);
  assert.equal(r.dropped, 1);
  assert.deepEqual(r.rows[0], {
    post_id: "t1_1",
    option: "o0",
    paraphrase: "Moved from Calgary; waited almost a year for AIMA but praises Lisbon healthcare.",
    sentiment: "+",
    community: "r/PortugalExpats",
    date: "2025-11-12",
    handle: "user1",
    url: "https://www.reddit.com/r/PortugalExpats/comments/abc/x/c1/",
    country: "PT",
    phase: "first-year",
  });
  // The prompt carries post text in memory only; nothing in the rows is longer than the paraphrase.
  assert.ok(calls[0]!.includes(ORIG));
});

test("formatQuoteRow: quote-bank table row, numbered from --quote-start", () => {
  const row = { post_id: "t1_1", option: "o0", paraphrase: "Waited a year for AIMA | still glad.", sentiment: "+" as const, community: "r/PortugalExpats", date: "2025-11-12", handle: "user1", url: "https://www.reddit.com/r/PortugalExpats/comments/abc/x/c1/", country: "PT", phase: "first-year" };
  assert.equal(formatQuoteRow(51, row), "| 51 | Waited a year for AIMA / still glad. | r/PortugalExpats · 2025-11-12 · u/user1 | https://www.reddit.com/r/PortugalExpats/comments/abc/x/c1/ | PT · first-year · + |");
});

test("addQuotes: final option per post wins and a quotes event is appended", async () => {
  const { addQuotes } = await import("../src/np/quotes.ts");
  const p = post(1, "o0", 3, "S", 0.9);
  const events: any[] = [
    { event: "posts", data: { posts: [p] } },
    { event: "posts", data: { posts: [{ ...p, option: "o1" }], updated: true } },
  ];
  await addQuotes("q", events, 5, async () => ({ items: [{ i: 0, paraphrase: "Moved from Calgary; praises Lisbon healthcare.", sentiment: "+" }] }));
  const q = events.at(-1);
  assert.equal(q.event, "quotes");
  assert.equal(q.data.rows[0].option, "o1");
  assert.equal(q.data.dropped, 0);
});
