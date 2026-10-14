/**
 * Consensus MCP server (stdio). Lets Claude Code, Cursor, Claude Desktop, VS Code and any other MCP client ask
 * "what do people on Reddit and X think about X" and get the poll with linked quotes.
 *
 *   npm run mcp                      # or: npx tsx mcp/server.ts
 *   claude mcp add consensus -- npx -y tsx /abs/path/consensus/mcp/server.ts
 *
 * Tools:
 *   consensus_get       replay a saved search from useconsensus.io by id (free, no keys)
 *   consensus_featured  the polls featured on the useconsensus.io home page (free, no keys)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseSse } from "./sse.ts";
import { SITE, summarize, toMarkdown, type Summary } from "./format.ts";

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

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await server.connect(new StdioServerTransport());
}
