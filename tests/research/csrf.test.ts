import { describe, expect, test } from "bun:test";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  csrfGuard,
  csrfTokenFrom,
  issueCsrfSession,
  verifyCsrfRequest,
} from "../../src/research/csrf.ts";

const EMPTY_ENV: Record<string, string | undefined> = {};

function postRequest(token: string | null, cookie?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers[CSRF_HEADER_NAME] = token;
  if (cookie) headers["cookie"] = cookie;
  return new Request("http://localhost/place-bet", { method: "POST", headers });
}

describe("CSRF double-submit guard (Bun.CSRF + Bun.Cookie)", () => {
  test("an issued token verifies via the header", () => {
    const { token, cookie } = issueCsrfSession(EMPTY_ENV);
    expect(verifyCsrfRequest(postRequest(token, cookie), EMPTY_ENV)).toBe(true);
  });

  test("a request with no header is rejected", () => {
    expect(verifyCsrfRequest(postRequest(null), EMPTY_ENV)).toBe(false);
  });

  test("a garbage token is rejected", () => {
    expect(verifyCsrfRequest(postRequest("not-a-real-token"), EMPTY_ENV)).toBe(false);
  });

  test("a token signed with a different secret is rejected", () => {
    const { token, cookie } = issueCsrfSession({ KALSHI_CSRF_SECRET: "one" });
    expect(verifyCsrfRequest(postRequest(token, cookie), { KALSHI_CSRF_SECRET: "two" })).toBe(
      false,
    );
  });

  test("csrfTokenFrom trims whitespace", () => {
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { [CSRF_HEADER_NAME]: "  tok  " },
    });
    expect(csrfTokenFrom(req)).toBe("tok");
  });

  test("guard passes a valid request (token + matching cookie) through", async () => {
    const { token, cookie } = issueCsrfSession(EMPTY_ENV);
    let called = false;
    const res = await csrfGuard(
      postRequest(token, cookie),
      () => {
        called = true;
        return new Response("ok");
      },
      EMPTY_ENV,
    );
    expect(called).toBe(true);
    expect(res.status).toBe(200);
  });

  test("header token that does not match the cookie is rejected", () => {
    const { token } = issueCsrfSession(EMPTY_ENV);
    const other = issueCsrfSession(EMPTY_ENV).token;
    expect(verifyCsrfRequest(postRequest(token, "kalshi_csrf=" + other), EMPTY_ENV)).toBe(false);
  });

  test("token without a session cookie is rejected (double-submit binding)", () => {
    const { token } = issueCsrfSession(EMPTY_ENV);
    expect(verifyCsrfRequest(postRequest(token), EMPTY_ENV)).toBe(false);
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

  test("cookie is HttpOnly SameSite=Lax; Secure only in prod", () => {
    const dev = issueCsrfSession(EMPTY_ENV).cookie;
    expect(dev).toContain(CSRF_COOKIE_NAME + "=");
    expect(dev).toContain("HttpOnly");
    expect(dev).toContain("SameSite=Lax");
    expect(dev).not.toContain("Secure");

    const prod = issueCsrfSession({ KALSHI_ENV: "prod" }).cookie;
    expect(prod).toContain("Secure");
  });

  test("explicit KALSHI_CSRF_SECRET roundtrips; default env rejects it", () => {
    const env = { KALSHI_CSRF_SECRET: "s3cret" };
    const { token, cookie } = issueCsrfSession(env);
    expect(verifyCsrfRequest(postRequest(token, cookie), env)).toBe(true);
    expect(verifyCsrfRequest(postRequest(token, cookie), EMPTY_ENV)).toBe(false);
  });
});
