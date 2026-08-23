import { describe, expect, test } from "bun:test";
import {
  CSRF_HEADER_NAME,
  CSRF_SESSION_COOKIE,
  csrfGuard,
  csrfTokenFrom,
  issueCsrfSession,
  verifyCsrfRequest,
} from "../../src/research/csrf.ts";

const EMPTY_ENV: Record<string, string | undefined> = {};

function postRequest(token: string | null, sessionId?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers[CSRF_HEADER_NAME] = token;
  if (sessionId) headers["cookie"] = CSRF_SESSION_COOKIE + "=" + sessionId;
  return new Request("http://localhost/place-bet", { method: "POST", headers });
}

describe("CSRF session-bound guard (Bun.CSRF + Bun.Cookie, per bun docs)", () => {
  test("an issued token verifies with its session id", () => {
    const { token, sessionId } = issueCsrfSession(undefined, EMPTY_ENV);
    expect(verifyCsrfRequest(postRequest(token, sessionId), EMPTY_ENV)).toBe(true);
  });

  test("a request with no header is rejected", () => {
    expect(verifyCsrfRequest(postRequest(null), EMPTY_ENV)).toBe(false);
  });

  test("a garbage token is rejected", () => {
    expect(verifyCsrfRequest(postRequest("not-a-real-token", "sid"), EMPTY_ENV)).toBe(false);
  });

  test("a token bound to another session is rejected (docs warning)", () => {
    const a = issueCsrfSession(undefined, EMPTY_ENV);
    const b = issueCsrfSession(undefined, EMPTY_ENV);
    expect(verifyCsrfRequest(postRequest(a.token, b.sessionId), EMPTY_ENV)).toBe(false);
  });

  test("a token without a session cookie is rejected", () => {
    const { token } = issueCsrfSession(undefined, EMPTY_ENV);
    expect(verifyCsrfRequest(postRequest(token), EMPTY_ENV)).toBe(false);
  });

  test("a token signed with a different secret is rejected", () => {
    const a = issueCsrfSession(undefined, { KALSHI_CSRF_SECRET: "one" });
    expect(
      verifyCsrfRequest(postRequest(a.token, a.sessionId), { KALSHI_CSRF_SECRET: "two" }),
    ).toBe(false);
  });

  test("issueCsrfSession preserves an existing session when given the request", () => {
    const first = issueCsrfSession(undefined, EMPTY_ENV);
    const secondReq = new Request("http://localhost/ops", {
      headers: { cookie: CSRF_SESSION_COOKIE + "=" + first.sessionId },
    });
    const second = issueCsrfSession(secondReq, EMPTY_ENV);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.token).not.toBe(first.token);
    expect(verifyCsrfRequest(postRequest(second.token, second.sessionId), EMPTY_ENV)).toBe(true);
  });

  test("csrfTokenFrom trims whitespace", () => {
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { [CSRF_HEADER_NAME]: "  tok  " },
    });
    expect(csrfTokenFrom(req)).toBe("tok");
  });

  test("guard passes a valid request (token + session) through", async () => {
    const { token, sessionId } = issueCsrfSession(undefined, EMPTY_ENV);
    let called = false;
    const res = await csrfGuard(
      postRequest(token, sessionId),
      () => {
        called = true;
        return new Response("ok");
      },
      EMPTY_ENV,
    );
    expect(called).toBe(true);
    expect(res.status).toBe(200);
  });

  test("guard 403s an invalid request without calling next", async () => {
    const res = await csrfGuard(
      postRequest(null),
      () => {
        throw new Error("next must not run");
      },
      EMPTY_ENV,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  test("session cookie is HttpOnly SameSite=Lax; Secure only in prod", () => {
    const dev = issueCsrfSession(undefined, EMPTY_ENV).sessionCookie;
    expect(dev).toContain(CSRF_SESSION_COOKIE + "=");
    expect(dev).toContain("HttpOnly");
    expect(dev).toContain("SameSite=Lax");
    expect(dev).not.toContain("Secure");

    const prod = issueCsrfSession(undefined, { KALSHI_ENV: "prod" }).sessionCookie;
    expect(prod).toContain("Secure");
  });

  test("explicit KALSHI_CSRF_SECRET roundtrips; another secret rejects", () => {
    const env = { KALSHI_CSRF_SECRET: "s3cret" };
    const { token, sessionId } = issueCsrfSession(undefined, env);
    expect(verifyCsrfRequest(postRequest(token, sessionId), env)).toBe(true);
    expect(verifyCsrfRequest(postRequest(token, sessionId), EMPTY_ENV)).toBe(false);
  });
});
