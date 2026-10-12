import { useCallback, useEffect, useReducer, useState } from 'react';
import { ApiError, streamSearch, type AuthorProfile, type Community, type Done, type Meta, type PlanOption, type Poll, type Post, type Progress, type Reason, type SearchParams, type Theme } from './api';

export type Phase = 'connecting' | 'streaming' | 'done' | 'error' | 'gated';

export interface SearchState {
  phase: Phase;
  meta: Meta | null;
  progress: Progress | null;
  options: PlanOption[];
  poll: Poll | null;
  posts: Record<string, Post>;
  postsVersion: number;
  reasons: Record<string, Reason>;
  themes: Theme[];
  authors: Record<string, AuthorProfile>;
  communities: Record<string, Community>;
  done: Done | null;
  error: { status: number; code: string; message: string } | null;
}

const initial: SearchState = {
  phase: 'connecting',
  meta: null,
  progress: null,
  options: [],
  poll: null,
  posts: {},
  postsVersion: 0,
  reasons: {},
  themes: [],
  authors: {},
  communities: {},
  done: null,
  error: null,
};

type Action =
  | { type: 'reset' }
  | { type: 'events'; events: { event: string; data: any }[] }
  | { type: 'ended' }
  | { type: 'fail'; error: SearchState['error'] };

function reducer(s: SearchState, a: Action): SearchState {
  switch (a.type) {
    case 'reset':
      return initial;
    case 'fail':
      return { ...s, phase: a.error?.code === 'signup_required' ? 'gated' : 'error', error: a.error };
    case 'ended':
      if (s.phase === 'done' || s.phase === 'error') return s;
      return s.poll ? { ...s, phase: 'done' } : { ...s, phase: 'error', error: { status: 0, code: 'ended', message: 'The search stopped before it finished. Please try again.' } };
    case 'events': {
      const n = { ...s };
      let posts = s.posts;
      let changed = false;
      for (const { event, data } of a.events) {
        switch (event) {
          case 'meta':
            n.meta = data;
            if (n.phase === 'connecting') n.phase = 'streaming';
            break;
          case 'progress':
            n.progress = data;
            break;
          case 'plan':
            n.options = data.options;
            break;
          case 'posts':
            if (!changed) {
              posts = { ...posts };
              changed = true;
            }
            for (const p of data.posts as Post[]) posts[p.id] = p;
            break;
          case 'poll':
            n.poll = data;
            break;
          case 'reasons':
            n.reasons = { ...n.reasons, [data.option_id]: data };
            break;
          case 'themes':
            n.themes = Array.isArray(data?.themes) ? data.themes : [];
            break;
          case 'authors':
            n.authors = { ...n.authors, ...data.profiles };
            break;
          case 'communities':
            n.communities = { ...n.communities, ...data.communities };
            break;
          case 'done':
            n.done = data;
            n.phase = 'done';
            break;
          case 'error':
            n.phase = 'error';
            n.error = { status: 500, code: 'stream_error', message: data?.message ?? 'Something went wrong while building this poll.' };
            break;
        }
      }
      n.posts = posts;
      if (changed) n.postsVersion = s.postsVersion + 1;
      return n;
    }
  }
}

/** Streams one search. Events are batched per animation frame so thousands of posts never block the UI. */
export function useSearch(params: SearchParams | null) {
  const [attempt, setAttempt] = useState(0);
  const [state, dispatch] = useReducer(reducer, initial);
  const key = params ? JSON.stringify(params) : '';

  useEffect(() => {
    if (!params) return;
    dispatch({ type: 'reset' });
    const ac = new AbortController();
    let queue: { event: string; data: any }[] = [];
    let raf = 0;
    const flush = () => {
      raf = 0;
      const q = queue;
      queue = [];
      if (q.length) dispatch({ type: 'events', events: q });
    };
    streamSearch(
      params,
      (event, data) => {
        queue.push({ event, data });
        if (!raf) raf = requestAnimationFrame(flush);
      },
      ac.signal,
    )
      .then(() => {
        if (ac.signal.aborted) return;
        flush();
        dispatch({ type: 'ended' });
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        flush();
        dispatch({
          type: 'fail',
          error: e instanceof ApiError ? { status: e.status, code: e.code, message: e.message } : { status: 0, code: 'network', message: "Couldn't reach Consensus. Check your connection and try again." },
        });
      });
    return () => {
      ac.abort();
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { state, retry };
}
