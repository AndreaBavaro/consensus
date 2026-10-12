import type { CSSProperties } from 'react';

export type {
  ClassifiedComment,
  Comment,
  Insight,
  OpinionResult,
  SearchResult as SearchSource,
  SourceCount,
  SourceStats,
} from '../../src/lib/types';

export type DateFilter = 'all' | 'day' | 'week' | 'month' | 'year' | 'custom';
export type Platform = 'all' | 'reddit' | 'twitter';
export type SortBy = 'relevance' | 'upvotes' | 'date' | null;

/** Inline style that also accepts CSS custom properties like `--index`. */
export type CSSVars = CSSProperties & Record<`--${string}`, string | number>;
