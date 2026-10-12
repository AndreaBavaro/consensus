export type Source = "reddit" | "twitter";

/** A post or comment from any source, in the shape the pipeline and frontend expect. */
export interface Comment {
  content: string;
  score: number;
  upvotes: number;
  author: string;
  comment_url: string;
  created_utc: number | null;
  created_at: string | null;
  post_title: string;
  post_url: string;
  post_position: number;
  post_created_utc: number | null;
  /** "r/<name>" for Reddit, "X" for Twitter. */
  subreddit: string | null;
  source: Source;
  /** Raw like count for X; `score` is rescaled to Reddit's range. */
  likes?: number;
}

export interface SearchResult {
  title: string;
  link: string;
  subreddit: string | null;
  /** X posts only. */
  likes?: number;
  replies?: number;
}

export interface Opinion {
  title: string;
  description: string;
}

export interface ClassifiedComment extends Comment {
  supporting_themes: string[];
  ai_score: number;
}

export interface SourceCount {
  name: string;
  count: number;
}

/** An opinion as streamed in `first_batch` and `final_opinion` events. */
export interface OpinionResult extends Opinion {
  comments_support: ClassifiedComment[];
  total_upvotes: number;
  subreddit_total: SourceCount[];
  /** Share of upvote-weighted support; absent for the "other" bucket and partial first-batch results. */
  percentage?: number;
  /** Per platform: supporting comments, and this option's share of that platform's votes alone. */
  by_source?: Record<Source, { comments: number; percentage: number }>;
}

/** Emitted once every comment is in: how much was read from each platform. */
export interface SourceStats {
  reddit: { threads: number; comments: number };
  twitter: { posts: number; replies: number; queries: string[] };
}

export interface Insight {
  insight_phrase: string;
  sentiment: string;
  supporting_comments: (Comment & { index: number })[];
  upvotes: number;
  temporal_context: string | null;
}

export interface StreamEvent {
  event: string;
  data: unknown;
}

export function isoFromEpoch(epoch: number | null | undefined): string | null {
  return epoch ? new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
}
