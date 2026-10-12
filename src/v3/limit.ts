/** Minimal counting semaphore so one instance never floods a provider. */
export class Semaphore {
  private waiting: (() => void)[] = [];
  constructor(private free: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((r) => this.waiting.push(r));
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.free++;
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolves with the promise's value, or `fallback` once `ms` passes. */
export function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, sleep(Math.max(0, ms)).then(() => fallback)]);
}

export const flat = (t: string | null | undefined, n: number) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
