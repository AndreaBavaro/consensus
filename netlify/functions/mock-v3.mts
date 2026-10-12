import type { Config, Context } from "@netlify/functions";
import { isDevRuntime } from "../../src/lib/runtime.ts";
import hubspot from "../../src/mock/fixtures/hubspot.json" with { type: "json" };
import pineapple from "../../src/mock/fixtures/pineapple.json" with { type: "json" };
import { cookie, readCookies, sessionUser } from "../../src/v3/auth.ts";

/*
 * Mock of GET /api/v3/search for frontend work. Replays a recorded real stream with its original timing, so loaders and
 * streaming behave like production, and returns the same answer for every question:
 *   - HubSpot (buying question with leads) for everything,
 *   - pineapple-on-pizza (fun question, no leads) when the query mentions pizza / pineapple / fun.
 * Same gating as the real endpoint: one free search when signed out, then 401 signup_required. `?id=` always replays.
 *   ?speed=2 plays twice as fast; ?gate=0 disables the gate.
 */
interface Ev {
  event: string;
  data: any;
  t_ms: number;
}
const FIXTURES: Record<string, Ev[]> = { hubspot: hubspot as Ev[], pineapple: pineapple as Ev[] };
const FREE_COOKIE = "cs_mock_free";
const enc = new TextEncoder();
const frame = (e: { event: string; data: unknown }) => enc.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), r()), { once: true });
  });

const pick = (query: string) => (/pizza|pineapple|\bfun\b/i.test(query) ? "pineapple" : "hubspot");
const byId = (id: string) => Object.keys(FIXTURES).find((k) => FIXTURES[k]!.find((e) => e.event === "meta")?.data.id === id);

/** Recorded fixtures keep only a couple of progress ticks; rebuild a 500ms ticker from the recorded timings. */
function withProgress(events: Ev[]): Ev[] {
  const done = events.find((e) => e.event === "done")!.data;
  const poll = [...events].reverse().find((e) => e.event === "poll")!.data;
  const t = done.timing as Record<string, number>;
  const collected = done.pool.collected as number;
  const xPosts = Math.min(collected, poll.sources.x.posts as number);
  const rPosts = collected - xPosts;
  const threads = poll.sources.reddit.threads as number;
  const ease = (now: number, from: number, to: number) => Math.max(0, Math.min(1, (now - from) / Math.max(1, to - from)));
  const ticks: Ev[] = [];
  for (let now = 400; now < done.total_ms; now += 500) {
    const stage = now < (t.options_done ?? 0) ? (now < (t.options_start ?? 6000) ? "searching" : "writing_options") : now < (t.sort_done ?? 0) ? "sorting" : now < (t.final_poll ?? 0) ? "refining" : "writing_reasons";
    const r = ease(now, 300, t.reddit_done ?? 9000);
    const x = ease(now, 500, t.x_done ?? 10000);
    const pool = Math.round(rPosts * r * r + xPosts * x);
    ticks.push({
      event: "progress",
      t_ms: now,
      data: {
        stage,
        elapsed_ms: now,
        reddit: { threads: Math.round(threads * Math.sqrt(r)), posts: Math.round(rPosts * r * r), done: r >= 1 },
        x: { posts: Math.round(xPosts * x), done: x >= 1 },
        sorted: Math.round(Math.min(pool, collected * ease(now, t.first_poll ?? 8000, t.sort_done ?? 11000))),
        pool,
      },
    });
  }
  return [...events.filter((e) => e.event !== "progress"), ...ticks].sort((a, b) => a.t_ms - b.t_ms);
}

const json = (status: number, body: unknown, setCookie?: string | null) => {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(JSON.stringify(body), { status, headers });
};

export default async (req: Request, context: Context) => {
  // Dev-only: never serve fixtures from a production deploy unless explicitly enabled.
  if (!isDevRuntime(context) && process.env.ENABLE_MOCK !== "1") return json(404, { error: "not_found" });
  const p = new URL(req.url).searchParams;
  const speed = Math.min(20, Math.max(0.25, Number(p.get("speed") ?? 1) || 1));
  const savedId = p.get("id");
  let key: string | undefined;
  let live = true;
  let setCookie: string | null = null;

  if (savedId && !p.get("query")) {
    key = byId(savedId);
    if (!key) return json(404, { error: "not_found", message: "This search has expired." });
    live = false;
  } else {
    const query = p.get("query")?.trim();
    if (!query) return json(400, { error: "bad_request", message: "query is required" });
    key = pick(query);
    const qKey = query.toLowerCase().replace(/\W+/g, " ").trim().slice(0, 120);
    if (p.get("gate") !== "0" && !(await sessionUser(req))) {
      const used = readCookies(req)[FREE_COOKIE];
      if (used && used !== qKey) return json(401, { error: "signup_required", message: "Sign up free to keep searching." });
      if (!used) setCookie = cookie(req, FREE_COOKIE, qKey, 86_400);
    }
  }

  const events = live ? withProgress(FIXTURES[key]!) : FIXTURES[key]!.filter((e) => e.event !== "progress");
  const signal = req.signal;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let clock = 0;
      for (const e of events) {
        if (signal.aborted) break;
        if (live && e.t_ms > clock) {
          await sleep((e.t_ms - clock) / speed, signal);
          clock = e.t_ms;
        }
        const data = e.event === "meta" ? { ...e.data, cached: !live, started_at: new Date().toISOString(), mock: true } : e.data;
        try {
          controller.enqueue(frame({ event: e.event, data }));
        } catch {
          break;
        }
      }
      try {
        controller.close();
      } catch {
        /* client went away */
      }
    },
  });
  const headers = new Headers({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(stream, { headers });
};

export const config: Config = { path: ["/api/mock/v3/search"] };
