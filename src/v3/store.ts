import { getStore } from "@netlify/blobs";
import { logger } from "../lib/log.ts";
import type { V3Event } from "./types.ts";

/*
 * Cache (finished searches, replayed instantly and shareable by id), per-IP rate limit and daily spend ledger.
 * Netlify Blobs when running on Netlify; process memory otherwise (CLI, tests). Every operation fails open so a
 * storage hiccup never blocks a search.
 */
const log = logger("v3-store");
// Pinned to process (shared across netlify dev function contexts) so module re-evaluation (netlify dev, warm lambdas) shares one map.
const memory: Map<string, unknown> = ((process as unknown as { __csMemory?: Map<string, unknown> }).__csMemory ??= new Map());

function store(name: string) {
  try {
    if (!process.env.NETLIFY && !process.env.NETLIFY_BLOBS_CONTEXT && !process.env.NETLIFY_LOCAL) return null;
    return getStore({ name, consistency: "eventual" });
  } catch {
    return null;
  }
}

async function getJson<T>(bucket: string, key: string): Promise<T | null> {
  const s = store(bucket);
  if (!s) return (memory.get(`${bucket}/${key}`) as T) ?? null;
  try {
    return ((await s.get(key, { type: "json" })) as T) ?? null;
  } catch (e) {
    log.warn(`read ${bucket}/${key} failed`, { error: String(e) });
    return null;
  }
}

async function setJson(bucket: string, key: string, value: unknown) {
  const s = store(bucket);
  if (!s) return void memory.set(`${bucket}/${key}`, value);
  try {
    await s.setJSON(key, value);
  } catch (e) {
    log.warn(`write ${bucket}/${key} failed`, { error: String(e) });
  }
}

export interface CachedSearch {
  saved_at: number;
  events: V3Event[];
}

export async function readCache(id: string, ttlHours: number): Promise<CachedSearch | null> {
  const c = await getJson<CachedSearch>("consensus-v3-searches", id);
  return c && Date.now() - c.saved_at < ttlHours * 3_600_000 ? c : null;
}

/** Saved results by id regardless of age (shared links). */
export async function readSaved(id: string): Promise<CachedSearch | null> {
  return getJson<CachedSearch>("consensus-v3-searches", id);
}

export async function writeCache(id: string, events: V3Event[]) {
  await setJson("consensus-v3-searches", id, { saved_at: Date.now(), events } satisfies CachedSearch);
}

// ---------------------------------------------------------------- one search in flight per user

const INFLIGHT_TTL_MS = 150_000;
type Inflight = { token: string; at: number; query: string };
const inflightKey = (who: string) => who.replace(/[^\w.:-]/g, "_");

/**
 * Claims the single in-flight search slot for `who` (uid / anon id / ip). Returns null when claimed, otherwise the
 * query already running. A stale slot (crashed run, older than the TTL) is taken over via etag. Fails open.
 */
export async function acquireInflight(who: string, token: string, query: string): Promise<string | null> {
  const key = inflightKey(who);
  const mk = `inflight/${key}`;
  // Layer 1: synchronous in-process check so parallel requests on one instance can't both pass.
  const local = memory.get(mk) as Inflight | undefined;
  if (local && Date.now() - local.at < INFLIGHT_TTL_MS && local.token !== token) return local.query;
  const mine: Inflight = { token, at: Date.now(), query };
  memory.set(mk, mine);
  let s: ReturnType<typeof getStore> | null = null;
  try {
    if (process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT || process.env.NETLIFY_LOCAL) s = getStore({ name: "consensus-v3-inflight", consistency: "strong" });
  } catch {
    s = null;
  }
  if (!s) return null;
  try {
    if ((await s.setJSON(key, mine, { onlyIfNew: true })).modified) return null;
    const cur = await s.getWithMetadata(key, { type: "json", consistency: "strong" });
    if (!cur) return (await s.setJSON(key, mine, { onlyIfNew: true })).modified ? null : query;
    const held = cur.data as Inflight;
    if (held?.token === token) return null;
    if (held && Date.now() - held.at < INFLIGHT_TTL_MS) {
      memory.delete(mk);
      return held.query || "another search";
    }
    if (cur.etag && (await s.setJSON(key, mine, { onlyIfMatch: cur.etag })).modified) return null;
    memory.delete(mk);
    return held?.query || "another search";
  } catch (e) {
    log.warn("inflight claim failed (allowing)", { error: String(e) });
    return null;
  }
}

export async function releaseInflight(who: string, token: string) {
  const key = inflightKey(who);
  const mk = `inflight/${key}`;
  if ((memory.get(mk) as Inflight | undefined)?.token === token) memory.delete(mk);
  try {
    if (!(process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT || process.env.NETLIFY_LOCAL)) return;
    const s = getStore({ name: "consensus-v3-inflight", consistency: "strong" });
    const cur = await s.get(key, { type: "json", consistency: "strong" });
    if ((cur as Inflight | null)?.token === token) await s.delete(key);
  } catch (e) {
    log.warn("inflight release failed (expires by TTL)", { error: String(e) });
  }
}

const day = () => new Date().toISOString().slice(0, 10);

/** Fixed one-hour window per IP. Eventually consistent, so it is a soft limit, which is enough to stop abuse loops. */
export async function allowRequest(ip: string, perHour: number): Promise<{ ok: boolean; remaining: number }> {
  const hour = new Date().toISOString().slice(0, 13);
  const key = `${hour}/${ip.replace(/[^\w.:-]/g, "_")}`;
  const n = (await getJson<number>("consensus-v3-rate", key)) ?? 0;
  if (n >= perHour) return { ok: false, remaining: 0 };
  await setJson("consensus-v3-rate", key, n + 1);
  return { ok: true, remaining: perHour - n - 1 };
}

export async function spentToday(): Promise<number> {
  return (await getJson<number>("consensus-v3-spend", day())) ?? 0;
}

export async function addSpend(usd: number) {
  if (!(usd > 0)) return;
  await setJson("consensus-v3-spend", day(), (await spentToday()) + usd);
}

// ---------------------------------------------------------------- free search + accounts

/** The search id an anonymous visitor spent their free search on (re-opening that same search stays free). */
export async function anonFreeSearch(anon: string): Promise<string | null> {
  return getJson<string>("consensus-v3-anon", `id/${anon}`);
}

/** Free searches started from one IP today (stops cookie-clearing loops; a few allowed for shared networks). */
export async function anonIpCount(ip: string): Promise<number> {
  return (await getJson<number>("consensus-v3-anon", `ip/${day()}/${ip.replace(/[^\w.:-]/g, "_")}`)) ?? 0;
}

/**
 * Atomically claims the visitor's one free search for `searchId`. Returns the id the free search belongs to: `searchId`
 * when this call won (or it was already this search), otherwise the earlier search. Parallel requests can't multiply it.
 */
export async function claimFreeSearch(anon: string, ip: string, searchId: string, maxPerIp: number): Promise<string> {
  const key = `id/${anon}`;
  // Layer 1: synchronous in-process claim (no await before it), so parallel requests on one instance can't all win.
  const lockKey = `claim-lock/${anon}`;
  const held = memory.get(lockKey) as string | undefined;
  if (held) return held;
  memory.set(lockKey, searchId);
  if (memory.size > 50_000) memory.clear();
  const s = store("consensus-v3-anon");
  let won: boolean;
  if (!s) {
    const k = `consensus-v3-anon/${key}`;
    won = !memory.has(k);
    if (won) memory.set(k, searchId);
  } else {
    try {
      won = (await s.setJSON(key, searchId, { onlyIfNew: true })).modified;
    } catch (e) {
      log.warn("free search claim failed", { error: String(e) });
      won = false;
    }
  }
  if (!won) {
    const prev = (await getJson<string>("consensus-v3-anon", key)) ?? "";
    memory.set(lockKey, prev || "claimed");
    return prev;
  }
  // Per-IP slots are claimed one key each (slot 0..max-1), so parallel cookie-less requests can't overshoot either.
  const ipKey = ip.replace(/[^\w.:-]/g, "_");
  for (let slot = 0; slot < maxPerIp; slot++) {
    const k = `ipslot/${day()}/${ipKey}/${slot}`;
    let ok: boolean;
    if (!s) {
      ok = !memory.has(`consensus-v3-anon/${k}`);
      if (ok) memory.set(`consensus-v3-anon/${k}`, searchId);
    } else {
      ok = await s.setJSON(k, searchId, { onlyIfNew: true }).then((r) => r.modified, () => false);
    }
    if (ok) {
      await setJson("consensus-v3-anon", `ip/${day()}/${ipKey}`, slot + 1);
      return searchId;
    }
  }
  memory.set(lockKey, "ip-exhausted");
  return "";
}

/** First/last seen per Straitly uid, so Consensus usage can be joined to Straitly accounts later. */
export async function touchUser(user: { uid: string; email: string | null; name: string | null }) {
  const key = user.uid.replace(/[^\w-]/g, "_");
  const prev = await getJson<{ first_seen: string; searches: number }>("consensus-v3-users", key);
  await setJson("consensus-v3-users", key, {
    uid: user.uid,
    email: user.email,
    name: user.name,
    first_seen: prev?.first_seen ?? new Date().toISOString(),
    last_seen: new Date().toISOString(),
    searches: prev?.searches ?? 0,
  });
}

export async function countUserSearch(uid: string) {
  const key = uid.replace(/[^\w-]/g, "_");
  const prev = await getJson<Record<string, unknown> & { searches?: number }>("consensus-v3-users", key);
  if (prev) await setJson("consensus-v3-users", key, { ...prev, searches: (prev.searches ?? 0) + 1, last_seen: new Date().toISOString() });
}

export interface HistoryEntry {
  id: string;
  query: string;
  since: string | null;
  until: string | null;
  sources: string[];
  at: string;
}
const HISTORY_MAX = 50;

/** Recent searches per signed-in user, newest first, de-duplicated by search id. */
export async function userHistory(uid: string): Promise<HistoryEntry[]> {
  return (await getJson<HistoryEntry[]>("consensus-v3-users", `history/${uid.replace(/[^\w-]/g, "_")}`)) ?? [];
}

export async function addHistory(uid: string, entry: Omit<HistoryEntry, "at">) {
  const prev = await userHistory(uid);
  const sig = historyKey(entry);
  const next = [{ ...entry, at: new Date().toISOString() }, ...prev.filter((h) => h.id !== entry.id && historyKey(h) !== sig)].slice(0, HISTORY_MAX);
  await setJson("consensus-v3-users", `history/${uid.replace(/[^\w-]/g, "_")}`, next);
}

/** Same question + sources + window counts as one history row, so re-running a search does not stack duplicates. */
export function historyKey(h: Pick<HistoryEntry, "query" | "sources" | "since" | "until">): string {
  const q = h.query.toLowerCase().trim().replace(/\s+/g, " ").replace(/[?!.\s]+$/, "");
  return [q, [...(h.sources ?? [])].sort().join(","), h.since ?? "", h.until ?? ""].join("|");
}

export async function clearHistory(uid: string, id?: string) {
  const key = `history/${uid.replace(/[^\w-]/g, "_")}`;
  await setJson("consensus-v3-users", key, id ? (await userHistory(uid)).filter((h) => h.id !== id) : []);
}
