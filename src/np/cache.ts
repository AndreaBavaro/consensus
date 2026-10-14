/**
 * Opt-in thread cache (--cache-dir=.np-cache --cache-ttl-days=N), off by default. It skips re-downloading a thread
 * fetched within the TTL. NOTE: it stores Reddit post text on this machine; how long to keep it is Andrea's decision.
 * Purge with --purge-cache.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchPostListing } from "../sources/reddit/client.ts";
import { CACHED, collectReddit, fetchThread } from "../v3/reddit.ts";
import type { V3Deps } from "../v3/run.ts";

const file = (dir: string, id: string) => join(dir, `${id.replace(/\W/g, "")}.json`);

/** A listing fetcher that answers from the cache when the file is younger than ttlDays. */
export function cachedListing(dir: string, ttlDays: number, inner: (id: string) => Promise<unknown> = fetchPostListing) {
  return async (id: string): Promise<unknown> => {
    const f = file(dir, id);
    try {
      if (Date.now() - (await stat(f)).mtimeMs < ttlDays * 86_400_000) {
        const raw = JSON.parse(await readFile(f, "utf8"));
        if (raw && typeof raw === "object") Object.defineProperty(raw, CACHED, { value: true });
        return raw;
      }
    } catch {
      // missing or unreadable: fetch
    }
    const raw = await inner(id);
    if (raw) {
      await mkdir(dir, { recursive: true });
      await writeFile(f, JSON.stringify(raw));
    }
    return raw;
  };
}

/** runV3 deps that route thread downloads through the cache. */
export function cachedDeps(dir: string, ttlDays: number): Partial<V3Deps> {
  const listing = cachedListing(dir, ttlDays);
  return { collectReddit: (q, w, onThread, onHits, signal, target = {}) => collectReddit(q, w, onThread, onHits, signal, { ...target, fetchThread: (id, win) => fetchThread(id, win, listing) }) };
}

/** Deletes every cached thread in `dir` (only *.json files there); returns how many. */
export async function purgeCache(dir: string): Promise<number> {
  let n = 0;
  for (const f of await readdir(dir).catch(() => [] as string[]))
    if (f.endsWith(".json")) {
      await rm(join(dir, f));
      n++;
    }
  return n;
}
