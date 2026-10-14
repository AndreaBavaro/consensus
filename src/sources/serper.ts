import { env } from "../lib/env.ts";
import { logger } from "../lib/log.ts";
import { meter } from "../lib/meter.ts";

const log = logger("serper");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface OrganicResult {
  title: string;
  link: string;
  snippet?: string;
  date?: string;
}

/** YYYY-MM-DD -> MM/DD/YYYY for Google's custom date range (tbs=cdr:1,cd_min:...,cd_max:...). */
const googleDate = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
};

/**
 * Google search through Serper (50 req/s). A start/end date becomes Google's custom date range, which is what makes
 * the date filter real for Reddit threads (the old `after:` text in the query did nothing reliable).
 */
export async function googleSearch(
  q: string,
  opts: { num?: number; since?: string; until?: string; signal?: AbortSignal } = {},
): Promise<OrganicResult[]> {
  const key = env.serperKey;
  if (!key) throw new Error("Missing environment variable SERPER_API_KEY");
  const range = [opts.since && `cd_min:${googleDate(opts.since)}`, opts.until && `cd_max:${googleDate(opts.until)}`].filter(Boolean);
  const body = { q, num: opts.num ?? 20, ...(range.length ? { tbs: `cdr:1,${range.join(",")}` } : {}) };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.any([AbortSignal.timeout(8_000), ...(opts.signal ? [opts.signal] : [])]),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`serper ${res.status}`);
      const data = (await res.json()) as { organic?: { title?: string; link?: string; snippet?: string; date?: string }[]; credits?: number; message?: string };
      const m = meter();
      if (m) {
        m.serperCalls++;
        m.serperCredits += Number(data.credits ?? 1);
      }
      if (m && res.ok) m.serperOk++;
      if (!res.ok) {
        log.error(`serper ${res.status}`, { message: data.message });
        return [];
      }
      return (data.organic ?? []).filter((r) => r.link).map((r) => ({ title: r.title ?? "", link: r.link!, snippet: r.snippet, date: r.date }));
    } catch (e) {
      if (opts.signal?.aborted) return [];
      log.warn(`attempt ${attempt + 1} failed`, { error: String(e) });
      await sleep(300 * 2 ** attempt);
    }
  }
  return [];
}
