# Use Consensus from your AI coding tool

This guide sets up the Consensus MCP server so Claude Code, Cursor, Claude Desktop or VS Code can ask "what do people on Reddit and X actually think about X" and get a poll with linked quotes. It takes about ten minutes, plus sign-ups for the keys if you want to run new searches.

## 1. What you get

Three tools appear in your AI tool:

| Tool | What it does | Needs keys? | Cost |
|---|---|---|---|
| `consensus_featured` | Lists the polls on the useconsensus.io home page | No | Free |
| `consensus_get` | Returns a saved poll by id (the `id=` in a useconsensus.io link) | No | Free |
| `consensus_search` | Asks a new question and builds the poll on your machine | Yes, see step 3 | Roughly 3 to 5 cents and 45 to 60 seconds per search, billed to your keys |

You can stop after step 2 and use the two free tools.

## 2. Install and run the server

You need Node 22.9 or newer (`node --version`).

```bash
git clone https://github.com/Straitly-ai/consensus
cd consensus
npm install
npm run mcp
```

If the last command prints nothing and waits, the server is running. Press Ctrl-C. Note the absolute path of the folder (`pwd`); you'll need it below.

## 3. Keys for new searches (optional)

`consensus_search` runs the whole Consensus pipeline locally, so it needs the same services the website uses. Copy the example file and fill it in:

```bash
cp .env.example .env
```

| Variable | What it's for | Where to get it |
|---|---|---|
| `OPENROUTER_API_KEY` | The LLM calls that write poll options, sort posts and summarize reasons | [openrouter.ai](https://openrouter.ai), add a few dollars of credit |
| `SERPER_API_KEY` | Google searches that find the Reddit threads | [serper.dev](https://serper.dev); the free tier works but refuses some advanced query patterns, which the pipeline tolerates |
| `OXYLABS_USERNAME` and `OXYLABS_PASSWORD` | A residential proxy for downloading Reddit comment threads | [oxylabs.io](https://oxylabs.io): buy Residential Proxies (pay as you go, 1 GB minimum), then create a **proxy user**. Use that user's name and password, not your dashboard login and not an API key. Enter the bare username; the code adds the `customer-` prefix |
| `TWITTERAPI_IO_KEY` | X posts | [twitterapi.io](https://twitterapi.io). Optional: without it, ask for `sources: ["reddit"]` |

Check it works from the terminal before touching your AI tool:

```bash
npm run v3 -- "is a standing desk worth it" --sources=reddit
```

You should see a poll in about a minute. If a key is missing, the error names the variable.

## 4. Connect your AI tool

Replace `/ABS/PATH/consensus` with the folder path from step 2. The `--env-file-if-exists` flag loads your keys when `.env` exists and is harmless when it doesn't.

### Claude Code

```bash
claude mcp add consensus -- npx -y tsx --env-file-if-exists=/ABS/PATH/consensus/.env /ABS/PATH/consensus/mcp/server.ts
```

Add `-s user` after `add` to make it available in every project instead of only the current one. Check with `claude mcp list`; it should show `consensus: ✔ Connected`.

### Cursor

Create or edit `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` inside a project:

```json
{
  "mcpServers": {
    "consensus": {
      "command": "npx",
      "args": ["-y", "tsx", "--env-file-if-exists=/ABS/PATH/consensus/.env", "/ABS/PATH/consensus/mcp/server.ts"]
    }
  }
}
```

Then Settings → MCP, and enable the server if it isn't already.

### Claude Desktop

Settings → Developer → Edit Config opens `claude_desktop_config.json`. Add the same `mcpServers` block as above and restart Claude Desktop.

### VS Code (Copilot agent mode)

Create `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "consensus": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "tsx", "--env-file-if-exists=/ABS/PATH/consensus/.env", "/ABS/PATH/consensus/mcp/server.ts"]
    }
  }
}
```

## 5. Try it

Ask your tool, in plain words:

- "What are the featured Consensus polls?"
- "Use consensus_get with id ByAYXunnmt6BGCQR and summarize the Cursor vs Claude Code poll."
- "What do people on Reddit think about Costco memberships? Use consensus_search."

A new search takes up to a minute and your tool shows progress while it runs. The answer includes percentages, a one-line reason per option, quotes with links to the original posts, and what the search cost.

## 6. If something goes wrong

- **"needs these environment variables"**: the named key is missing or empty in `.env`. For Oxylabs, make sure it's a proxy user, not your login.
- **Tool call times out**: searches can take 60 seconds. Raise your client's MCP tool timeout (Claude Code: `MCP_TOOL_TIMEOUT=120000`).
- **Server not found in the client**: use the absolute path, and run `npx tsx /ABS/PATH/consensus/mcp/server.ts` by hand to see any error.
- **Poll looks thin**: free Serper tiers refuse some queries and the proxy occasionally times out. Try again, or buy a small Serper pack.
- **Inspect without a client**: `npx @modelcontextprotocol/inspector npx tsx --env-file-if-exists=.env mcp/server.ts`.

## 7. Keep your keys safe

`.env` is gitignored. Never commit it or paste keys into chat. Every search bills your own accounts; the tool reports the cost in each answer.
