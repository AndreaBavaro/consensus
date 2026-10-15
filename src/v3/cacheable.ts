/**
 * Whether a finished search may be written to the shared result cache. "empty" was never cached; "error" (provider
 * outage, added 2026-10-14) must not be either, or one outage would be replayed to every visitor for CACHE_TTL_HOURS.
 */
export const isCacheable = (status: string | undefined): boolean => status === "ok" || status === "thin";
