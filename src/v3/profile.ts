/**
 * Run profiles. "default" is the behaviour everyone gets with no flag. "newpostcode" is New Postcode's research use
 * (Canadians moving to Italy, Ireland, Portugal, Spain, France, and leaving Canada): links-only storage, poster tags,
 * targeted subreddits, cheaper runs. Select with --profile=newpostcode or CONSENSUS_PROFILE=newpostcode; any flag
 * below overrides the profile's value.
 */
export type ProfileName = "default" | "newpostcode";
export type StoreMode = "full" | "links";

export interface Profile {
  name: ProfileName;
  /** What a saved run holds: everything, or links/ids/dates/scores/handles/labels only (no post text). */
  store: StoreMode;
  /** Batch rules: one search at a time, Reddit only by default, budget stop, manifest and resume. */
  research: boolean;
  /** Sorter writes poster tags (first-hand, origin, destination, phase, language) instead of the sales-lead column. */
  tags: boolean;
  /** Skip Reddit author profiles and subreddit icons (UI-only extras), and the "best X" pick tally. */
  lean: boolean;
  /** Subreddits always searched with site: (beyond the planner's picks). */
  subs: string[];
  /** Subreddits whose threads are never fetched. */
  denySubs: string[];
  /** Extra planner searches in these languages (two-letter codes), with Serper hl/gl. */
  lang: string[];
  /** Paraphrased quote-bank rows written per option at the end of a run. */
  quotesPerOption: number;
}

const DEFAULT: Profile = { name: "default", store: "full", research: false, tags: false, lean: false, subs: [], denySubs: [], lang: [], quotesPerOption: 0 };

export const PROFILES: Record<ProfileName, Profile> = {
  default: DEFAULT,
  newpostcode: {
    name: "newpostcode",
    store: "links",
    research: true,
    tags: true,
    lean: true,
    subs: ["ItalyExpat", "PortugalExpats", "GoingToSpain", "Expats_In_France", "expats", "PersonalFinanceCanada", "cantax", "italy", "Portugal", "askspain", "france", "ireland", "MoveToIreland", "AmerExit"],
    denySubs: ["Italian", "ItalyTravel", "irishtourism", "travel"],
    lang: [],
    quotesPerOption: 5,
  },
};

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim().replace(/^\/?r\//i, "")).filter(Boolean);

/** Profile from CLI flags (`--profile`, `--store`, `--research`, `--subs`, `--deny-subs`, `--lang`) and the environment. */
export function resolveProfile(flags: Record<string, string | undefined>, env: Record<string, string | undefined> = process.env): Profile {
  const name = (flags.profile ?? env.CONSENSUS_PROFILE ?? "default").trim() || "default";
  if (!(name in PROFILES)) throw new Error(`Unknown profile "${name}" (expected ${Object.keys(PROFILES).join(" or ")})`);
  const p: Profile = { ...PROFILES[name as ProfileName] };
  if (flags.store !== undefined) {
    if (flags.store !== "full" && flags.store !== "links") throw new Error(`--store must be links or full, got "${flags.store}"`);
    p.store = flags.store;
  }
  if ("research" in flags) p.research = true;
  if (flags.subs !== undefined) p.subs = list(flags.subs);
  if (flags["deny-subs"] !== undefined) p.denySubs = list(flags["deny-subs"]);
  if (flags.lang !== undefined) p.lang = list(flags.lang).map((l) => l.toLowerCase());
  if (flags.quotes !== undefined) p.quotesPerOption = Number(flags.quotes);
  return p;
}
