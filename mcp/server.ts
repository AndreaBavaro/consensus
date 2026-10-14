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
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseSse } from "./sse.ts";
import { SITE, summarize, toMarkdown, type Summary } from "./format.ts";
import { runV3 } from "../src/v3/run.ts";
import type { V3Event, V3Source } from "../src/v3/types.ts";

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
      "locally with the keys in .env (about 30-60 s and a few tens of cents per search, billed to those keys). Prefer consensus_get when the " +
      "question already has a saved id.",
    inputSchema: {
      question: z.string().trim().min(3).max(300).describe("The question, as a person would ask it, e.g. 'Cursor vs Claude Code' or 'is a Costco membership worth it'"),
      since: z.string().regex(DATE).optional().describe("Only opinions from this date on, YYYY-MM-DD"),
      until: z.string().regex(DATE).optional().describe("Only opinions up to this date, YYYY-MM-DD"),
      sources: z.array(z.enum(["reddit", "x"])).min(1).optional().describe("Default both; pass [\"reddit\"] without an X key"),
      quotes_per_option: z.number().int().min(0).max(10).optional().describe("Linked quotes per option, default 4"),
    },
  },
  async ({ question, since, until, sources = ["reddit", "x"], quotes_per_option }, extra) => {
    const missing = missingKeys(sources);
    if (missing.length) throw new Error(`consensus_search needs these environment variables (see .env.example): ${missing.join("; ")}`);
    if (since && until && since > until) throw new Error("since must be on or before until");
    if (inflight) throw new Error(`Another search ("${inflight}") is still running; try again in a few seconds.`);
    inflight = question;
    const token = extra._meta?.progressToken;
    const events: V3Event[] = [];
    try {
      for await (const e of runV3({ query: question, since, until, sources: [...new Set(sources)], signal: extra.signal })) {
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
    const note = s.id ? `\n\nSaved id ${s.id} (the link above resolves once this question has also been run on useconsensus.io).` : "";
    return { content: [{ type: "text", text: toMarkdown(s) + note }], structuredContent: s as unknown as Record<string, unknown>, isError: !!s.error && !s.options.length };
  },
);

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await server.connect(new StdioServerTransport());
}
