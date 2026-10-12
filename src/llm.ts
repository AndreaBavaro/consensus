import { env } from "./lib/env.ts";
import { logger } from "./lib/log.ts";
import { meter } from "./lib/meter.ts";

const log = logger("llm");
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface LlmOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Defaults to off for DeepSeek models and the Jev router. */
  noReasoning?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function body(prompt: string, opts: LlmOptions, extra: Record<string, unknown>) {
  const model = opts.model ?? env.llmModel;
  const providers = env.llmProviders;
  return {
    model,
    // Truncated comments can end in half an emoji; providers reject lone surrogates as invalid JSON.
    messages: [{ role: "user", content: prompt.toWellFormed() }],
    temperature: opts.temperature ?? 0,
    max_tokens: opts.maxTokens ?? 8000,
    // Jev otherwise routes long prompts to reasoning models that print their thinking instead of the answer.
    ...((opts.noReasoning ?? (model.startsWith("deepseek/") || model.includes("jev-router"))) ? { reasoning: { enabled: false } } : {}),
    ...(providers.length && model.startsWith("deepseek/")
      ? { provider: { order: providers, allow_fallbacks: true, require_parameters: true } }
      : {}),
    usage: { include: true },
    ...extra,
  };
}

function headers() {
  return {
    Authorization: `Bearer ${env.openRouterKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://consensus.local",
    "X-Title": "Consensus",
  };
}

function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) t = t.includes("\n") ? t.slice(t.indexOf("\n") + 1) : t.slice(3);
  if (t.endsWith("```")) t = t.slice(0, -3);
  return t.trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function completeText(prompt: string, opts: LlmOptions & { json?: boolean } = {}, retries = 2): Promise<string> {
  let lastError: unknown;
  // Socket drops ("fetch failed") come in bursts that kill hundreds of in-flight calls at once (X round 7: 3016 in one
  // eval batch); they get two extra attempts with jittered, growing backoff so the retries do not land in the same burst.
  let netExtra = 2;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body(prompt, opts, opts.json ? { response_format: { type: "json_object" } } : {})),
        signal: AbortSignal.any([AbortSignal.timeout(opts.timeoutMs ?? 45_000), ...(opts.signal ? [opts.signal] : [])]),
      });
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: unknown; usage?: { cost?: number } };
      if (!res.ok || !data.choices) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(data.error ?? data)}`);
      const m = meter();
      if (m) {
        m.llmCalls++;
        m.llmUsd += Number(data.usage?.cost ?? 0);
      }
      return data.choices[0]?.message?.content ?? "";
    } catch (e) {
      lastError = e;
      if (opts.signal?.aborted) break;
      const net = e instanceof TypeError;
      const cause = (e as { cause?: { code?: string } })?.cause?.code;
      log.warn(`attempt ${attempt + 1} failed`, { error: String(e), ...(cause ? { cause } : {}) });
      if (net && attempt === retries && netExtra > 0) {
        netExtra--;
        retries++;
      }
      await sleep((net ? 600 * 2 ** attempt : 300 * (attempt + 1)) + Math.random() * 400);
    }
  }
  const m = meter();
  // Calls cancelled on purpose (deadline, a slow voter cut off) are not provider failures.
  if (m && !opts.signal?.aborted) m.llmFailed++;
  throw new Error(`LLM request failed: ${String(lastError)}`);
}

export async function completeJson<T>(prompt: string, schema?: object, opts: LlmOptions = {}, retries = 2): Promise<T> {
  const full = schema
    ? `${prompt}\n\nRespond with a single valid JSON object matching this JSON schema exactly:\n${JSON.stringify(schema)}`
    : `${prompt}\n\nRespond with a single valid JSON object only.`;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const text = await completeText(full, { ...opts, json: true }, 1);
    try {
      return JSON.parse(stripFences(text)) as T;
    } catch (e) {
      lastError = e;
      log.warn(`invalid JSON (attempt ${attempt + 1})`, { sample: text.slice(0, 200) });
    }
  }
  throw new Error(`LLM returned invalid JSON: ${String(lastError)}`);
}

export async function* streamText(prompt: string, opts: LlmOptions = {}): AsyncGenerator<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body(prompt, opts, { stream: true })),
    signal: AbortSignal.any([AbortSignal.timeout(opts.timeoutMs ?? 50_000), ...(opts.signal ? [opts.signal] : [])]),
  });
  if (!res.ok || !res.body) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") return;
      try {
        const delta = (JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        continue;
      }
    }
  }
}
