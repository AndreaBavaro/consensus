import { AsyncLocalStorage } from "node:async_hooks";

/** Per-search spend and call counters. Everything started inside `meterStore.run` reports into the same meter. */
export interface Meter {
  llmUsd: number;
  llmCalls: number;
  llmFailed: number;
  xUsd: number;
  xCalls: number;
  xRetries: number;
  xFailed: number;
  serperCredits: number;
  serperCalls: number;
  /** Serper calls that came back 2xx; zero means search was unavailable for this run. */
  serperOk: number;
  redditFetches: number;
  redditFailed: number;
  /** Size of Reddit responses read through the proxy (decoded JSON, an estimate of billed traffic). */
  oxylabsBytes: number;
}

export const newMeter = (): Meter => ({
  llmUsd: 0,
  llmCalls: 0,
  llmFailed: 0,
  xUsd: 0,
  xCalls: 0,
  xRetries: 0,
  xFailed: 0,
  serperCredits: 0,
  serperCalls: 0,
  serperOk: 0,
  redditFetches: 0,
  redditFailed: 0,
  oxylabsBytes: 0,
});

export const meterStore = new AsyncLocalStorage<Meter>();
export const meter = (): Meter | undefined => meterStore.getStore();
