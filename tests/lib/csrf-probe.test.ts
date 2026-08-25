// CSRF machinery tests (§77) — session-bound token verification,
// anti-replay, secret pinning, expiry bounds.
import { describe, expect, test } from "bun:test";
import { issueCsrfSession, verifyCsrfRequest, csrfGuard, CSRF_HEADER_NAME, CSRF_SESSION_COOKIE } from "../../src/research/csrf.ts";

const SECRET = "test-secret";

function authedReq(sessionId: string, token: string): Request {
  return new Request("http://x", {
    headers: {
      cookie: CSRF_SESSION_COOKIE + "=" + sessionId,
      [CSRF_HEADER_NAME]: token,
    },
  });
}

describe("CSRF session binding (§77)", () => {
  test("valid request verifies; forged (token A, cookie B) rejected", () => {
    const s1 = issueCsrfSession(undefined, { KALSHI_CSRF_SECRET: SECRET });
    const s2 = issueCsrfSession(undefined, { KALSHI_CSRF_SECRET: SECRET });
    expect(verifyCsrfRequest(authedReq(s1.sessionId, s1.token), { KALSHI_CSRF_SECRET: SECRET })).toBe(true);
    expect(verifyCsrfRequest(authedReq(s2.sessionId, s1.token), { KALSHI_CSRF_SECRET: SECRET })).toBe(false);
  });

  test("missing token or cookie rejected; csrfGuard returns 403", async () => {
    const s = issueCsrfSession(undefined, { KALSHI_CSRF_SECRET: SECRET });
    const noToken = new Request("http://x", { headers: { cookie: CSRF_SESSION_COOKIE + "=" + s.sessionId } });
    const noCookie = new Request("http://x", { headers: { [CSRF_HEADER_NAME]: s.token } });
    expect(verifyCsrfRequest(noToken, { KALSHI_CSRF_SECRET: SECRET })).toBe(false);
    expect(verifyCsrfRequest(noCookie, { KALSHI_CSRF_SECRET: SECRET })).toBe(false);
    const res = await csrfGuard(noToken, async () => new Response("ok"), { KALSHI_CSRF_SECRET: SECRET });
    expect(res.status).toBe(403);
  });

  test("existing cookie preserves sessionId (no churn)", () => {
    const req = new Request("http://x", { headers: { cookie: CSRF_SESSION_COOKIE + "=existing-sid" } });
    expect(issueCsrfSession(req, { KALSHI_CSRF_SECRET: SECRET }).sessionId).toBe("existing-sid");
  });

  test("secret pinning: token-A fails under secret-B", () => {
    const s = issueCsrfSession(undefined, { KALSHI_CSRF_SECRET: "secret-A" });
    expect(verifyCsrfRequest(authedReq(s.sessionId, s.token), { KALSHI_CSRF_SECRET: "secret-B" })).toBe(false);
  });

  test("generate(undefined) throws Secret is required", () => {
    expect(() => (Bun as any).CSRF.generate(undefined, { sessionId: "x" })).toThrow(/Secret is required/);
  });

  test("expiresIn: negative throws, 24h accepted (probe nuance §77)", () => {
    expect(() => (Bun as any).CSRF.generate(SECRET, { sessionId: "x", expiresIn: -1 })).toThrow();
    const t = (Bun as any).CSRF.generate(SECRET, { sessionId: "x", expiresIn: 86400000 });
    expect((Bun as any).CSRF.verify(t, { secret: SECRET, sessionId: "x" })).toBe(true);
  });
});