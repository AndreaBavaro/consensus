import { randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

/*
 * Consensus accounts are Straitly accounts: the same Firebase project (straitly-5a121) issues the ID token, so anyone
 * with a Straitly login signs in here with the same credentials and vice versa. Tokens are verified against Google's
 * public keys; no service-account secret is needed.
 */
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "straitly-5a121";
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com"));

export const SESSION_COOKIE = "cs_session";
export const ANON_COOKIE = "cs_anon";

export interface SessionUser {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  email_verified: boolean;
}

export async function verifyIdToken(token: string): Promise<SessionUser | null> {
  if (!token || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: `https://securetoken.google.com/${PROJECT_ID}`, audience: PROJECT_ID });
    const uid = String(payload.sub || "");
    if (!uid) return null;
    const identities = (payload.firebase as { identities?: Record<string, unknown> } | undefined)?.identities ?? {};
    return {
      uid,
      email: (payload.email as string) || null,
      name: (payload.name as string) || null,
      picture: (payload.picture as string) || null,
      email_verified: payload.email_verified === true || ["google.com", "github.com"].some((p) => p in identities),
    };
  } catch {
    return null;
  }
}

export function readCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        /* malformed cookie, ignore */
      }
    }
  }
  return out;
}

export const sessionUser = (req: Request) => verifyIdToken(readCookies(req)[SESSION_COOKIE] ?? "");

const secure = (req: Request) => (new URL(req.url).protocol === "https:" ? "; Secure" : "");

export function cookie(req: Request, name: string, value: string, maxAgeSec: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure(req)}`;
}

/** Anonymous visitor id for the one free search; issued on first contact. */
export function anonId(req: Request): { id: string; setCookie: string | null } {
  const have = readCookies(req)[ANON_COOKIE];
  if (have && /^[A-Za-z0-9_-]{16,64}$/.test(have)) return { id: have, setCookie: null };
  const id = randomBytes(18).toString("base64url");
  return { id, setCookie: cookie(req, ANON_COOKIE, id, 365 * 86_400) };
}

export const clientIp = (req: Request, contextIp?: string) =>
  (contextIp || req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim().slice(0, 64);

/** Same-origin check for cookie-setting POST/DELETE (blocks cross-site form posts). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}
