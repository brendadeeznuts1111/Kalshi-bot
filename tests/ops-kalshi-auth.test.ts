// @see https://bun.com/docs/test/index#run-tests
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
  probeKalshiAuthCached,
  resetKalshiAuthCache,
} from "../src/research/serve.ts";
import { renderOps } from "../src/research/views.ts";

const ENV_KEYS = [
  "KALSHI_API_KEY_ID",
  "KALSHI_ACCESS_KEY",
  "KALSHI_PRIVATE_KEY",
  "KALSHI_PRIVATE_KEY_PATH",
  "KALSHI_API_BASE",
  "KALSHI_ENV",
] as const;

const savedEnv: Record<string, string | undefined> = {};
let testPem: string;

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  testPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(() => {
  resetKalshiAuthCache();
});

function withCreds(): void {
  process.env.KALSHI_API_KEY_ID = "ops-test-key";
  process.env.KALSHI_PRIVATE_KEY = testPem;
  delete process.env.KALSHI_PRIVATE_KEY_PATH;
  delete process.env.KALSHI_API_BASE;
}

function withoutCreds(): void {
  for (const k of ["KALSHI_API_KEY_ID", "KALSHI_ACCESS_KEY", "KALSHI_PRIVATE_KEY", "KALSHI_PRIVATE_KEY_PATH"] as const) {
    delete process.env[k];
  }
}

/** Stub Kalshi REST — returns a fixed status for /portfolio/balance, counts hits. */
function stubKalshi(status: number) {
  const hits = { n: 0 };
  const server = Bun.serve({
    port: 0,
    fetch() {
      hits.n++;
      return new Response("{}", { status, headers: { "Content-Type": "application/json" } });
    },
  });
  return { hits, base: `http://127.0.0.1:${server.port}/trade-api/v2`, stop: () => server.stop(true) };
}

describe("probeKalshiAuthCached", () => {
  test("200 → valid", async () => {
    withCreds();
    const stub = stubKalshi(200);
    try {
      const r = await probeKalshiAuthCached({ base: stub.base });
      expect(r.state).toBe("valid");
      expect(r.status).toBe(200);
      expect(r.cacheTtlSec).toBe(300);
      expect(r.checkedAt).toBeDefined();
    } finally {
      stub.stop();
    }
  });

  test("401 → invalid", async () => {
    withCreds();
    const stub = stubKalshi(401);
    try {
      const r = await probeKalshiAuthCached({ base: stub.base });
      expect(r.state).toBe("invalid");
      expect(r.status).toBe(401);
    } finally {
      stub.stop();
    }
  });

  test("network failure → unreachable", async () => {
    withCreds();
    const r = await probeKalshiAuthCached({ base: "http://127.0.0.1:1/trade-api/v2", timeoutMs: 500 });
    expect(r.state).toBe("unreachable");
  });

  test("missing credentials → no-creds (no fetch)", async () => {
    withoutCreds();
    const r = await probeKalshiAuthCached();
    expect(r.state).toBe("no-creds");
    expect(r.status).toBeUndefined();
  });

  test("second call within TTL is served from cache (no re-fetch)", async () => {
    withCreds();
    const stub = stubKalshi(200);
    try {
      const first = await probeKalshiAuthCached({ base: stub.base });
      const second = await probeKalshiAuthCached({ base: stub.base });
      expect(stub.hits.n).toBe(1);
      expect(second).toEqual(first);
    } finally {
      stub.stop();
    }
  });
});

describe("kalshi auth badge render", () => {
  const base = {
    generatedAt: new Date().toISOString(),
    agents: { orchestrator: true },
    ticks: [],
    lineMoves: [],
    canary: null,
    store: null,
    flows: [],
    runs: [],
  };

  test("renders state badge in the Data panel with cache tooltip", () => {
    const html = renderOps({
      ...base,
      kalshiAuth: { state: "invalid", status: 401, checkedAt: "2026-07-28T21:00:00.000Z", cacheTtlSec: 300 },
    });
    expect(html).toContain("Kalshi auth:");
    expect(html).toContain('<span class="badge bad"');
    expect(html).toContain("invalid (rotate key)");
    expect(html).toContain("checked 2026-07-28T21:00:00.000Z · cache 300s · HTTP 401");
  });

  test("no-creds renders dim badge", () => {
    const html = renderOps({
      ...base,
      kalshiAuth: { state: "no-creds", checkedAt: "2026-07-28T21:00:00.000Z", cacheTtlSec: 300 },
    });
    expect(html).toContain('<span class="badge dim"');
    expect(html).toContain("no creds");
  });
});
