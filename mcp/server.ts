/**
 * Consensus MCP server (stdio). Lets Claude Code, Cursor, Claude Desktop, VS Code and any other MCP client ask
 * "what do people on Reddit and X think about X" and get the poll with linked quotes.
 *
 *   npm run mcp                      # or: npx tsx --env-file=.env mcp/server.ts
 *   claude mcp add consensus -- npx -y tsx --env-file=/abs/path/consensus/.env /abs/path/consensus/mcp/server.ts
 *
 * Tools:
 *   consensus_get       replay a saved search from useconsensus.io by id (free, no keys)
 *   consensus_featured  the polls featured on the useconsensus.io home page (free, no keys)
 *   consensus_search    run the full pipeline (src/v3) here, with the keys in .env; costs the runner per search
 *   consensus_reread    re-read saved Reddit posts/comments by URL for validation (status, date, score, overlap);
 *                       needs the Oxylabs keys, no LLM or Serper call; post text is returned to the caller, never saved
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseSse } from "./sse.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, summarize, toMarkdown, type Summary } from "./format.ts";
import { saveRun } from "../src/np/links.ts";
import { loadRun } from "../src/np/export.ts";
import { profileRequest, resolveProfile } from "../src/v3/profile.ts";
import type { V3Event, V3Source } from "../src/v3/types.ts";

/** Local searches are saved links-only here; consensus_get reads them before asking the site. */
const runsDir = () => process.env.CONSENSUS_RUNS_DIR ?? fileURLToPath(new URL(import.meta.url.includes("/dist/mcp/") ? "../../runs/mcp/" : "../runs/mcp/", import.meta.url));

async function localSaved(id: string): Promise<Summary | null> {
  try {
    return summarize(loadRun(JSON.parse(await readFile(join(runsDir(), `${id}.json`), "utf8"))).events as V3Event[]);
  } catch {
    return null;
  }
}

/** Everything a fresh search needs; X is optional (sources=["reddit"]). Checked per call so the free tools always work. */
const SEARCH_KEYS: Record<string, string[]> = {
  "an LLM gateway key": ["OPENROUTER_API_KEY", "STRAITLY_API_KEY"],
  "Serper (Google search for Reddit threads)": ["SERPER_API_KEY"],
  "Oxylabs username (Reddit proxy)": ["OXYLABS_USERNAME"],
  "Oxylabs password (Reddit proxy)": ["OXYLABS_PASSWORD"],
};
const missingKeys = (sources: V3Source[]) => [
  ...Object.entries(SEARCH_KEYS).filter(([, names]) => !names.some((n) => process.env[n])).map(([what, names]) => `${what}: ${names.join(" or ")}`),
  ...(sources.includes("x") && !process.env.TWITTERAPI_IO_KEY ? ["TwitterAPI.io (X): TWITTERAPI_IO_KEY, or pass sources: [\"reddit\"]"] : []),
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** One paid search at a time per server process, like the site's per-user inflight lock. */
let inflight: string | null = null;

const ID = /^[A-Za-z0-9_-]{8,32}$/;

async function fetchSaved(id: string): Promise<Summary> {
  const res = await fetch(`${SITE}/api/v3/search?id=${encodeURIComponent(id)}`, { headers: { Accept: "text/event-stream" } });
  if (res.status === 404) throw new Error(`No saved Consensus search with id "${id}" (it may have expired).`);
  if (!res.ok) throw new Error(`Consensus returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return summarize(parseSse(await res.text()));
}

interface Featured {
  updated: string;
  polls: { id: string; category: string; title: string; query: string; total: number; by_source: Record<string, number>; options: { id: string; title: string; percent: number; count: number; is_other: boolean }[] }[];
}

async function fetchFeatured() {
  const res = await fetch(`${SITE}/featured.json`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Consensus returned ${res.status} for featured.json`);
  const f = (await res.json()) as Featured;
  return {
    updated: f.updated,
    polls: f.polls.map((p) => {
      const top = p.options.filter((o) => !o.is_other).sort((a, b) => b.percent - a.percent)[0];
      return {
        id: p.id,
        title: p.title,
        category: p.category,
        total_opinions: p.total,
        leading: top ? { title: top.title, percent: top.percent, count: top.count } : null,
        options: p.options.map((o) => ({ title: o.title, percent: o.percent, count: o.count })),
        url: `${SITE}/search?id=${p.id}&q=${encodeURIComponent(p.query)}`,
      };
    }),
  };
}

export const server = new McpServer({ name: "consensus", version: "0.1.0" });

server.registerTool(
  "consensus_get",
  {
    title: "Get a saved Consensus poll",
    description:
      "Fetch a saved Consensus search by id: a poll of what people on Reddit and X actually say about a question, with percentages, " +
      "a one-line reason per option and linked quotes. Use when given a useconsensus.io link or id (the `id=` query parameter). Free, no keys.",
    inputSchema: { id: z.string().regex(ID, "a Consensus search id (8–32 url-safe characters)").describe("Search id, e.g. ByAYXunnmt6BGCQR from https://useconsensus.io/search?id=ByAYXunnmt6BGCQR") },
  },
  async ({ id }) => {
    const local = await localSaved(id);
    if (local) return { content: [{ type: "text", text: `${toMarkdown(local)}\n\n(local research run, saved links-only in ${runsDir()})` }], structuredContent: local as unknown as Record<string, unknown> };
    const s = await fetchSaved(id);
    return { content: [{ type: "text", text: toMarkdown(s) }], structuredContent: s as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  "consensus_featured",
  {
    title: "Featured Consensus polls",
    description:
      "List the polls featured on the Consensus home page (e.g. 'Cursor vs Claude Code', 'Is a Costco membership worth it?') with their leading answer " +
      "and id, so you can call consensus_get for the full breakdown. Free, no keys.",
    inputSchema: {},
  },
  async () => {
    const f = await fetchFeatured();
    const text = [`Featured polls (updated ${f.updated}):`, ...f.polls.map((p) => `- ${p.title} — ${p.leading ? `${p.leading.percent}% ${p.leading.title}` : "no leader"} (${p.total_opinions} opinions) · id ${p.id}`)].join("\n");
    return { content: [{ type: "text", text }], structuredContent: f as unknown as Record<string, unknown> };
  },
);

server.registerTool(
  "consensus_search",
  {
    title: "Run a new Consensus poll",
    description:
      "Ask a new question and get a poll of what people on Reddit and X actually say: options with percentages, a one-line reason each, " +
      "and linked quotes. Use for 'X vs Y', 'is X worth it', 'best X for Y', 'what do people think about X'. Runs the full Consensus pipeline " +
      "locally with the keys in .env (about 60-170 s and a few cents per search, billed to those keys). Prefer consensus_get when the " +
      "question already has a saved id.",
    inputSchema: {
      question: z.string().trim().min(3).max(300).describe("The question, as a person would ask it, e.g. 'Cursor vs Claude Code' or 'is a Costco membership worth it'"),
      since: z.string().regex(DATE).optional().describe("Only opinions from this date on, YYYY-MM-DD"),
      until: z.string().regex(DATE).optional().describe("Only opinions up to this date, YYYY-MM-DD"),
      sources: z.array(z.enum(["reddit", "x"])).min(1).optional().describe("Default both; pass [\"reddit\"] without an X key"),
      quotes_per_option: z.number().int().min(0).max(10).optional().describe("Linked quotes per option, default 4"),
      profile: z.enum(["default", "newpostcode"]).optional().describe("Run profile; newpostcode = Reddit only, poster tags, targeted subreddits, no UI extras (default: CONSENSUS_PROFILE or default)"),
      subs: z.array(z.string().regex(/^\w{2,30}$/)).optional().describe("Subreddits always searched (names without r/)"),
      deny_subs: z.array(z.string().regex(/^\w{2,30}$/)).optional().describe("Subreddits never fetched"),
      lang: z.array(z.string().regex(/^[a-z]{2}$/)).optional().describe("Extra search languages, e.g. [\"it\",\"pt\"]"),
      budget_usd: z.number().positive().max(5).optional().describe("Stop collecting and sorting once this much has been spent"),
    },
  },
  async ({ question, since, until, sources: asked, quotes_per_option, profile: profileName, subs, deny_subs, lang, budget_usd }, extra) => {
    const profile = resolveProfile(
      { ...(profileName ? { profile: profileName } : {}), ...(subs ? { subs: subs.join(",") } : {}), ...(deny_subs ? { "deny-subs": deny_subs.join(",") } : {}), ...(lang ? { lang: lang.join(",") } : {}) },
      process.env,
    );
    const sources: V3Source[] = asked ?? (profile.research ? ["reddit"] : ["reddit", "x"]);
    const missing = missingKeys(sources);
    if (missing.length) throw new Error(`consensus_search needs these environment variables (see .env.example): ${missing.join("; ")}`);
    if (since && until && since > until) throw new Error("since must be on or before until");
    if (inflight) throw new Error(`Another search ("${inflight}") is still running; try again in a few seconds.`);
    inflight = question;
    const token = extra._meta?.progressToken;
    const events: V3Event[] = [];
    try {
      // Loaded on first search so the server starts (and lists tools) without loading the pipeline.
      const { runV3 } = await import("../src/v3/run.ts");
      for await (const e of runV3({ query: question, since, until, sources: [...new Set(sources)], signal: extra.signal, ...profileRequest(profile), ...(budget_usd ? { budgetUsd: budget_usd } : {}) })) {
        events.push(e);
        if (e.event === "progress" && token !== undefined) {
          const d = e.data as { stage: string; reddit: { threads: number; posts: number }; x: { posts: number }; sorted: number; pool: number; elapsed_ms: number };
          await extra.sendNotification({
            method: "notifications/progress",
            params: { progressToken: token, progress: Math.min(d.elapsed_ms / 1000, 59), total: 60, message: `${d.stage}: ${d.reddit.threads} threads, ${d.pool} posts, ${d.sorted} sorted` },
          });
        }
      }
    } finally {
      inflight = null;
    }
    const s = summarize(events, { quotesPerOption: quotes_per_option });
    // Every local search is kept links-only (no post text) so consensus_get can replay it.
    if (s.id) await saveRun(join(runsDir(), `${s.id}.json`), { query: question, since, until, events }, "links").catch(() => {});
    const note = s.id ? `\n\nSaved id ${s.id} (the link above resolves once this question has also been run on useconsensus.io).` : "";
    return { content: [{ type: "text", text: toMarkdown(s) + note }], structuredContent: s as unknown as Record<string, unknown>, isError: !!s.error && !s.options.length };
  },
);

const REREAD_KEYS: Record<string, string> = { "Oxylabs username (Reddit proxy)": "OXYLABS_USERNAME", "Oxylabs password (Reddit proxy)": "OXYLABS_PASSWORD" };

server.registerTool(
  "consensus_reread",
  {
    title: "Re-read saved Reddit posts for validation",
    description:
      "Re-read Reddit posts or comments by permalink (e.g. the links in a saved Consensus run) and report, per row: status " +
      "(live | deleted | removed | not_found | fetch_failed), thread title, community, date, score, and, when a line is given, the longest " +
      "run of words it shares with the post (verbatim check). The post text is printed for the reader to judge the line against; the " +
      "structured output never holds post text. Uses the Reddit proxy keys in .env (no LLM or Serper call, a few KB of proxy traffic per post).",
    inputSchema: {
      posts: z
        .array(
          z.object({
            id: z.string().trim().min(1).max(64).describe("Row id, e.g. the quote-bank number"),
            url: z.string().trim().min(1).max(500).describe("Reddit post or comment permalink, or a thread fullname t3_x"),
            line: z.string().max(2000).optional().describe("The research line or paraphrase to check against the post"),
          }),
        )
        .min(1)
        .max(100)
        .describe("Up to 100 rows; each distinct permalink is fetched once"),
      chars: z.number().int().min(100).max(10000).optional().describe("Characters of post text printed per row, default 1500"),
      include_text: z.boolean().optional().describe("Print post and parent text for the reader (default true); false prints status and overlap only"),
    },
  },
  async ({ posts, chars, include_text }) => {
    const missing = Object.entries(REREAD_KEYS).filter(([, k]) => !process.env[k]).map(([what, k]) => `${what}: ${k}`);
    if (missing.length) return { content: [{ type: "text", text: `consensus_reread needs these environment variables (see .env.example): ${missing.join("; ")}` }], isError: true };
    // Loaded on first call so the server starts (and lists tools) without loading the Reddit client.
    const { rereadReport } = await import("../src/np/reread.ts");
    const rep = await rereadReport(
      posts.map((p) => ({ id: p.id, url: p.url, ...(p.line ? { paraphrase: p.line } : {}) })),
      { chars, includeText: include_text ?? true },
    );
    return { content: [{ type: "text", text: rep.text }], structuredContent: rep.structured as unknown as Record<string, unknown> };
  },
);

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await server.connect(new StdioServerTransport());
}
