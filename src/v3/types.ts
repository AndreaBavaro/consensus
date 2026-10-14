/**
 * v3 streaming contract (GET /api/v3/search). Every SSE event is `event: <name>` + `data: <json>`; see
 * outputs/backend-contract.md for the full description and a recorded sample stream.
 */
export type V3Source = "reddit" | "x";
export type Intent = "looking" | "switching" | "frustrated" | "just_bought";
export const INTENTS: Intent[] = ["switching", "looking", "frustrated", "just_bought"];

export interface Author {
  handle: string;
  name: string | null;
  profile_url: string | null;
  avatar: string | null;
  /** X followers. Null for Reddit (Reddit has no public follower count; see `karma`). */
  followers: number | null;
  /** Reddit total karma, filled in for lead authors by the `authors` event. */
  karma?: number | null;
  verified?: boolean;
}

/** A post or comment as collected, before sorting. */
export interface RawPost {
  id: string;
  source: V3Source;
  /** opener = a Reddit thread's opening post; reply = an X reply found by search. */
  kind: "opener" | "comment" | "post" | "reply";
  /** Reddit reply depth (0 = top-level comment, -1 = opener). 0 for X. */
  depth: number;
  text: string;
  url: string;
  thread_title: string | null;
  thread_url: string | null;
  /** "r/<subreddit>" for Reddit, null for X. */
  community: string | null;
  created_utc: number | null;
  /** Reddit score or X likes. */
  score: number;
  /** Direct replies (Reddit: replies loaded in the tree; X: reply count). */
  replies?: number;
  /** X reposts + quotes. */
  reposts?: number;
  views?: number;
  /** Reddit only: the comment being replied to, so short replies ("Yes", "This") can be read. Not streamed. */
  parent_text?: string;
  author: Author;
}

/** Research profile only: who the poster is, as the sorter reads it ("-" = cannot tell). */
export interface PostTags {
  /** S = own experience, L = local about their own country, H = hearsay. */
  firsthand: "S" | "L" | "H" | "-";
  origin: "CA" | "US" | "UK" | "EU" | "OT" | "-";
  dest: "IT" | "IE" | "PT" | "ES" | "FR" | "OT" | "-";
  /** P planning, A arriving, Y first year, E settled, R returned, X leaving Canada. */
  phase: "P" | "A" | "Y" | "E" | "R" | "X" | "-";
  /** Two-letter language code, or "-". */
  lang: string;
}

/** A sorted post as streamed in `posts` events. Only posts with a stance or a lead intent are streamed. */
export interface Post extends Omit<RawPost, "created_utc"> {
  created_at: string | null;
  /** Option id from `plan` ("o0".."o6" or "other"), or null when the post takes no side (it is then only a lead). */
  option: string | null;
  /** 3 = clear answer with a reason or experience, 2 = clear answer, 1 = weak lean, 0 = no stance. */
  strength: number;
  intent: Intent | null;
  /** Default "most relevant" order inside an option: strength x log-damped engagement. */
  rank: number;
  /**
   * 0..1, the default "Relevance" sort (KAN-410): how directly the post answers the question (sorter strength plus
   * whether all three sort models agreed), recency inside the date filter, and a small engagement prior. Sort
   * descending; ties fall back to `rank`. Does not depend on the option, so it survives Other splits.
   */
  relevance?: number;
  /** Research profile only (SearchRequest.tags). */
  tags?: PostTags;
}

export interface PollOption {
  id: string;
  /** Display order: real options by count, Other last. */
  index: number;
  title: string;
  description: string;
  is_other: boolean;
  count: number;
  /** Share of counted opinions (count / total opinions), one decimal. */
  percent: number;
  /** Engagement-weighted share (log-damped upvotes/likes, X capped at 40% of weight), for an optional toggle. */
  weighted_percent: number;
  by_source: Record<V3Source, number>;
  /** Lead counts among this option's opinions. */
  intents: Record<Intent, number>;
  leads: number;
  /** Research profile only: share (0..1) of this option's opinions dated within 24 months of the run. */
  recent_share?: number;
}

export interface Poll {
  final: boolean;
  total_opinions: number;
  options: PollOption[];
  sources: {
    reddit: { threads: number; opinions: number };
    x: { posts: number; opinions: number };
  };
  /** Every lead, including leads that take no side in the poll. */
  leads: { total: number } & Record<Intent, number>;
  pool: { collected: number; sorted: number; unsorted: number; removed_spam: number; no_stance: number; duplicates: number; author_capped: number; prefiltered?: number };
  /** Named picks too small to be their own option, now counted inside Other (largest first). */
  other_breakdown?: { title: string; count: number }[];
  /** "best X" polls (KAN-408): how many distinct named picks Other holds, for "Other: N other picks". */
  other_picks?: number;
  /**
   * What was READ, kept apart from what was COUNTED (KAN-409). Meta line: "{total_opinions} opinions counted from
   * {scanned.total} posts scanned". x_fetched = tweets returned by search before dedupe/filters; x_kept and
   * reddit_posts = posts that reached the sorter; reddit_threads = threads opened.
   */
  scanned?: { total: number; reddit_threads: number; reddit_posts: number; x_fetched: number; x_kept: number };
  /** Research profile only: the poll among first-hand posters from Canada or the US. */
  subsets?: { first_hand_na: { total: number; options: { id: string; count: number; percent: number }[] } };
}

export interface Reason {
  option_id: string;
  summary: string;
  points: { text: string; quote: string; post_id: string; url: string }[];
}

/**
 * A detailed, NON-exclusive theme: one specific argument ("YC's alumni network opens doors"). A post can carry
 * several themes, so counts do not add up to the poll total. `option_ids` = the options whose voters make it.
 */
export interface Theme {
  id: string;
  title: string;
  description: string;
  option_ids: string[];
  /** Opinions tagged with this theme. */
  count: number;
  /** count / total opinions, one decimal (themes overlap, so these do not sum to 100). */
  percent: number;
  by_option: Record<string, number>;
  /** by_option split by source, so "theme count under the current option and source tab" is a lookup (KAN-409). */
  by_option_source?: Record<string, Record<V3Source, number>>;
  by_source: Record<V3Source, number>;
  /** Every tagged post id, best first; every id was streamed in a `posts` event, so by_option[o] = ids with option o. */
  post_ids: string[];
  quotes: { post_id: string; url: string; text: string; source: V3Source; author: string }[];
}

export interface SearchRequest {
  query: string;
  /** YYYY-MM-DD, inclusive. */
  since?: string;
  /** YYYY-MM-DD, inclusive. */
  until?: string;
  sources: V3Source[];
  signal?: AbortSignal;
  /** Research runs: stop collecting and sorting once this much (USD) has been spent. Unset = no cap (today's behaviour). */
  budgetUsd?: number;
  /** Research profile: the sorter writes poster tags instead of the sales-lead column. */
  tags?: boolean;
}

export interface V3Event {
  event: "meta" | "plan" | "progress" | "posts" | "poll" | "reasons" | "themes" | "authors" | "communities" | "done" | "error";
  data: unknown;
}
