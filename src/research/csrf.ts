/**
 * CSRF protection for browser-facing POST endpoints (Bun 1.4).
 *
 * Pattern: double-submit via header, built on `Bun.CSRF` + `Bun.Cookie`.
 *   - GET /ops (and /ops.json) issues a short-lived token via
 *     `Bun.CSRF.generate` (HMAC-signed with a process secret) and sets it as
 *     an HttpOnly SameSite=Lax cookie. The same token is inlined into the
 *     dashboard page so its JS can echo it in the `x-csrf-token` header.
 *   - POST handlers run through `csrfGuard`, which requires the header token
 *     to verify. Cross-site attackers cannot read the HttpOnly cookie nor mint
 *     a valid token (the signing secret is unguessable), so forged POSTs get
 *     403 before any handler runs.
 *
 * Secrets: without `KALSHI_CSRF_SECRET` Bun keeps one random in-memory secret
 * for the process (verified: generate()/verify() roundtrip with no secret).
 * Setting `KALSHI_CSRF_SECRET` makes tokens survive server restarts.
 * Expiry is embedded in the token (default 24h); restart invalidates
 * outstanding tokens until the dashboard refreshes — acceptable.
 *
 * @see https://bun.com/docs/runtime/csrf (Bun 1.4 CSRF utilities)
 * @see src/lib/redact.ts — output hygiene; unrelated but complementary
 */
export const CSRF_COOKIE_NAME = "kalshi_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const CSRF_EXPIRES_IN_MS = 24 * 60 * 60 * 1000;

/** Optional stable signing secret from env; undefined → Bun's in-memory default. */
export function csrfSecret(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): string | undefined {
  const s = env.KALSHI_CSRF_SECRET?.trim();
  return s ? s : undefined;
}

export type CsrfSession = {
  /** Token the page must echo back in the CSRF header. */
  token: string;
  /** Ready-to-send Set-Cookie header carrying the same token. */
  cookie: string;
};

/** Issue a fresh token + Set-Cookie header for a dashboard GET. */
export function issueCsrfSession(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): CsrfSession {
  // Bun quirk: generate(undefined, opts) throws "Secret is required" — an
  // explicit undefined is NOT the same as an omitted secret. Branch on it:
  // no env secret → the process-wide in-memory default (verified roundtrip);
  // env secret → explicit secret with the same 24h expiry.
  const secret = csrfSecret(env);
  const token = secret
    ? Bun.CSRF.generate(secret, { expiresIn: CSRF_EXPIRES_IN_MS })
    : Bun.CSRF.generate();
  const cookie = new Bun.Cookie(CSRF_COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.KALSHI_ENV === "prod",
    maxAge: Math.floor(CSRF_EXPIRES_IN_MS / 1000),
  }).toString();
  return { token, cookie };
}

/** The CSRF token the client echoed (header), trimmed. */
export function csrfTokenFrom(req: Request): string | null {
  const header = req.headers.get(CSRF_HEADER_NAME);
  if (header && header.trim()) return header.trim();
  return null;
}

/** The token stored in the request's `kalshi_csrf` cookie, if any. */
export function csrfCookieFrom(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  return new Bun.CookieMap(cookieHeader).get(CSRF_COOKIE_NAME) ?? null;
}

/**
 * True when the request carries a token that verifies against the secret AND
 * matches the session cookie (double-submit binding). A valid HMAC alone is
 * not enough — any token minted by this process would pass — so the header
 * must equal the HttpOnly `kalshi_csrf` cookie the browser sent.
 */
export function verifyCsrfRequest(
  req: Request,
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): boolean {
  const token = csrfTokenFrom(req);
  if (!token) return false;
  const cookie = csrfCookieFrom(req);
  if (!cookie || cookie !== token) return false;
  try {
    return Bun.CSRF.verify(token, { secret: csrfSecret(env) });
  } catch {
    return false;
  }
}

/**
 * Middleware: reject with 403 JSON before `next` when the CSRF token is
 * missing or invalid. Same shape as serve.ts's other guards
 * (rateLimiter/stateValidator/complianceGate).
 */
export function csrfGuard(
  req: Request,
  next: () => Promise<Response> | Response,
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
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
