// @see https://bun.com/docs/test/index#run-tests
// @see https://bun.com/docs/blog/bun-v1.3.6#httphttps-proxy-support-for-websocket
import { describe, expect, test } from "bun:test";
import {
  hostMatchesNoProxy,
  isHostInNoProxy,
  kalshiWsReconnectBackoffMs,
  parseNoProxyHosts,
  resolveKalshiWsNetOptions,
  resolveKalshiWsProxy,
  resolveKalshiWsTls,
} from "../../src/bot/kalshi-ws.ts";

describe("kalshi-ws proxy", () => {
  test("resolveKalshiWsProxy prefers KALSHI_WS_PROXY over HTTPS_PROXY", () => {
    expect(
      resolveKalshiWsProxy({
        KALSHI_WS_PROXY: "http://kalshi-proxy:9090",
        HTTPS_PROXY: "http://corp:8080",
      }),
    ).toBe("http://kalshi-proxy:9090");
  });

  test("resolveKalshiWsProxy falls back to HTTPS_PROXY then HTTP_PROXY", () => {
    expect(resolveKalshiWsProxy({ HTTPS_PROXY: "http://corp:8080" })).toBe("http://corp:8080");
    expect(resolveKalshiWsProxy({ http_proxy: "http://fallback:3128" })).toBe(
      "http://fallback:3128",
    );
  });

  test("resolveKalshiWsProxy returns undefined when unset", () => {
    expect(resolveKalshiWsProxy({})).toBeUndefined();
    expect(resolveKalshiWsProxy({ KALSHI_WS_PROXY: "  " })).toBeUndefined();
  });

  test("resolveKalshiWsProxy honors NO_PROXY for kalshi host", () => {
    expect(
      resolveKalshiWsProxy(
        { HTTPS_PROXY: "http://corp:8080", NO_PROXY: "external-api-ws.kalshi.com" },
        "external-api-ws.kalshi.com",
      ),
    ).toBeUndefined();
    expect(
      resolveKalshiWsProxy(
        { HTTPS_PROXY: "http://corp:8080", NO_PROXY: ".kalshi.com" },
        "external-api-ws.kalshi.com",
      ),
    ).toBeUndefined();
    expect(
      resolveKalshiWsProxy(
        { HTTPS_PROXY: "http://corp:8080", NO_PROXY: "other.example.com" },
        "external-api-ws.kalshi.com",
      ),
    ).toBe("http://corp:8080");
  });

  test("KALSHI_WS_PROXY bypasses NO_PROXY", () => {
    expect(
      resolveKalshiWsProxy({
        KALSHI_WS_PROXY: "http://forced:9090",
        NO_PROXY: ".kalshi.com",
      }),
    ).toBe("http://forced:9090");
  });
});

describe("kalshi-ws NO_PROXY helpers", () => {
  test("parseNoProxyHosts splits and lowercases", () => {
    expect(parseNoProxyHosts(" Foo , .kalshi.com ")).toEqual(["foo", ".kalshi.com"]);
  });

  test("hostMatchesNoProxy suffix and exact", () => {
    expect(hostMatchesNoProxy("external-api-ws.kalshi.com", ".kalshi.com")).toBe(true);
    expect(hostMatchesNoProxy("example.com", ".kalshi.com")).toBe(false);
    expect(isHostInNoProxy("api.kalshi.com", [".kalshi.com"])).toBe(true);
  });
});

describe("kalshiWsReconnectBackoffMs", () => {
  test("grows exponentially and stays capped with zero jitter", () => {
    expect(kalshiWsReconnectBackoffMs(0, 1_000, 30_000, () => 0)).toBe(1_000);
    expect(kalshiWsReconnectBackoffMs(1, 1_000, 30_000, () => 0)).toBe(2_000);
    expect(kalshiWsReconnectBackoffMs(5, 1_000, 30_000, () => 0)).toBe(30_000);
    expect(kalshiWsReconnectBackoffMs(10, 1_000, 30_000, () => 0)).toBe(30_000);
  });

  test("jitter is bounded", () => {
    const ms = kalshiWsReconnectBackoffMs(2, 1_000, 30_000, () => 0.999);
    expect(ms).toBeGreaterThanOrEqual(4_000);
    expect(ms).toBeLessThanOrEqual(4_250);
  });
});

describe("kalshi-ws granular tls control values", () => {
  test("returns undefined when no KALSHI_WS_TLS_* env is set", () => {
    expect(resolveKalshiWsTls({})).toBeUndefined();
  });

  test("maps falsy REJECT_UNAUTHORIZED spellings to rejectUnauthorized=false", () => {
    for (const v of ["0", "false", "no", " FALSE "]) {
      expect(resolveKalshiWsTls({ KALSHI_WS_TLS_REJECT_UNAUTHORIZED: v })).toEqual({
        rejectUnauthorized: false,
      });
    }
  });

  test("ignores truthy REJECT_UNAUTHORIZED values", () => {
    expect(resolveKalshiWsTls({ KALSHI_WS_TLS_REJECT_UNAUTHORIZED: "1" })).toBeUndefined();
  });

  test("maps *_FILE envs to Bun.file-backed ca/cert/key and passes scalars through", () => {
    const tls = resolveKalshiWsTls({
      KALSHI_WS_TLS_CA_FILE: "/pki/corp-ca.pem",
      KALSHI_WS_TLS_CERT_FILE: "/pki/client.pem",
      KALSHI_WS_TLS_KEY_FILE: "/pki/client-key.pem",
      KALSHI_WS_TLS_PASSPHRASE: "s3cret",
      KALSHI_WS_TLS_SERVER_NAME: "trading-api.kalshi.com",
      KALSHI_WS_TLS_CIPHERS: "TLS_AES_256_GCM_SHA384",
    });
    expect(tls?.passphrase).toBe("s3cret");
    expect(tls?.serverName).toBe("trading-api.kalshi.com");
    expect(tls?.ciphers).toBe("TLS_AES_256_GCM_SHA384");
    for (const f of [tls?.ca, tls?.cert, tls?.key]) {
      expect(f).toBeDefined();
      expect(typeof (f as Bun.BunFile).text).toBe("function");
    }
    expect((tls?.ca as Bun.BunFile).name).toBe("/pki/corp-ca.pem");
  });

  test("resolveKalshiWsNetOptions composes proxy + tls", () => {
    expect(
      resolveKalshiWsNetOptions({
        KALSHI_WS_PROXY: "http://corp:8080",
        KALSHI_WS_TLS_REJECT_UNAUTHORIZED: "false",
      }),
    ).toEqual({ proxy: "http://corp:8080", tls: { rejectUnauthorized: false } });
    expect(resolveKalshiWsNetOptions({})).toEqual({});
  });
});
