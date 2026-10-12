import type { Config, Context } from "@netlify/functions";
import { isDevRuntime } from "../../src/lib/runtime.ts";
import type { Source } from "../../src/lib/types.ts";
import { ALL_SOURCES, runConsensus } from "../../src/pipeline/run.ts";

const encoder = new TextEncoder();
const sse = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const HEARTBEAT_MS = 3_000;

export default async (req: Request, context: Context) => {
  // Legacy v2 endpoint: unauthenticated and unmetered, so it is closed outside local dev. Use /api/v3/search.
  if (!isDevRuntime(context)) return Response.json({ error: "gone", message: "Use /api/v3/search" }, { status: 410 });
  const url = new URL(req.url);
  const query = url.searchParams.get("query")?.trim();
  if (!query) return Response.json({ error: "query is required" }, { status: 400 });

  const requested = (url.searchParams.get("sources") ?? ALL_SOURCES.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Source => (ALL_SOURCES as string[]).includes(s));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), HEARTBEAT_MS);
      try {
        for await (const { event, data } of runConsensus(query, requested.length ? requested : ALL_SOURCES)) {
          controller.enqueue(sse(event, data));
        }
        controller.enqueue(sse("complete", { message: "Stream complete" }));
      } catch (e) {
        console.error("search failed", e);
        controller.enqueue(sse("error", { message: String(e) }));
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
};

export const config: Config = {
  path: ["/api/search/streaming/v2", "/api/search"],
};
