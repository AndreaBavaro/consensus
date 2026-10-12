import type { Config, Context } from "@netlify/functions";
import { anonId, cookie, readCookies, sameOrigin, SESSION_COOKIE, sessionUser, verifyIdToken } from "../../src/v3/auth.ts";
import { anonFreeSearch, clearHistory, touchUser, userHistory } from "../../src/v3/store.ts";

const json = (body: unknown, status = 200, setCookies: (string | null)[] = []) => {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  for (const c of setCookies) if (c) headers.append("Set-Cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
};

/**
 * POST   /api/v3/session {idToken}  -> verifies a Straitly (Firebase) ID token, sets an httpOnly session cookie
 * DELETE /api/v3/session            -> signs out
 * GET    /api/v3/me                 -> {user, free_searches_left}
 * GET    /api/v3/history            -> {searches:[{id,query,since,until,sources,at}]} (signed in only)
 * DELETE /api/v3/history[?id=]      -> remove one entry or clear all
 */
export default async (req: Request, _context: Context) => {
  const path = new URL(req.url).pathname;

  if (path.endsWith("/me")) {
    if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    const user = await sessionUser(req);
    const anon = anonId(req);
    const used = user ? null : await anonFreeSearch(anon.id);
    return json(
      { user: user ? { uid: user.uid, email: user.email, name: user.name, picture: user.picture } : null, free_searches_left: user ? null : used ? 0 : 1, free_search_id: used ?? null },
      200,
      [anon.setCookie],
    );
  }

  if (path.endsWith("/history")) {
    const user = await sessionUser(req);
    if (!user) return json({ error: "signup_required", message: "Sign in to see your searches." }, 401);
    if (req.method === "GET") return json({ searches: await userHistory(user.uid) });
    if (req.method === "DELETE") {
      if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
      const id = new URL(req.url).searchParams.get("id") ?? undefined;
      if (id && !/^[A-Za-z0-9_-]{8,32}$/.test(id)) return json({ error: "bad_request" }, 400);
      await clearHistory(user.uid, id);
      return json({ ok: true });
    }
    return json({ error: "method_not_allowed" }, 405);
  }

  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);

  if (req.method === "POST") {
    let idToken = "";
    try {
      idToken = String(((await req.json()) as { idToken?: unknown })?.idToken ?? "");
    } catch {
      return json({ error: "bad_request", message: "invalid body" }, 400);
    }
    const user = await verifyIdToken(idToken);
    if (!user) return json({ error: "invalid_token", message: "Sign-in expired. Please sign in again." }, 401);
    const had = await verifyIdToken(readCookies(req)[SESSION_COOKIE] ?? "");
    if (!had || had.uid !== user.uid) await touchUser(user).catch(() => {});
    // Firebase ID tokens live 1h; the client re-posts on every token refresh.
    return json({ ok: true, user: { uid: user.uid, email: user.email, name: user.name, picture: user.picture } }, 200, [cookie(req, SESSION_COOKIE, idToken, 3600)]);
  }

  if (req.method === "DELETE") return json({ ok: true }, 200, [cookie(req, SESSION_COOKIE, "", 0)]);

  return json({ error: "method_not_allowed" }, 405);
};

export const config: Config = {
  path: ["/api/v3/session", "/api/v3/me", "/api/v3/history"],
};
