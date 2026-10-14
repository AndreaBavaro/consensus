import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProfile, PROFILES } from "../src/v3/profile.ts";

test("no flag, no env -> default profile, full store, nothing switched on", () => {
  const p = resolveProfile({}, {});
  assert.equal(p.name, "default");
  assert.equal(p.store, "full");
  assert.equal(p.research, false);
  assert.equal(p.tags, false);
  assert.deepEqual(p.subs, []);
});

test("--profile=newpostcode and CONSENSUS_PROFILE both select the research profile; the flag wins", () => {
  assert.equal(resolveProfile({ profile: "newpostcode" }, {}).name, "newpostcode");
  assert.equal(resolveProfile({}, { CONSENSUS_PROFILE: "newpostcode" }).name, "newpostcode");
  assert.equal(resolveProfile({ profile: "default" }, { CONSENSUS_PROFILE: "newpostcode" }).name, "default");
  const np = PROFILES.newpostcode;
  assert.equal(np.store, "links");
  assert.equal(np.research, true);
  assert.ok(np.subs.includes("ItalyExpat") && np.denySubs.includes("ItalyTravel"));
});

test("flags override profile values; --research alone turns research on without the profile", () => {
  const p = resolveProfile({ profile: "newpostcode", store: "full", subs: "a,b", "deny-subs": "c", lang: "it,pt" }, {});
  assert.equal(p.store, "full");
  assert.deepEqual(p.subs, ["a", "b"]);
  assert.deepEqual(p.denySubs, ["c"]);
  assert.deepEqual(p.lang, ["it", "pt"]);
  const r = resolveProfile({ research: "" }, {});
  assert.equal(r.name, "default");
  assert.equal(r.research, true);
  assert.equal(r.tags, false);
});

test("unknown profile or store is an error", () => {
  assert.throws(() => resolveProfile({ profile: "nope" }, {}));
  assert.throws(() => resolveProfile({ store: "half" }, {}));
});

test("profileRequest adds nothing for the default profile and tags for newpostcode", async () => {
  const { profileRequest } = await import("../src/v3/profile.ts");
  assert.deepEqual(profileRequest(PROFILES.default), {});
  assert.equal(profileRequest(PROFILES.newpostcode).tags, true);
  assert.equal(profileRequest(PROFILES.newpostcode).subs!.length, 14);
  assert.deepEqual(profileRequest(resolveProfile({ lang: "it", "deny-subs": "Italian" }, {})), { denySubs: ["Italian"], lang: ["it"] });
});
