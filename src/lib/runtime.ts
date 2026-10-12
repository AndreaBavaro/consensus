import type { Context } from "@netlify/functions";

/**
 * True only for local development. `NETLIFY`/`CONTEXT` are build-time variables and are not set at function runtime,
 * so the per-request deploy context is the reliable signal; outside Netlify entirely (scripts, tests) counts as dev.
 */
export function isDevRuntime(context?: Context): boolean {
  const deployContext = context?.deploy?.context;
  if (deployContext) return deployContext === "dev";
  return !process.env.NETLIFY && !process.env.NETLIFY_BLOBS_CONTEXT && !process.env.AWS_LAMBDA_FUNCTION_NAME;
}
