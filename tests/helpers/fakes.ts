/**
 * Fakes so tests never spend money: a stubbed globalThis.fetch that answers the LLM gateway and Serper from code,
 * and throws on any other URL. Reddit (undici in src/sources/reddit/client.ts) is never reached: tests inject
 * collectReddit / fetchThread / profile fetchers instead.
 */
import { syntheticThread } from "./synthetic.ts";
import { meter } from "../../src/lib/meter.ts";
import type { FetchedThread } from "../../src/v3/reddit.ts";

// Fake keys only; real keys are never loaded (npm test does not read .env).
process.env.STRAITLY_API_KEY = "test-not-a-key";
process.env.SERPER_API_KEY = "test-not-a-key";
delete process.env.OPENROUTER_API_KEY;
delete process.env.LLM_GATEWAY;
delete process.env.LLM_BASE_URL;
delete process.env.LLM_API_KEY;
delete process.env.OXYLABS_USERNAME;
delete process.env.OXYLABS_PASSWORD;

export type LlmHandler = (prompt: string, body: any) => string | { status: number; body: unknown } | undefined;

export interface FakeNet {
  llmCalls: { prompt: string; model: string }[];
  serperCalls: any[];
  restore(): void;
}

/** Default replies by prompt shape; a handler can override any of them (return undefined to fall through). */
export function defaultLlm(prompt: string): string {
  if (prompt.includes("You run a public opinion poll built from real"))
    return JSON.stringify({ type: "yes_no", purchasable: false, options: [{ title: "No regrets", description: "Glad they moved." }, { title: "Regret it", description: "Wish they had stayed." }] });
  if (prompt.includes("Write the 2 to 4 poll options")) return JSON.stringify({ options: [{ title: "Yes", description: "Yes." }, { title: "No", description: "No." }] });
  if (prompt.includes("You are sorting posts")) return sortReply(prompt);
  if (prompt.includes("These posts all chose the answer")) return JSON.stringify({ summary: "Short synthetic summary.", points: [{ text: "Synthetic reason", post: 0, quote: "nothing" }] });
  if (prompt.includes("We build a public-opinion poll from Reddit threads")) return JSON.stringify({ queries: ["canadians portugal regret"], subreddits: ["PortugalExpats"], core: "canadians portugal" });
  return "{}";
}

/** "love" -> option 0, "regret" -> option 1, else N; tags mode appends S CA PT Y en. */
export function sortReply(prompt: string): string {
  const body = prompt.slice(prompt.indexOf("POSTS:"));
  const tags = prompt.includes("<firsthand>");
  const lines: string[] = [];
  for (const m of body.matchAll(/^\[(\d+)\] (.*)$/gm)) {
    const t = m[2]!.toLowerCase();
    const b = /\blove\b/.test(t) ? "0 3" : /\bregret\b/.test(t) ? "1 3" : "N 0";
    lines.push(tags ? `${m[1]} ${b} S CA PT Y en` : `${m[1]} ${b} -`);
  }
  return lines.join("\n");
}

export function installFakeNet(opts: { llm?: LlmHandler; serper?: (body: any) => { organic: any[] } | { status: number } } = {}): FakeNet {
  const real = globalThis.fetch;
  const net: FakeNet = { llmCalls: [], serperCalls: [], restore: () => (globalThis.fetch = real) };
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url.startsWith("https://api.straitly.ai/")) {
      const prompt = body.messages[0].content as string;
      net.llmCalls.push({ prompt, model: body.model });
      const r = opts.llm?.(prompt, body) ?? defaultLlm(prompt);
      if (typeof r === "object") return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
      return Response.json({ choices: [{ message: { content: r } }], usage: { cost: 0.001 } });
    }
    if (url === "https://google.serper.dev/search") {
      net.serperCalls.push(body);
      const r = opts.serper?.(body) ?? { organic: [] };
      if ("status" in r) return new Response(JSON.stringify({ message: "fake failure" }), { status: r.status });
      return Response.json({ ...r, credits: 1 });
    }
    throw new Error(`test tried to reach the network: ${url}`);
  }) as typeof fetch;
  return net;
}

/** A collectReddit stand-in: one synthetic thread, counted as one successful Serper call. */
export function fakeCollectReddit(thread: FetchedThread = syntheticThread()) {
  return async (_q: string, _w: unknown, onThread: (t: FetchedThread) => void, onHits: (h: unknown[]) => void) => {
    const m = meter();
    if (m) {
      m.serperCalls++;
      m.serperCredits++;
      (m as any).serperOk = ((m as any).serperOk ?? 0) + 1;
    }
    onHits([{ id: thread.id, title: thread.title, url: thread.url }]);
    onThread(thread);
    return { queries: ["q"], threadsFound: 1, threadsFetched: 1, threadsKept: null };
  };
}

export const fakeExtras = {
  profileCalls: 0,
  subCalls: 0,
};
export function fakeProfiles() {
  return async (handles: string[]) => {
    fakeExtras.profileCalls += handles.length;
    return Object.fromEntries(handles.map((h) => [h, { avatar: "https://example.test/a.png" }]));
  };
}
export function fakeSubs() {
  return async (names: string[]) => {
    fakeExtras.subCalls += names.length;
    return Object.fromEntries(names.map((n) => [n, { icon: null, color: null, subscribers: 1, url: `https://www.reddit.com/${n}/` }]));
  };
}

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of it) out.push(e);
  return out;
}
