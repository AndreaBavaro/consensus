import type { DateFilter, Insight, OpinionResult, SearchSource, SourceStats } from '../types';

/** Chat history lives only in this browser; there are no accounts. */
const KEY = 'consensus-history-v1';
const MAX_SESSIONS = 40;

export interface SavedSearch {
  query: string;
  timestamp: number;
  fromDate: string | null;
  toDate: string | null;
  dateFilter: DateFilter | string;
  sources: SearchSource[];
  content: OpinionResult[];
  insights: Insight[];
  source_stats: SourceStats | null;
}

export interface SavedSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: SavedSearch[];
}

function readAll(): SavedSession[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Newest first; when storage is full the oldest chats are dropped until it fits. */
function writeAll(sessions: SavedSession[]): void {
  let list = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
  while (list.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return;
    } catch {
      list = list.slice(0, -1);
    }
  }
  localStorage.removeItem(KEY);
}

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const history = {
  list(): Pick<SavedSession, 'id' | 'title' | 'updatedAt'>[] {
    return readAll()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
  },

  get(id: string): SavedSession | null {
    return readAll().find((s) => s.id === id) ?? null;
  },

  /** Adds a finished search to `sessionId`, or starts a new chat when there is none; returns the chat id. */
  save(sessionId: string | null, search: SavedSearch): string {
    const all = readAll();
    const existing = sessionId ? all.find((s) => s.id === sessionId) : undefined;
    if (existing) {
      existing.messages = [...existing.messages.filter((m) => m.query !== search.query), search];
      existing.updatedAt = Date.now();
      writeAll(all);
      return existing.id;
    }
    const id = newId();
    writeAll([...all, { id, title: search.query, updatedAt: Date.now(), messages: [search] }]);
    return id;
  },

  remove(id: string): void {
    writeAll(readAll().filter((s) => s.id !== id));
  },
};
