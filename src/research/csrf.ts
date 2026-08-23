/**
 * CSRF protection for browser-facing POST endpoints (Bun 1.4).
 *
 * Docs-aligned flow (https://bun.com/docs/runtime/csrf): the token is
 * BOUND TO A PER-VISITOR SESSION via the `sessionId` option — the docs warn
 * that without it, any token the server has ever issued validates for every
 * user, so an attacker could replay their own token in a forged request.
 *
 *   - GET /ops (and /ops.json) resolves or mints a `kalshi_session` cookie
 *     (HttpOnly SameSite=Lax), generates `Bun.CSRF.generate(secret,
 *     { sessionId, expiresIn })`, sets the session cookie, and inlines the
 *     token into the dashboard page so its JS can echo it in the
 *     `x-csrf-token` header.
 *   - POST handlers run through `csrfGuard`, which requires a header token
 *     that verifies against the SAME sessionId carried by the request's
 *     session cookie. Cross-site attackers cannot read the HttpOnly cookie,
 *     so they cannot forge the sessionId binding nor mint a valid token
 *     (secret is unguessable) — forged POSTs get 403 before any handler.
 *
 * Secrets: `KALSHI_CSRF_SECRET` pins a stable signing secret so tokens
 * survive restarts; without it a module-level random secret mirrors Bun's
 * documented per-thread in-memory default (tokens die on restart).
 *
 * @see https://bun.com/docs/runtime/csrf (Bun 1.4 CSRF utilities)
 * @see src/lib/redact.ts — output hygiene; unrelated but complementary
 */
export const CSRF_SESSION_COOKIE = "kalshi_session";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const CSRF_EXPIRES_IN_MS = 24 * 60 * 60 * 1000;
export const CSRF_SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

/**
 * Optional stable signing secret from env (`KALSHI_CSRF_SECRET`).
 * Without it we fall back to a module-level random secret that mirrors
 * Bun's documented per-thread in-memory default (tokens die on restart) —
 * but we ALWAYS pass an explicit secret: Bun 1.4 throws "Secret is
 * required" for `generate(undefined, opts)` (probed), and sessionId
 * binding (the Bun docs requirement) needs the options form.
 */
const FALLBACK_CSRF_SECRET = crypto.randomUUID();

export function csrfSecret(
  env: Record<string, string | undefined> = Bun.env,
): string {
  const s = env.KALSHI_CSRF_SECRET?.trim();
  return s ? s : FALLBACK_CSRF_SECRET;
}

export type CsrfSession = {
  /** Token the page must echo back in the CSRF header. */
  token: string;
  /** Per-visitor session id the token is bound to (Bun docs: always bind). */
  sessionId: string;
  /** Ready-to-send Set-Cookie header carrying the session id. */
  sessionCookie: string;
};

/**
 * Issue a fresh token for the visitor's session + Set-Cookie header.
 * Pass the request to preserve an existing session cookie; mint a new
 * session otherwise (never a shared placeholder — see the Bun docs warning).
 */
export function issueCsrfSession(
  req?: Request,
  env: Record<string, string | undefined> = Bun.env,
): CsrfSession {
  const secret = csrfSecret(env);
  const existing = req ? csrfSessionIdFrom(req) : null;
  const sessionId = existing ?? crypto.randomUUID();
  const token = Bun.CSRF.generate(secret, { sessionId, expiresIn: CSRF_EXPIRES_IN_MS });
  const sessionCookie = new Bun.Cookie(CSRF_SESSION_COOKIE, sessionId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.KALSHI_ENV === "prod",
    maxAge: CSRF_SESSION_MAX_AGE_SEC,
  }).toString();
  return { token, sessionId, sessionCookie };
}

/** The CSRF token the client echoed (header), trimmed. */
export function csrfTokenFrom(req: Request): string | null {
  const header = req.headers.get(CSRF_HEADER_NAME);
  if (header && header.trim()) return header.trim();
  return null;
}

/** The per-visitor session id from the request's `kalshi_session` cookie. */
export function csrfSessionIdFrom(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  return new Bun.CookieMap(cookieHeader).get(CSRF_SESSION_COOKIE) ?? null;
}

/**
 * True when the request carries a token that verifies against the secret
 * AND the sessionId from the session cookie (Bun docs: tokens must be
 * session-bound — a valid HMAC alone is rejected).
 */
export function verifyCsrfRequest(
  req: Request,
  env: Record<string, string | undefined> = Bun.env,
): boolean {
  const token = csrfTokenFrom(req);
  if (!token) return false;
  const sessionId = csrfSessionIdFrom(req);
  if (!sessionId) return false;
  try {
    return Bun.CSRF.verify(token, { secret: csrfSecret(env), sessionId });
  } catch {
    return false;
  }
}

/**
 * Middleware: reject with 403 JSON before `next` when the CSRF token is
 * missing, unverifiable, or bound to a different session. Same shape as
 * serve.ts's other guards (rateLimiter/stateValidator/complianceGate).
 */
export function csrfGuard(
  req: Request,
  next: () => Promise<Response> | Response,
  env: Record<string, string | undefined> = Bun.env,
): Promise<Response> | Response {
  if (!verifyCsrfRequest(req, env)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "CSRF token missing or invalid — refresh the ops dashboard and retry",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  return next();
}
