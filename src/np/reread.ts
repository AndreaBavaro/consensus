/**
 * Re-read saved Reddit posts for validation (New Postcode BRIEF-CONSENSUS section 5).
 *
 * Each input row (a quote-bank id, a post or comment URL, an optional paraphrase or quote) gets one record with a
 * machine-readable status: live | deleted | removed | not_found | fetch_failed. Post text stays in memory: it is
 * returned for the validating reader to print, and toJsonRecord() drops it (a short hash is kept instead), so
 * nothing written to disk holds post text (links-only decision, PROJECT.md 2026-10-14).
 *
 * Fetch path: oauth.reddit.com/comments/{thread}/_/{comment}?context=2 on the same hedged, proxied client the
 * pipeline uses. The focused permalink returns the target comment however deep it sits in a large thread, plus its
 * parent. /api/info would batch better but answers 403 on the Android-client token (spike, 2026-10-16), so a bare
 * comment fullname (t1_x without its thread) cannot be looked up; thread fullnames (t3_x) can.
 */
import { createHash } from "node:crypto";
import { fetchRedditPathStatus } from "../sources/reddit/client.ts";

export type RereadStatus = "live" | "deleted" | "removed" | "not_found" | "fetch_failed";
export type FetchResult = { status: "ok"; body: unknown } | { status: "not_found" | "failed" };

export interface RereadInput {
  id: string;
  url: string;
  paraphrase?: string;
}

export interface RereadRecord {
  id: string;
  url: string;
  fullname: string | null;
  status: RereadStatus;
  /** In memory only; never serialised (see toJsonRecord). */
  text: string | null;
  /** In memory only; never serialised. */
  parent_excerpt: string | null;
  score: number | null;
  created_utc: number | null;
  date: string | null;
  community: string | null;
  thread_title: string | null;
  paraphrase?: string;
}

export interface RereadJson {
  id: string;
  url: string;
  fullname: string | null;
  status: RereadStatus;
  score: number | null;
  date: string | null;
  community: string | null;
  thread_title: string | null;
  text_chars: number | null;
  text_sha256: string | null;
  max_shared_run: number | null;
  quote_found: boolean | null;
}

export interface RereadStats {
  fetches: number;
  bytes: number;
}

/** Thread id and optional comment id from a Reddit permalink, or from a thread fullname (t3_x). */
export function parseRedditRef(ref: string): { threadId: string; commentId: string | undefined; fullname: string } | null {
  const s = ref.trim();
  const t3 = s.match(/^t3_(\w+)$/);
  if (t3) return { threadId: t3[1]!, commentId: undefined, fullname: s };
  const m = s.match(/^https?:\/\/(?:[\w-]+\.)?reddit\.com\/(?:r\/[^/]+\/)?comments\/(\w+)(?:\/[^/]*\/(\w+))?/);
  if (!m) return null;
  return { threadId: m[1]!, commentId: m[2], fullname: m[2] ? `t1_${m[2]}` : `t3_${m[1]}` };
}

/** Rows from a links file: `id<TAB>url<TAB>paraphrase`, or a bare URL per line (id = row number). # starts a comment. */
export function parseInput(content: string): RereadInput[] {
  const rows: RereadInput[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.includes("\t")) {
      const [id, url, paraphrase] = raw.split("\t").map((x) => x.trim());
      rows.push({ id: id!, url: url!, paraphrase: paraphrase || undefined });
    } else {
      rows.push({ id: String(rows.length + 1), url: line, paraphrase: undefined });
    }
  }
  return rows;
}

const words = (s: string): string[] => s.toLowerCase().replace(/[’‘`]/g, "'").match(/[\p{L}\p{N}]+/gu) ?? [];

/** Longest run of consecutive words shared by a and b, after case-folding and stripping punctuation. */
export function maxSharedRun(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  let best = 0;
  let prev = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) {
      if (x[i - 1] === y[j - 1]) {
        cur[j] = prev[j - 1]! + 1;
        if (cur[j]! > best) best = cur[j]!;
      }
    }
    prev = cur;
  }
  return best;
}

/** True when every word of the quote appears in the text as one consecutive run (quote marks, case, spacing folded). */
export function quoteFound(quote: string, text: string): boolean {
  const n = words(quote).length;
  return n > 0 && maxSharedRun(quote, text) === n;
}

type Thing = { kind: string; data: any };

function findComment(children: Thing[] | undefined, id: string): any | null {
  for (const c of children ?? []) {
    if (c.kind !== "t1") continue;
    if (c.data.id === id) return c.data;
    const kids = c.data.replies && typeof c.data.replies === "object" ? c.data.replies.data?.children : undefined;
    const hit = findComment(kids, id);
    if (hit) return hit;
  }
  return null;
}

const iso = (t: number | null | undefined) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : null);

function openerStatus(post: any): RereadStatus {
  const cat = post.removed_by_category as string | null | undefined;
  if (cat === "deleted" || post.selftext === "[deleted]") return "deleted";
  if (cat || post.selftext === "[removed]") return "removed";
  return "live";
}

function commentStatus(c: any): RereadStatus {
  if (c.body === "[deleted]") return "deleted";
  if (c.body === "[removed]" || c.removed_by_category) return "removed";
  return "live";
}

/** One record per input row, in input order. Each distinct permalink is fetched once. */
export async function rereadPosts(
  rows: RereadInput[],
  opts: { fetchPath?: (path: string) => Promise<FetchResult>; concurrency?: number; stats?: RereadStats } = {},
): Promise<RereadRecord[]> {
  const fetchPath = opts.fetchPath ?? fetchRedditPathStatus;
  const cache = new Map<string, Promise<FetchResult>>();
  const get = (path: string) => {
    if (!cache.has(path))
      cache.set(
        path,
        fetchPath(path).then((r) => {
          if (opts.stats) {
            opts.stats.fetches++;
            if (r.status === "ok") opts.stats.bytes += Buffer.byteLength(JSON.stringify(r.body));
          }
          return r;
        }),
      );
    return cache.get(path)!;
  };

  const one = async (row: RereadInput): Promise<RereadRecord> => {
    const base: RereadRecord = { id: row.id, url: row.url, fullname: null, status: "not_found", text: null, parent_excerpt: null, score: null, created_utc: null, date: null, community: null, thread_title: null, ...(row.paraphrase ? { paraphrase: row.paraphrase } : {}) };
    const ref = parseRedditRef(row.url);
    if (!ref) return base;
    base.fullname = ref.fullname;
    const path = ref.commentId ? `/comments/${ref.threadId}/_/${ref.commentId}?context=2&raw_json=1` : `/comments/${ref.threadId}?limit=1&depth=1&raw_json=1`;
    const res = await get(path);
    if (res.status !== "ok") return res.status === "failed" ? { ...base, status: "fetch_failed" } : base;
    const raw = res.body as [any, any] | null;
    const post = raw?.[0]?.data?.children?.[0]?.data;
    if (!post) return base;
    base.thread_title = post.title ?? null;
    base.community = post.subreddit ? `r/${post.subreddit}` : null;
    const openerText = `${post.title ?? ""}\n${post.selftext ?? ""}`.trim();
    if (!ref.commentId) {
      const status = openerStatus(post);
      return { ...base, status, text: status === "live" ? openerText : null, score: post.score ?? null, created_utc: post.created_utc ?? null, date: iso(post.created_utc) };
    }
    const c = findComment(raw?.[1]?.data?.children, ref.commentId);
    if (!c) return base;
    const status = commentStatus(c);
    let parent: string | null = null;
    if (typeof c.parent_id === "string" && c.parent_id.startsWith("t1_")) {
      const p = findComment(raw?.[1]?.data?.children, c.parent_id.slice(3));
      parent = p?.body && p.body !== "[deleted]" && p.body !== "[removed]" ? String(p.body).slice(0, 400) : null;
    } else {
      parent = openerText.slice(0, 400) || null;
    }
    return { ...base, status, text: status === "live" ? String(c.body) : null, parent_excerpt: parent, score: c.score ?? null, created_utc: c.created_utc ?? null, date: iso(c.created_utc) };
  };

  const out = new Array<RereadRecord>(rows.length);
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const i = next++;
      out[i] = await one(rows[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, rows.length)) }, worker));
  return out;
}

/** The serialisable form: metadata, status, overlap and a short text hash; never the text or the parent excerpt. */
export function toJsonRecord(r: RereadRecord): RereadJson {
  const text = r.text;
  return {
    id: r.id,
    url: r.url,
    fullname: r.fullname,
    status: r.status,
    score: r.score,
    date: r.date,
    community: r.community,
    thread_title: r.thread_title,
    text_chars: text ? text.length : null,
    text_sha256: text ? createHash("sha256").update(text).digest("hex").slice(0, 12) : null,
    max_shared_run: text && r.paraphrase ? maxSharedRun(r.paraphrase, text) : null,
    quote_found: text && r.paraphrase ? quoteFound(r.paraphrase, text) : null,
  };
}

/** Lookup table keyed by quote-bank row id and by Reddit fullname. */
export function indexById(records: RereadJson[]): Record<string, RereadJson> {
  const idx: Record<string, RereadJson> = {};
  for (const r of records) {
    idx[r.id] = r;
    if (r.fullname && !(r.fullname in idx)) idx[r.fullname] = r;
  }
  return idx;
}

/** The printed block for one record (CLI stdout and the MCP tool's text): status, metadata, the line, parent, post text. */
export function formatRecord(r: RereadRecord, chars = 1500, includeText = true): string {
  const j = toJsonRecord(r);
  const flat = (s: string) => s.replace(/\s+/g, " ");
  const post = !includeText ? (r.text ? "(hidden: include_text false)" : `(${r.status})`) : r.text ? flat(r.text).slice(0, chars) : `(${r.status})`;
  return [
    `===== #${r.id} ${r.url}`,
    `STATUS ${r.status} | THREAD ${r.thread_title ?? "(not found)"} | ${r.community ?? ""}`,
    `DATE ${r.date ?? "?"} SCORE ${r.score ?? "?"}${j.max_shared_run !== null ? ` SHARED_RUN ${j.max_shared_run} QUOTE_FOUND ${j.quote_found}` : ""}`,
    ...(r.paraphrase ? [`LINE ${r.paraphrase}`] : []),
    ...(includeText && r.parent_excerpt ? [`PARENT ${flat(r.parent_excerpt).slice(0, 300)}`] : []),
    `POST ${post}`,
  ].join("\n");
}

export const countStatuses = (recs: { status: RereadStatus }[]) =>
  recs.reduce<Partial<Record<RereadStatus, number>>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});

/**
 * Body of the MCP tool consensus_reread: re-read the rows, return the printed blocks for the reader (text) and the
 * serialisable records (structured: status, metadata, overlap, hash; never post text).
 */
export async function rereadReport(
  rows: RereadInput[],
  opts: { fetchPath?: (path: string) => Promise<FetchResult>; concurrency?: number; chars?: number; includeText?: boolean } = {},
): Promise<{ text: string; structured: { counts: Partial<Record<RereadStatus, number>>; proxy: RereadStats; records: RereadJson[]; by_id: Record<string, RereadJson> } }> {
  const stats: RereadStats = { fetches: 0, bytes: 0 };
  const recs = await rereadPosts(rows, { fetchPath: opts.fetchPath, concurrency: opts.concurrency, stats });
  const records = recs.map(toJsonRecord);
  const counts = countStatuses(recs);
  const summary = `rows ${recs.length} · ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ")} · fetches ${stats.fetches} · bytes ${stats.bytes}`;
  const text = [...recs.map((r) => formatRecord(r, opts.chars ?? 1500, opts.includeText ?? true)), summary].join("\n\n");
  return { text, structured: { counts, proxy: stats, records, by_id: indexById(records) } };
}
