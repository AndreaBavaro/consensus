import { getStore } from "@netlify/blobs";
import { logger } from "../lib/log.ts";
import { sleep } from "./limit.ts";

/*
 * Global X (TwitterAPI.io) pacing (KAN-412). The ceiling is per account: paid accounts get 20 QPS on paper; measured
 * on our key, 35 req/s is clean (~6% 429) and 50 req/s draws 25% 429s. On Netlify each search runs in its own function
 * instance, so a per-instance pacer lets N parallel searches send N x the ceiling. Each live search registers in a
 * Blobs store; every instance divides X_GLOBAL_RPS by the live count (refreshed every few seconds) and backs off
 * multiplicatively on 429. A page that would wait longer than X_MAX_WAIT_MS is skipped, so heavy load means fewer X
 * pages per search, never a stalled or failed search.
 */
const log = logger("v3-xpace");
const GLOBAL_RPS = Number(process.env.X_GLOBAL_RPS ?? 34);
const LOCAL_MAX_RPS = Number(process.env.X_RPS ?? 36);
const MIN_RPS = Number(process.env.X_MIN_RPS ?? 0.3);
const MAX_WAIT_MS = Number(process.env.X_MAX_WAIT_MS ?? 10_000);
const ACTIVE_TTL_MS = 150_000;
const REFRESH_MS = 1_500;

const local = new Map<string, number>();
const blobs = () => {
  try {
    if (!process.env.NETLIFY && !process.env.NETLIFY_BLOBS_CONTEXT && !process.env.NETLIFY_LOCAL) return null;
    return getStore({ name: "consensus-v3-active", consistency: "strong" });
  } catch {
    return null;
  }
};

let active = 1;
let refreshedAt = 0;
let refreshing: Promise<void> | null = null;

async function refresh() {
  const now = Date.now();
  const s = blobs();
  if (!s) {
    for (const [k, at] of local) if (now - at >= ACTIVE_TTL_MS) local.delete(k);
    active = Math.max(1, local.size);
    return;
  }
  try {
    // Keys are "<startedAtMs>-<token>", so liveness comes from the key alone.
    const { blobs: list } = await s.list();
    let n = 0;
    for (const b of list) {
      if (now - Number(b.key.split("-")[0]) < ACTIVE_TTL_MS) n++;
      else void s.delete(b.key).catch(() => {});
    }
    active = Math.max(1, n);
  } catch (e) {
    log.warn("active count failed (keeping last)", { error: String(e) });
  }
}

function maybeRefresh() {
  if (refreshing || Date.now() - refreshedAt < REFRESH_MS) return;
  refreshedAt = Date.now();
  refreshing = refresh().finally(() => (refreshing = null));
}

/** Marks a live (paid) X search; returns its release function. */
export async function registerSearch(token: string): Promise<() => Promise<void>> {
  const key = `${Date.now()}-${token.replace(/[^\w]/g, "")}`;
  const s = blobs();
  if (s) await s.set(key, "1").catch((e) => log.warn("register failed", { error: String(e) }));
  else local.set(key, Date.now());
  refreshedAt = Date.now();
  await refresh();
  return async () => {
    local.delete(key);
    if (s) await s.delete(key).catch(() => {});
  };
}

export const liveSearches = () => active;

// AIMD share: a 429 cuts this instance's rate by 40%, each quiet second restores 25%.
let factor = 1;
let lastAdjust = 0;
let nextSlot = 0;

export function xBackoff(retryAfterSec?: number) {
  factor = Math.max(0.1, factor * 0.6);
  lastAdjust = Date.now();
  if (retryAfterSec && retryAfterSec > 0) nextSlot = Math.max(nextSlot, Date.now() + Math.min(5, retryAfterSec) * 1000);
}

export function currentRps(): number {
  if (factor < 1 && Date.now() - lastAdjust > 1_000) {
    factor = Math.min(1, factor * 1.25);
    lastAdjust = Date.now();
  }
  return Math.max(MIN_RPS, Math.min(LOCAL_MAX_RPS, GLOBAL_RPS / active) * factor);
}

/** Reserves the next request slot; false when the wait would exceed `maxWaitMs` (caller skips the page). */
export async function pace(maxWaitMs = MAX_WAIT_MS): Promise<boolean> {
  maybeRefresh();
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  if (slot - now > maxWaitMs) return false;
  nextSlot = slot + 1000 / currentRps();
  if (slot > now) await sleep(slot - now);
  return true;
}
