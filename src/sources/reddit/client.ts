import { randomUUID } from "node:crypto";
import { ProxyAgent, fetch, type Dispatcher } from "undici";
import { env } from "../../lib/env.ts";
import { logger } from "../../lib/log.ts";

const log = logger("reddit");

const ANDROID_CLIENT_ID = "ohXpoqrZYub1kg";
const APP_VERSIONS = ["2023.47.0", "2023.45.0", "2023.44.0"];
const TOKEN_COUNT = Number(process.env.REDDIT_TOKENS ?? 8);
const POOL_CONNECTIONS = Number(process.env.REDDIT_POOL ?? 256);
const TOKEN_TTL_MS = 12 * 3600 * 1000;
const ATTEMPT_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 4;
const HEDGE_AFTER_MS = 2_500;

interface Token {
  accessToken: string;
  headers: Record<string, string>;
  expiresAt: number;
}

const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)]!;

function proxyUrl(): string {
  return `http://customer-${env.oxylabsUsername}-cc-US:${encodeURIComponent(env.oxylabsPassword)}@pr.oxylabs.io:7777`;
}

let sharedAgent: ProxyAgent | null = null;
function agent(fresh = false): Dispatcher {
  if (fresh) return new ProxyAgent({ uri: proxyUrl(), connections: 4 });
  sharedAgent ??= new ProxyAgent({ uri: proxyUrl(), connections: POOL_CONNECTIONS });
  return sharedAgent;
}

function deviceHeaders(deviceId: string): Record<string, string> {
  // 2026-10-11: oauth.reddit.com started answering 403 to the exact old header set (any one header removed passes).
  // x-reddit-qos / x-reddit-retry are dropped; the remaining set was re-verified at 30 threads x 8 tokens.
  return {
    "User-Agent": `Reddit/${pick(APP_VERSIONS)} (Android ${9 + Math.floor(Math.random() * 6)})`,
    Accept: "*/*",
    "x-reddit-compression": "1",
    "client-vendor-id": deviceId,
    "X-Reddit-Device-Id": deviceId,
  };
}

async function fetchToken(): Promise<Token> {
  const deviceId = randomUUID();
  const headers = deviceHeaders(deviceId);
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    dispatcher: agent(true),
    headers: {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${ANDROID_CLIENT_ID}:`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "https://oauth.reddit.com/grants/installed_client",
      device_id: deviceId,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`token request ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  return {
    accessToken: data.access_token,
    headers,
    expiresAt: Date.now() + Math.min((data.expires_in ?? 86400) * 1000, TOKEN_TTL_MS),
  };
}

let tokens: Token[] = [];
let tokenRequest: Promise<Token[]> | null = null;
let cursor = 0;

async function loadTokens(): Promise<Token[]> {
  const results = await Promise.allSettled(Array.from({ length: TOKEN_COUNT }, fetchToken));
  const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  if (failed.length) log.warn(`${failed.length}/${TOKEN_COUNT} token requests failed`, { error: String(failed[0]?.reason) });
  if (!ok.length) throw new Error("Could not obtain any Reddit tokens");
  log.info(`loaded ${ok.length} tokens`);
  return ok;
}

async function getToken(): Promise<Token> {
  tokens = tokens.filter((t) => t.expiresAt > Date.now() + 60_000);
  if (!tokens.length) {
    tokenRequest ??= loadTokens().finally(() => (tokenRequest = null));
    tokens = await tokenRequest;
  }
  return tokens[cursor++ % tokens.length]!;
}

function dropToken(token: Token) {
  tokens = tokens.filter((t) => t !== token);
}

const NOT_FOUND = Symbol("not-found");

async function attemptFetch(path: string, fresh: boolean, signal: AbortSignal): Promise<unknown> {
  const token = await getToken();
  const res = await fetch(`https://oauth.reddit.com${path}`, {
    dispatcher: agent(fresh),
    headers: { ...token.headers, Authorization: `Bearer ${token.accessToken}` },
    signal: AbortSignal.any([signal, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)]),
  });
  if (res.status === 401) {
    dropToken(token);
    throw new Error("401 unauthorized");
  }
  if (res.status === 404) return NOT_FOUND;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetch `oauth.reddit.com/comments/{id}`. A failed attempt is retried at once on a fresh proxy IP, and a slow one
 * is hedged with a parallel attempt after HEDGE_AFTER_MS, since proxy drops are random rather than tied to bad IPs.
 */
export async function fetchPostListing(postId: string): Promise<unknown> {
  return fetchRedditPath(`/comments/${postId}?raw_json=1`);
}

/** Same hedged, retried fetch for any oauth.reddit.com path (e.g. /search). */
export async function fetchRedditPath(path: string): Promise<unknown> {
  const r = await fetchRedditPathStatus(path);
  return r.status === "ok" ? r.body : null;
}

/** As fetchRedditPath, but keeps a 404 ("not_found") apart from a fetch that failed on every attempt ("failed"). */
export async function fetchRedditPathStatus(path: string): Promise<{ status: "ok"; body: unknown } | { status: "not_found" | "failed" }> {
  const controller = new AbortController();
  let started = 0;
  let failed = 0;
  let lastError: unknown;

  const result = await new Promise<unknown>((resolve) => {
    let hedgeTimer: NodeJS.Timeout | undefined;
    const launch = () => {
      if (started >= MAX_ATTEMPTS || controller.signal.aborted) return;
      const fresh = started > 0;
      started++;
      clearTimeout(hedgeTimer);
      hedgeTimer = setTimeout(launch, HEDGE_AFTER_MS);
      attemptFetch(path, fresh, controller.signal).then(
        (value) => {
          clearTimeout(hedgeTimer);
          resolve(value);
        },
        (e) => {
          lastError = e;
          if (++failed >= MAX_ATTEMPTS) {
            clearTimeout(hedgeTimer);
            resolve(null);
          } else if (failed === started) {
            launch();
          }
        },
      );
    };
    launch();
  });

  controller.abort();
  if (result === null) {
    log.warn(`${path} failed after ${started} attempts`, { error: String(lastError) });
    return { status: "failed" };
  }
  return result === NOT_FOUND ? { status: "not_found" } : { status: "ok", body: result };
}
