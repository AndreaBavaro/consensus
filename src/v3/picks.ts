/**
 * KAN-408: long-tail "best X" polls. While posts are sorted, a cheap model writes down the concrete pick(s) each
 * opinion names, the pick's cuisine (food questions) and whether it really answers the question. After sorting,
 * `planPicks` re-selects the up-to-8 options with the most real support across ALL posts (aliases merged), moves
 * Other posts that name a chosen pick into it, drops wrong-place picks and non-answers, and summarises the genuine
 * leftovers for "N other picks". When individual picks are too scattered (every restaurant in a city), options are
 * cuisines instead.
 */
import { logger } from "../lib/log.ts";
import { completeText } from "../llm.ts";
import { flat } from "./limit.ts";
import type { RawPost } from "./types.ts";

const log = logger("v3-picks");

export const PICKS_MODEL = () => process.env.PICKS_MODEL ?? "deepseek/deepseek-v4.1-flash";
export const PICKS_CHUNK = 40;

export interface PostPick {
  /** Names as written, main pick first (at most 3). Empty = no specific pick. */
  picks: string[];
  /** Group of the main pick: cuisine for food, brand for products, otherwise "". */
  kind: string;
  /** Y = real answer, W = pick outside the place asked about, X = not an answer (joke, promo, news, question). */
  code: "Y" | "W" | "X";
}

export function picksPrompt(query: string, optionTitles: string[], posts: RawPost[]): string {
  const body = posts
    .map((p, i) => `[${i}] ${p.parent_text ? `(replying to: "${flat(p.parent_text, 100)}") ` : ""}${flat(p.text, 260)}`)
    .join("\n");
  return `Poll question: "${query}". Current poll options: ${optionTitles.join("; ")}.
For each post write three fields:
- picks: the specific answers the poster recommends, loves or calls the best (exact names such as a restaurant, dish, product, movie, person), main pick first, at most 3, comma separated. If a pick is one of the current poll options, write that option's title exactly. NONE if there is no specific pick.
- group: for food or restaurant questions, the cuisine of the main pick (Japanese, Chinese, Vietnamese, Italian, Mexican, Korean, Indian, Thai, French, Middle Eastern, Indigenous...) or, for the local everyday food of that place, the dish (Poutine, Brunch, Burgers, Seafood, Pizza, Bakery, Donuts, Hot dogs); never a vague group such as Canadian, American, Local, Casual or Fusion. For products, the brand of the main pick (Nike, Asics, Li Ning...). Otherwise "-".
- code: Y = a real answer to the question (right subject, and located in the place the question names, if it names one); W = only when the question names a city or area and the pick is clearly somewhere else (never W when the question names no place); X = not an answer: no specific pick, a joke, a question, promotion, news, a celebrity or brand post, general talk. A post that names a pick it likes is Y, even if short or casual.
${body}
Output one line per post: "<index> | <picks> | <group> | <code>". Nothing else.`;
}

export function parsePicks(text: string, n: number): (PostPick | undefined)[] {
  const out: (PostPick | undefined)[] = new Array(n);
  for (const m of text.matchAll(/^\s*\[?(\d+)\]?\s*\|\s*([^|\n]*?)\s*\|\s*([^|\n]*?)\s*\|\s*([YWXywx])\b/gm)) {
    const i = Number(m[1]);
    if (i >= n || out[i]) continue;
    const picks = /^none\b/i.test(m[2]!) ? [] : m[2]!.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter((s) => s && !/^none$/i.test(s)).slice(0, 3);
    const kind = /^(-|none|n\/a)?$/i.test(m[3]!.trim()) ? "" : m[3]!.trim();
    out[i] = { picks, kind, code: m[4]!.toUpperCase() as PostPick["code"] };
  }
  return out;
}

export async function tallyPicks(query: string, optionTitles: string[], posts: RawPost[], signal?: AbortSignal): Promise<(PostPick | undefined)[]> {
  try {
    const text = await completeText(picksPrompt(query, optionTitles, posts), { model: PICKS_MODEL(), maxTokens: 40 * posts.length + 200, timeoutMs: 12_000, noReasoning: true, signal }, 1);
    return parsePicks(text, posts.length);
  } catch (e) {
    if (!signal?.aborted) log.warn("pick tally failed", { error: String(e).slice(0, 160) });
    return new Array(posts.length);
  }
}

// ---------------------------------------------------------------- names and aliases

const STOP = new Set(["the", "of", "and", "a", "an", "in", "at", "on", "st", "street", "restaurant", "restaurants", "cafe", "kitchen", "truck", "shop", "spot", "place", "co", "bar", "pizzeria", "taqueria", "nyc", "ny", "la", "sf"]);

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019]s\b/g, "s")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** "Joe's Pizza" and "joes" -> "joes" under "best pizza in nyc": words of the question and filler words are ignored. */
export function pickKey(name: string, query: string): string {
  const q = new Set(words(query).flatMap((w) => [w, w.replace(/s$/, ""), `${w}s`]));
  const all = words(name);
  let kept = all.filter((t) => !STOP.has(t) && !q.has(t));
  if (!kept.length) kept = all;
  // Model generations count as one pick: "Pegasus 41" = "Pegasus 37" = "Pegasus", "1080 v13" = "1080".
  while (kept.length > 1 && /^(v?\d{1,2}|\d+\.\d+|plus|pro|gen\d*)$/.test(kept[kept.length - 1]!)) kept = kept.slice(0, -1);
  return kept.join(" ");
}

/** Words that make a different title when added after a name ("The Dark Knight Rises", "Toy Story 2"). */
const SEQUEL = /^(rises|returns|begins|reloaded|revolutions|ii|iii|iv|2|3|4|5|part|chapter|origins|forever|resurrection|reborn|redux|legacy|awakens|strikes)$/;

/**
 * Same pick: one key's words start the other's ("johns" / "johns bleecker", "l b" / "l b spumoni gardens"), the
 * shorter one appears inside the longer one after a leading brand ("red hare" / "li ning red hare"), or they differ
 * only in spacing. Never when the longer one continues like a sequel ("dark knight" / "dark knight rises").
 */
export function sameKey(a: string, b: string): boolean {
  if (a === b) return true;
  const A = a.split(" ");
  const B = b.split(" ");
  if (A.join("") === B.join("")) return true;
  const [s, l] = A.length <= B.length ? [A, B] : [B, A];
  if (s.join("").length < 2) return false;
  if (s.every((t, i) => l[i] === t)) return !SEQUEL.test(l[s.length] ?? "");
  // Inside, not at the start ("pegasus" / "nike pegasus"): one-word names need 5+ letters (question words such as
  // "pizza" are already stripped from keys).
  if (s.length < 2 && s[0]!.length < 5) return false;
  for (let at = 1; at + s.length <= l.length; at++) if (s.every((t, i) => l[at + i] === t)) return true;
  return false;
}

interface Cluster {
  key: string;
  optionId?: string;
  names: Map<string, number>;
  posts: Set<string>;
}

class Clusters {
  list: Cluster[] = [];
  private exact = new Map<string, Cluster>();
  head(key: string, optionId?: string, name?: string): Cluster {
    const c: Cluster = { key, optionId, names: new Map(name ? [[name, 0]] : []), posts: new Set() };
    this.list.push(c);
    if (!this.exact.has(key)) this.exact.set(key, c);
    return c;
  }
  find(key: string): Cluster | undefined {
    return this.exact.get(key) ?? this.list.find((c) => sameKey(c.key, key));
  }
  add(key: string, name: string, postId?: string): Cluster {
    let c = this.find(key);
    if (!c) c = this.head(key);
    this.exact.set(key, c);
    c.names.set(name, (c.names.get(name) ?? 0) + 1);
    if (postId) c.posts.add(postId);
    return c;
  }
}

const display = (c: Cluster) => [...c.names].sort((a, b) => b[1] - a[1])[0]?.[0] ?? c.key;
const titleCase = (s: string) => s.replace(/\b\w/g, (ch) => ch.toUpperCase());

/** "best pizza in nyc", "ramen near sf": the question limits answers to a place. */
export const namesPlace = (query: string) => /\b(in|near|around)\s+(?!\d)[a-z]/i.test(query);

/** A named pick that counts as an answer (W only means something when the question names a place). */
export const isRealPick = (query: string, k: PostPick | undefined): k is PostPick =>
  !!k?.picks.length && (k.code === "Y" || (k.code === "W" && !namesPlace(query)));

// ---------------------------------------------------------------- re-selecting the options

export interface PickPost {
  id: string;
  /** Current option id, or "other". */
  option: string;
  pick?: PostPick;
}

export interface PickPlan {
  mode: "picks" | "kinds";
  /** Existing option ids that stay, in order of support. */
  keep: string[];
  /** New options; `assign` refers to them as "new:<index>". */
  added: { title: string; description: string }[];
  /** Post id -> existing option id, "new:<j>", "other", or null (not an opinion: removed). Only posts that change. */
  assign: Map<string, string | null>;
  stats: { tallied: number; dropped_wrong_place: number; dropped_non_answer: number; pick_coverage: number; kind_coverage: number };
}

/**
 * Up to `max` options with the most real support. Existing options are cluster heads; an Other post that names a
 * pick adds support to it (any of its picks, so "Scarr's or Joe's" can move to whichever is shown). Wrong-place and
 * non-answer Other posts are removed. Falls back to cuisines when single picks cover under 40% of the answers.
 */
export function planPicks(query: string, options: { id: string; title: string }[], posts: PickPost[], max = 8): PickPlan {
  const opinions = posts.length;
  const floor = Math.max(5, Math.ceil(opinions * 0.012));
  const otherPosts = posts.filter((p) => p.option === "other");
  // Only Other posts are removed: a vote for a listed option already passed the three-model sort. The cheap model's
  // codes wobble between runs, so a removal needs a second signal: wrong place only when the question names a place,
  // and "not an answer" only when no pick was named at all.
  const placed = namesPlace(query);
  const dropped = new Set(
    otherPosts.filter((p) => p.pick && ((p.pick.code === "W" && placed) || (p.pick.code === "X" && !p.pick.picks.length))).map((p) => p.id),
  );
  const kept = opinions - dropped.size;
  const real = (p: PickPost) => !dropped.has(p.id) && isRealPick(query, p.pick);

  // ---- named picks
  const pc = new Clusters();
  for (const o of options) pc.head(pickKey(o.title, query), o.id, o.title);
  const heads = new Map<string, Cluster[]>();
  for (const p of otherPosts) {
    if (!real(p)) continue;
    const hs: Cluster[] = [];
    for (const name of p.pick!.picks) {
      const c = pc.add(pickKey(name, query), name, p.id);
      if (!hs.includes(c)) hs.push(c);
    }
    if (hs.length) heads.set(p.id, hs);
  }
  const inOption = new Map<string, number>();
  for (const p of posts) if (p.option !== "other") inOption.set(p.option, (inOption.get(p.option) ?? 0) + 1);
  const support = (c: Cluster) => c.posts.size + (c.optionId ? (inOption.get(c.optionId) ?? 0) : 0);
  const chosen = pc.list
    .filter((c) => (c.optionId ? support(c) >= 2 : support(c) >= floor))
    .sort((a, b) => support(b) - support(a))
    .slice(0, max);
  const chosenSet = new Set(chosen);
  const pickTarget = new Map<string, Cluster>();
  let pickCovered = 0;
  for (const p of posts) {
    if (dropped.has(p.id)) continue;
    if (p.option !== "other") {
      if (chosen.some((c) => c.optionId === p.option)) pickCovered++;
      continue;
    }
    const c = heads.get(p.id)?.find((h) => chosenSet.has(h));
    if (c) {
      pickTarget.set(p.id, c);
      pickCovered++;
    }
  }
  const pickCoverage = kept ? pickCovered / kept : 0;

  // ---- cuisines: every real answer counts toward the cuisine of its main pick
  const kc = new Clusters();
  const kindOf = new Map<string, Cluster>();
  const kindPicks = new Map<Cluster, Map<string, number>>();
  for (const p of posts) {
    if (dropped.has(p.id) || !isRealPick(query, p.pick) || !p.pick.kind) continue;
    const c = kc.add(p.pick.kind.toLowerCase().trim(), titleCase(p.pick.kind.toLowerCase().trim()), p.id);
    kindOf.set(p.id, c);
    const main = p.option !== "other" ? options.find((o) => o.id === p.option)?.title : p.pick.picks[0];
    if (main) {
      const m = kindPicks.get(c) ?? new Map<string, number>();
      m.set(main, (m.get(main) ?? 0) + 1);
      kindPicks.set(c, m);
    }
  }
  const kinds = kc.list.filter((c) => c.posts.size >= floor).sort((a, b) => b.posts.size - a.posts.size).slice(0, max);
  const kindSet = new Set(kinds);
  const kindCovered = posts.filter((p) => kindSet.has(kindOf.get(p.id)!)).length;
  const kindCoverage = kept ? kindCovered / kept : 0;

  const stats = {
    tallied: posts.filter((p) => p.pick).length,
    dropped_wrong_place: otherPosts.filter((p) => dropped.has(p.id) && p.pick?.code === "W").length,
    dropped_non_answer: otherPosts.filter((p) => dropped.has(p.id) && p.pick?.code === "X").length,
    pick_coverage: Math.round(pickCoverage * 1000) / 1000,
    kind_coverage: Math.round(kindCoverage * 1000) / 1000,
  };
  const assign = new Map<string, string | null>();
  for (const id of dropped) assign.set(id, null);

  // Groups only help when no single group swallows the poll (every NYC pizza pick is "Pizza").
  const biggestKind = kept && kinds[0] ? kinds[0].posts.size / kept : 1;
  // Scattered picks (a city's restaurants, every shoe model) read better as groups when groups cover far more.
  const scattered = (pickCoverage < 0.4 && kindCoverage >= pickCoverage + 0.15) || (pickCoverage < 0.5 && kindCoverage >= pickCoverage + 0.2);
  if (scattered && kinds.length >= 3 && biggestKind <= 0.4) {
    const added = kinds.map((c) => {
      const top = [...(kindPicks.get(c) ?? [])].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
      const title = display(c);
      return { title, description: `Picks something ${title}${top.length ? `, most often ${top.join(", ")}` : ""}.` };
    });
    // A named pick belongs to the group most of its posts gave it ("Fritz is the only answer" -> Poutine), so posts
    // without their own group, or with a stray one, still join it.
    const pickGroup = new Clusters();
    const votes = new Map<Cluster, Map<number, number>>();
    kinds.forEach((c, at) => {
      for (const [name, n] of kindPicks.get(c) ?? []) {
        const pc = pickGroup.add(pickKey(name, query), name);
        const m = votes.get(pc) ?? new Map<number, number>();
        m.set(at, (m.get(at) ?? 0) + n);
        votes.set(pc, m);
      }
    });
    const groupOfPick = (name: string): number => {
      const m = votes.get(pickGroup.find(pickKey(name, query))!);
      return m ? [...m].sort((a, b) => b[1] - a[1])[0]![0] : -1;
    };
    for (const p of posts) {
      if (dropped.has(p.id)) continue;
      let at = kinds.indexOf(kindOf.get(p.id)!);
      if (at < 0) {
        const names = p.option !== "other" ? [options.find((o) => o.id === p.option)?.title ?? ""] : isRealPick(query, p.pick) ? p.pick.picks : [];
        for (const n of names) if (n && (at = groupOfPick(n)) >= 0) break;
      }
      const to = at >= 0 ? `new:${at}` : "other";
      if (to !== p.option) assign.set(p.id, to);
    }
    return { mode: "kinds", keep: [], added, assign, stats };
  }

  const keep = chosen.filter((c) => c.optionId).map((c) => c.optionId!);
  const fresh = chosen.filter((c) => !c.optionId);
  const added = fresh.map((c) => ({ title: display(c), description: `Names ${display(c)} as the best pick.` }));
  for (const [id, c] of pickTarget) assign.set(id, c.optionId ?? `new:${fresh.indexOf(c)}`);
  // Options that lost their place to better-supported picks: each post follows its own named pick when that pick is
  // shown (the sorter often files "Lucali" under a look-alike "Lucia Pizza"), otherwise it joins Other.
  for (const p of posts) {
    if (p.option === "other" || keep.includes(p.option)) continue;
    const c = isRealPick(query, p.pick) ? p.pick.picks.map((n) => pc.find(pickKey(n, query))).find((h) => h && chosenSet.has(h)) : undefined;
    assign.set(p.id, c ? (c.optionId ?? `new:${fresh.indexOf(c)}`) : "other");
  }
  return { mode: "picks", keep, added, assign, stats };
}

/**
 * "N other picks": the named picks left in Other, largest first, aliases merged. Posts without a tallied pick are
 * counted only in the total.
 */
export function otherPicks(query: string, names: string[]): { breakdown: { title: string; count: number }[]; distinct: number } {
  const pc = new Clusters();
  for (const n of names) pc.add(pickKey(n, query), n, `${pc.list.length}:${n}`);
  const counts = pc.list.map((c) => ({ title: display(c), count: [...c.names.values()].reduce((a, b) => a + b, 0) })).sort((a, b) => b.count - a.count);
  return { breakdown: counts.filter((c) => c.count >= 2).slice(0, 8), distinct: counts.length };
}
