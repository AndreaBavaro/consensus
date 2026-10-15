/** The web function caches finished searches for everyone; provider outages (status error) must never be cached. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isCacheable } from "../src/v3/cacheable.ts";

test("only ok and thin results are cacheable; error and empty are not", () => {
  assert.equal(isCacheable("ok"), true);
  assert.equal(isCacheable("thin"), true);
  assert.equal(isCacheable("empty"), false);
  assert.equal(isCacheable("error"), false);
  assert.equal(isCacheable(undefined), false);
});

test("the web search function decides caching with isCacheable", () => {
  const src = readFileSync(new URL("../netlify/functions/search-v3.mts", import.meta.url), "utf8");
  assert.match(src, /ok = isCacheable\(d\.status\)/);
});
