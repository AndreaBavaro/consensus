import type { Poll, PollOption, Post, Reason, Theme, V3Source } from '../../../src/v3/types';

export type { Poll, PollOption, Post, Reason, Theme, V3Source };
export type Intent = 'looking' | 'switching' | 'frustrated' | 'just_bought';

export interface PlanOption {
  id: string;
  title: string;
  description: string;
  is_other: boolean;
}
export interface Progress {
  stage: string;
  elapsed_ms: number;
  reddit: { threads: number; posts: number; done: boolean };
  x: { posts: number; done: boolean };
  sorted: number;
  pool: number;
}
export interface Meta {
  id: string;
  query: string;
  since: string | null;
  until: string | null;
  sources: V3Source[];
  cached: boolean;
  mock?: boolean;
}
export interface Community {
  icon: string | null;
  color: string | null;
  subscribers: number | null;
  url: string;
}
export interface AuthorProfile {
  avatar?: string | null;
  karma?: number | null;
  name?: string | null;
}
export interface Done {
  id: string;
  status: 'ok' | 'thin' | 'empty' | 'error';
  /** Set when status is error: the LLM or search provider failed (the UI still shows the empty state). */
  error_reason?: 'llm_unavailable' | 'search_unavailable';
  reason?: 'off_topic' | string;
  total_ms: number;
  timing?: Record<string, number>;
  cost?: { total_usd: number };
  /** Backend sanity checks (e.g. "other_high", "one_option", "thin_pool"); empty when the poll looks healthy. */
  quality?: { flags?: string[] };
}

export interface SearchParams {
  query?: string;
  since?: string;
  until?: string;
  sources: V3Source[];
  id?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export type ApiMode = 'mock' | 'live';

/** Live by default. Mock (recorded streams) only with VITE_USE_MOCK=1, ?mock=1 (sticky) or localStorage cs_api=mock. */
export function apiMode(): ApiMode {
  try {
    const m = new URLSearchParams(location.search).get('mock');
    if (m === '1') localStorage.setItem('cs_api', 'mock');
    else if (m === '0') localStorage.setItem('cs_api', 'live');
    const o = localStorage.getItem('cs_api');
    if (o === 'mock' || o === 'live') return o;
  } catch {
    /* private mode */
  }
  return import.meta.env.VITE_USE_MOCK === '1' ? 'mock' : 'live';
}

// Saved results (featured examples, share links) are fetched ahead on hover/tap, then replayed with a short,
// paced animation so the poll still builds on screen but finishes in well under a second.
const ahead = new Map<string, Promise<string>>();
export function prefetchSaved(id: string) {
  if (!id || ahead.has(id) || apiMode() === 'mock') return;
  if (ahead.size >= 6) ahead.delete(ahead.keys().next().value!);
  const p = fetch(`/api/v3/search?id=${encodeURIComponent(id)}`, { credentials: 'same-origin', headers: { Accept: 'text/event-stream' } }).then((r) =>
    r.ok && (r.headers.get('content-type') ?? '').includes('event-stream') ? r.text() : Promise.reject(new Error('not saved')),
  );
  p.catch(() => ahead.delete(id));
  ahead.set(id, p);
}

function parseBlocks(text: string, onEvent: (event: string, data: any) => void) {
  for (const block of text.split('\n\n')) {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trimStart();
    }
    if (!data) continue;
    try {
      onEvent(event, JSON.parse(data));
    } catch {
      /* skip a malformed frame */
    }
  }
}

const REPLAY_MS = 900;
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((res) => (signal.aborted ? res() : setTimeout(res, ms)));

async function replayAhead(text: string, onEvent: (event: string, data: any) => void, signal: AbortSignal) {
  const evs: { event: string; data: any }[] = [];
  parseBlocks(text, (event, data) => evs.push({ event, data }));
  // Pace by poll updates: everything before each poll lands together, polls step the donut forward.
  const polls = evs.filter((e) => e.event === 'poll').length;
  const step = Math.min(160, (REPLAY_MS - 220) / Math.max(1, polls));
  let first = true;
  for (const e of evs) {
    if (signal.aborted) return;
    if (e.event === 'poll') await sleep(first ? 220 : step, signal), (first = false);
    if (signal.aborted) return;
    onEvent(e.event, e.data);
  }
}

export async function streamSearch(p: SearchParams, onEvent: (event: string, data: any) => void, signal: AbortSignal) {
  const pre = p.id ? ahead.get(p.id) : undefined;
  if (pre) {
    const text = await pre.catch(() => null);
    if (text != null) return replayAhead(text, onEvent, signal);
  }
  const qs = new URLSearchParams();
  if (p.id) qs.set('id', p.id);
  else {
    qs.set('query', p.query ?? '');
    if (p.since) qs.set('since', p.since);
    if (p.until) qs.set('until', p.until);
    qs.set('sources', p.sources.join(','));
  }
  const speed = new URLSearchParams(location.search).get('speed');
  const mock = apiMode() === 'mock';
  if (mock && speed) qs.set('speed', speed);
  const res = await fetch(`${mock ? '/api/mock/v3/search' : '/api/v3/search'}?${qs}`, {
    credentials: 'same-origin',
    signal,
    headers: { Accept: 'text/event-stream' },
  });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('event-stream')) {
    let body: { error?: string; message?: string } = {};
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, body.error ?? 'error', body.message ?? 'Something went wrong. Please try again.');
  }
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trimStart();
      }
      if (!data) continue;
      try {
        onEvent(event, JSON.parse(data));
      } catch {
        /* skip a malformed frame */
      }
    }
  }
}
