// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CHALLENGE_RE,
  EMPTY_JAR,
  absorbCdpCookies,
  absorbDocumentCookies,
  absorbSetCookieHeaders,
  applyMasseyProxyEnv,
  cookieHeader,
  cookiesFromDocumentCookie,
  cookiesToCdpSet,
  isChallengeHtml,
  jarIsFresh,
  loadHeaderJar,
  masseyFetchProxyOption,
  masseyRequestHeaders,
  mergeCookies,
  parseSetCookie,
  readMasseyProxyEnv,
  saveHeaderJar,
} from "../../../src/institutions/massey/headers.ts";

describe("massey header jar", () => {
  test("parseSetCookie keeps name/value, max-age, flags", () => {
    const now = 1_000_000;
    const c = parseSetCookie("cf_clearance=abc; Path=/; Max-Age=3600; HttpOnly; Secure", now);
    expect(c?.name).toBe("cf_clearance");
    expect(c?.value).toBe("abc");
    expect(c?.path).toBe("/");
    expect(c?.expiresMs).toBe(now + 3_600_000);
    expect(c?.httpOnly).toBe(true);
    expect(c?.secure).toBe(true);
  });

  test("mergeCookies replaces same name+path", () => {
    const a = mergeCookies(
      [{ name: "a", value: "1", path: "/" }],
      [{ name: "a", value: "2", path: "/" }, { name: "b", value: "3", path: "/" }],
    );
    expect(a.find((c) => c.name === "a")?.value).toBe("2");
    expect(a.map((c) => c.name).sort()).toEqual(["a", "b"]);
  });

  test("expired cookies drop out of Cookie header", () => {
    const jar = {
      ...EMPTY_JAR(),
      cookies: [
        { name: "live", value: "1" },
        { name: "dead", value: "2", expiresMs: 1 },
      ],
    };
    expect(cookieHeader(jar, 50)).toBe("live=1");
  });

  test("document.cookie splits into named cookies", () => {
    const cs = cookiesFromDocumentCookie("cf_clearance=x; session=y", "masseyratings.com");
    expect(cs).toHaveLength(2);
    expect(cs[0]).toMatchObject({ name: "cf_clearance", value: "x", domain: "masseyratings.com" });
  });

  test("request headers keep browser casing and attach Cookie", () => {
    const headers = masseyRequestHeaders({
      ...EMPTY_JAR(),
      cookies: [{ name: "cf_clearance", value: "tok" }],
    });
    expect(headers["User-Agent"]).toContain("Chrome/126");
    expect(headers["Sec-Fetch-Mode"]).toBe("navigate");
    expect(headers.Cookie).toBe("cf_clearance=tok");
    expect(Object.keys(headers)).toContain("Accept-Language");
    expect(headers["Accept-Encoding"]).toContain("zstd");
  });

  test("challenge detector hits CF interstitial and 403", () => {
    expect(isChallengeHtml("<html>Just a moment...</html>", 403)).toBe(true);
    expect(isChallengeHtml("<html><title>College Volleyball</title></html>", 200)).toBe(false);
    expect(CHALLENGE_RE.test("cf-mitigated")).toBe(true);
  });

  test("jar round-trips on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "massey-jar-"));
    const path = join(dir, "massey-headers.json");
    try {
      const jar = absorbDocumentCookies(EMPTY_JAR(), "cf_clearance=z", "masseyratings.com", "webview");
      saveHeaderJar(path, jar);
      const loaded = loadHeaderJar(path);
      expect(loaded.cookies[0]?.value).toBe("z");
      expect(jarIsFresh(loaded, 12)).toBe(true);
      expect(jarIsFresh(EMPTY_JAR(), 12)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("absorbSetCookieHeaders uses getSetCookie() and the HTTP status", () => {
    const headers = new Headers();
    headers.append("set-cookie", "one=1; Path=/");
    headers.append("set-cookie", "two=2; Path=/");
    headers.set("cf-ray", "abc-DFW");
    const next = absorbSetCookieHeaders(EMPTY_JAR(), headers, "native-fetch", 403);
    expect(next.cookies.map((c) => c.name).sort()).toEqual(["one", "two"]);
    expect(next.path).toBe("native-fetch");
    expect(next.lastStatus).toBe(403);
    expect(next.lastCfRay).toBe("abc-DFW");
  });

  test("readMasseyProxyEnv prefers MASSEY_HTTPS_PROXY overlay", () => {
    const env = readMasseyProxyEnv({
      HTTPS_PROXY: "http://env:8080",
      MASSEY_HTTPS_PROXY: "http://desk:8080",
      NO_PROXY: "localhost",
    });
    expect(env.httpsProxy).toBe("http://desk:8080");
    expect(env.noProxy).toBe("localhost");
  });

  test("applyMasseyProxyEnv writes Bun.env for the next fetch", () => {
    const prev = Bun.env.HTTPS_PROXY;
    try {
      applyMasseyProxyEnv({ httpsProxy: "http://127.0.0.1:8888" });
      expect(Bun.env.HTTPS_PROXY).toBe("http://127.0.0.1:8888");
    } finally {
      if (prev === undefined) delete Bun.env.HTTPS_PROXY;
      else Bun.env.HTTPS_PROXY = prev;
    }
  });

  test("masseyFetchProxyOption builds CONNECT headers from URL userinfo", () => {
    const opt = masseyFetchProxyOption(
      { httpsProxy: "http://desk:s3cret@127.0.0.1:8888" },
      {},
    );
    expect(opt?.url).toBe("http://desk:s3cret@127.0.0.1:8888");
    expect(opt?.headers?.["Proxy-Authorization"]).toStartWith("Basic ");
    const decoded = atob(opt!.headers!["Proxy-Authorization"]!.slice(6));
    expect(decoded).toBe("desk:s3cret");
  });

  test("MASSEY_PROXY_AUTHORIZATION overrides URL userinfo", () => {
    const opt = masseyFetchProxyOption(
      { httpsProxy: "http://desk:s3cret@127.0.0.1:8888" },
      { MASSEY_PROXY_AUTHORIZATION: "Bearer desk-token" },
    );
    expect(opt?.headers?.["Proxy-Authorization"]).toBe("Bearer desk-token");
  });

  test("cookiesToCdpSet / absorbCdpCookies round-trip clearance", () => {
    const jar = {
      ...EMPTY_JAR(),
      cookies: [{ name: "cf_clearance", value: "tok", domain: "masseyratings.com", path: "/", expiresMs: Date.now() + 60_000 }],
    };
    const cdp = cookiesToCdpSet(jar);
    expect(cdp[0]?.name).toBe("cf_clearance");
    expect(cdp[0]?.httpOnly).toBe(true);
    expect(cdp[0]?.url).toContain("masseyratings.com");
    const merged = absorbCdpCookies(EMPTY_JAR(), [{ name: "cf_clearance", value: "tok", domain: ".masseyratings.com", expires: Date.now() / 1000 + 60 }]);
    expect(merged.cookies[0]?.name).toBe("cf_clearance");
    expect(merged.path).toBe("webview");
  });
});
