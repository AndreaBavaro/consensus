import { logger } from "../lib/log.ts";
import { completeJson, completeText } from "../llm.ts";
import { flat, within } from "./limit.ts";
import { reasonsModel, sortModel } from "./sort.ts";
import type { Post, Theme } from "./types.ts";

const log = logger("v3-themes");

/** Opinions read when writing themes, and the most tagged afterwards (top by rank, all sources). */
const WRITE_SAMPLE = Number(process.env.THEME_SAMPLE ?? 140);
const TAG_MAX = Number(process.env.THEME_TAG_MAX ?? 900);
const TAG_BATCH = Number(process.env.THEME_TAG_BATCH ?? 40);
const MIN_THEME_POSTS = 3;

const SCHEMA = {
  type: "object",
  properties: {
    themes: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, description: { type: "string" }, options: { type: "array", items: { type: "integer" } } },
        required: ["title", "description", "options"],
      },
    },
  },
  required: ["themes"],
};

interface Draft {
  title: string;
  description: string;
  options: string[];
}

async function writeThemes(query: string, options: { id: string; title: string }[], sample: Post[], signal?: AbortSignal): Promise<Draft[]> {
  const optIndex = new Map(options.map((o, i) => [o.id, i]));
  const prompt = [
    `Public-opinion poll on "${query}". Poll options (each post already voted for one):`,
    ...options.map((o, i) => `${i} = ${o.title}`),
    ``,
    `Posts, each with the option it voted for:`,
    ...sample.map((p, i) => `[${i}] (voted ${optIndex.get(p.option ?? "") ?? "?"}) ${flat(p.text, 280)}`),
    ``,
    `Write 6 to 12 THEMES: the specific, concrete reasons and arguments that come up again and again in these posts.`,
    `- Each theme is one specific claim people make, not a side: "YC's alumni network opens doors", "Demo day gets you funded fast", "7% equity is too expensive", "Pear partners are more hands-on". Never just "A is better" or "Worth it".`,
    `- Title 3 to 9 words, plain and specific, as people would say it. Description: one neutral sentence, max 18 words.`,
    `- "options": the option numbers whose voters make this argument. A theme can support more than one option (e.g. "Depends on your stage" may come from both sides).`,
    `- Themes may overlap: one post can carry several themes. Cover every option that has posts, most common themes first.`,
    `- Each theme needs at least 3 posts that make it. No generic themes ("Good experience", "Personal preference"), no spam or news themes.`,
    `- Plain text, no quotation marks.`,
  ].join("\n");
  const r = await completeJson<{ themes?: { title?: string; description?: string; options?: unknown[] }[] }>(
    prompt,
    SCHEMA,
    // 12 themes with descriptions run ~1.2-1.6k tokens; at 1400 the JSON was cut mid-string and the run got 0 themes.
    { model: reasonsModel(), maxTokens: 2400, timeoutMs: 12_000, signal },
    0,
  );
  const seen = new Set<string>();
  return (r.themes ?? [])
    .filter((t) => t.title?.trim())
    .map((t) => ({
      title: t.title!.trim().replace(/^["']|["']$/g, ""),
      description: (t.description ?? "").trim(),
      options: [...new Set((t.options ?? []).filter((n): n is number => Number.isInteger(n) && !!options[n as number]).map((n) => options[n]!.id))],
    }))
    .filter((t) => !seen.has(t.title.toLowerCase()) && !!seen.add(t.title.toLowerCase()))
    .slice(0, 12);
}

/** Multi-label: every theme a post actually argues. Returns theme indexes per post (empty = none). */
async function tagBatch(query: string, themes: Draft[], posts: Post[], signal?: AbortSignal): Promise<number[][]> {
  const prompt = [
    `Poll on "${query}". THEMES (specific arguments people make):`,
    ...themes.map((t, i) => `${i} = ${t.title}: ${t.description}`),
    ``,
    `POSTS:`,
    ...posts.map((p, i) => `[${i}] ${flat(p.text, 500)}`),
    ``,
    `For each post, list EVERY theme number the post itself argues or clearly gives as its reason (a post may have several). Only tag a theme when the post's own words make that argument; mentioning the topic is not enough. If none fit, write -.`,
    `Output exactly one line per post, in order, as "<index> <theme numbers separated by commas or ->", e.g.`,
    `0 2,5`,
    `1 -`,
    `2 0`,
    `Nothing else.`,
  ].join("\n");
  const text = await completeText(prompt, { model: sortModel(), maxTokens: 12 * posts.length + 200, timeoutMs: 12_000, signal, temperature: 0, noReasoning: true }, 0);
  const out: number[][] = posts.map(() => []);
  for (const m of text.matchAll(/^[ \t]*\[?(\d+)\]?[ \t]*[:.\-]?[ \t]+((?:\d+[ \t]*,?[ \t]*)+|-)[ \t]*$/gm)) {
    const i = Number(m[1]);
    if (i >= posts.length || out[i]!.length) continue;
    if (m[2]!.trim() === "-") continue;
    out[i] = [...new Set(m[2]!.split(/[, \t]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < themes.length))];
  }
  return out;
}

/**
 * Detailed themes on top of the exclusive poll: specific reasons ("YC's network opens doors") that overlap, so one
 * post can count toward several. Written from the real opinions, then every top opinion is tagged in parallel batches.
 */
export async function buildThemes(query: string, options: { id: string; title: string }[], opinions: Post[], budgetMs: number, signal?: AbortSignal): Promise<Theme[]> {
  const started = Date.now();
  const ranked = [...opinions].sort((a, b) => b.rank - a.rank);
  if (ranked.length < 8) return [];
  // Sample across options so small sides still get their own themes.
  const byOpt = new Map<string, Post[]>();
  for (const p of ranked) byOpt.set(p.option ?? "", [...(byOpt.get(p.option ?? "") ?? []), p]);
  const lists = [...byOpt.values()];
  const sample: Post[] = [];
  for (let i = 0; sample.length < WRITE_SAMPLE && lists.some((l) => l[i]); i++) for (const l of lists) if (l[i] && sample.length < WRITE_SAMPLE) sample.push(l[i]!);
  let drafts: Draft[];
  try {
    drafts = await within(writeThemes(query, options, sample, signal), budgetMs * 0.55, []);
  } catch (e) {
    log.warn("theme writing failed", { error: String(e).slice(0, 200) });
    return [];
  }
  if (!drafts.length) return [];
  const toTag = ranked.slice(0, TAG_MAX);
  const batches: Post[][] = [];
  for (let i = 0; i < toTag.length; i += TAG_BATCH) batches.push(toTag.slice(i, i + TAG_BATCH));
  const left = Math.max(2_500, budgetMs - (Date.now() - started));
  const tagged = await Promise.all(
    batches.map((b) =>
      within(
        tagBatch(query, drafts, b, signal).catch((e) => {
          if (!signal?.aborted) log.warn("theme tag batch failed", { error: String(e).slice(0, 160) });
          return null;
        }),
        left,
        null,
      ),
    ),
  );
  const members: Post[][] = drafts.map(() => []);
  tagged.forEach((res, bi) => res?.forEach((ts, i) => ts.forEach((t) => members[t]!.push(batches[bi]![i]!))));
  const themes: Theme[] = [];
  drafts.forEach((d, i) => {
    const ps = members[i]!;
    if (ps.length < MIN_THEME_POSTS) return;
    const byOption: Record<string, number> = {};
    for (const p of ps) if (p.option) byOption[p.option] = (byOption[p.option] ?? 0) + 1;
    // Option links come from where its posts actually voted (2+ posts and 15%), plus what the writer said.
    const linked = new Set(d.options.filter((o) => (byOption[o] ?? 0) > 0));
    for (const [o, n] of Object.entries(byOption)) if (n >= 2 && n >= ps.length * 0.15) linked.add(o);
    themes.push({
      id: `t${i}`,
      title: d.title,
      description: d.description,
      option_ids: [...linked].sort((a, b) => (byOption[b] ?? 0) - (byOption[a] ?? 0)),
      count: ps.length,
      percent: Math.round((ps.length / opinions.length) * 1000) / 10,
      by_option: byOption,
      by_source: { reddit: ps.filter((p) => p.source === "reddit").length, x: ps.filter((p) => p.source === "x").length },
      post_ids: ps.map((p) => p.id),
      quotes: ps.slice(0, 3).map((p) => ({ post_id: p.id, url: p.url, text: flat(p.text, 220), source: p.source, author: p.author.handle })),
    });
  });
  themes.sort((a, b) => b.count - a.count);
  return themes;
}
