/**
 * Links-only storage. Reddit's terms bar commercial reuse of posts, so a research run SAVES links, ids, dates,
 * scores, handles, labels and paraphrases, never post text. Post text lives in memory during the run only.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StoreMode } from "../v3/profile.ts";
import type { V3Event } from "../v3/types.ts";

const POST_KEYS = ["id", "source", "kind", "depth", "url", "thread_url", "thread_title", "community", "created_at", "score", "replies", "option", "strength", "intent", "rank", "relevance", "tags"] as const;

function stripPost(p: Record<string, any>) {
  const out: Record<string, unknown> = {};
  for (const k of POST_KEYS) if (k in p) out[k] = p[k];
  out.author = { handle: p.author?.handle ?? null, profile_url: p.author?.profile_url ?? null };
  return out;
}

/** The same event list with post text removed; every link and label is kept. */
export function toLinksOnly<E extends { event: string; data: any }>(events: E[]): E[] {
  return events.map((e) => {
    const d = e.data;
    switch (e.event) {
      case "posts":
        return { ...e, data: { ...d, posts: d.posts.map(stripPost) } };
      case "reasons":
        // The summary and point labels are written by the model; the quote is copied from a post.
        return { ...e, data: { ...d, points: (d.points ?? []).map(({ quote: _q, ...pt }: any) => pt) } };
      case "themes":
        return { ...e, data: { ...d, themes: (d.themes ?? []).map((t: any) => ({ ...t, quotes: (t.quotes ?? []).map(({ text: _t, ...q }: any) => q) })) } };
      case "done": {
        const { debug: _debug, ...rest } = d;
        return { ...e, data: rest };
      }
      default:
        return e;
    }
  });
}

export interface SavedRun {
  query: string;
  since?: string;
  until?: string;
  events: (V3Event & { t?: number; t_ms?: number })[];
  [k: string]: unknown;
}

export async function saveRun(path: string, run: SavedRun, store: StoreMode): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const body = store === "links" ? { ...run, store, events: toLinksOnly(run.events) } : { ...run, store };
  await writeFile(path, JSON.stringify(body, null, 1));
}
