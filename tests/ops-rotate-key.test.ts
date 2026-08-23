// @see https://bun.com/docs/test/index#run-tests
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rotateKalshiKey, kalshiRotatePaths } from "../src/bot/kalshi-rotate.ts";
import {
  createResearchServer,
  probeKalshiAuthCached,
  resetKalshiAuthCache,
} from "../src/research/serve.ts";
import { CSRF_SESSION_COOKIE, issueCsrfSession } from "../src/research/csrf.ts";

let pemA: string;
let pemB: string;
let home: string;

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "KALSHI_API_KEY_ID",
  "KALSHI_ACCESS_KEY",
  "KALSHI_PRIVATE_KEY",
  "KALSHI_PRIVATE_KEY_PATH",
  "KALSHI_API_BASE",
  "KALSHI_ROTATE_HOME",
] as const;

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  pemA = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  pemB = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  home = await mkdtemp(join(tmpdir(), "kalshi-rotate-test-"));
});

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await rm(home, { recursive: true, force: true });
});

beforeEach(() => {
  resetKalshiAuthCache();
});

/** Stub Kalshi REST — fixed status, counts hits. */
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

describe("rotateKalshiKey module", () => {
  test("dry-run writes nothing but still probes", async () => {
    const stub = stubKalshi(200);
    try {
      const r = await rotateKalshiKey({ keyId: "dry-run-key", pemText: pemA, dryRun: true, home, probeBase: stub.base });
      expect(r.ok).toBe(true);
      expect(r.probe.state).toBe("valid");
      expect(r.probe.status).toBe(200);
      expect(r.written).toEqual([]);
      expect(r.planned.length).toBe(2);
      expect(await Bun.file(r.planned[0]!).exists()).toBe(false);
      expect(stub.hits.n).toBe(1);
    } finally {
      stub.stop();
    }
  });

  test("real run writes pem + shell file at 0600 and updates env", async () => {
    const stub = stubKalshi(200);
    try {
      const r = await rotateKalshiKey({ keyId: "real-key-123456", pemText: pemA, home, probeBase: stub.base });
      expect(r.ok).toBe(true);
      expect(r.written.length).toBe(2);
      const { pemDest, shellFile } = kalshiRotatePaths(home);
      expect(statSync(pemDest).mode & 0o777).toBe(0o600);
      expect(statSync(shellFile).mode & 0o777).toBe(0o600);
      expect(await Bun.file(pemDest).text()).toBe(pemA);
      expect(await Bun.file(shellFile).text()).toContain("export KALSHI_API_KEY_ID=real-key-123456");
      expect(process.env.KALSHI_API_KEY_ID).toBe("real-key-123456");
      expect(process.env.KALSHI_PRIVATE_KEY_PATH).toBe(pemDest);
    } finally {
      stub.stop();
    }
  });

  test("401 probe maps to invalid", async () => {
    const stub = stubKalshi(401);
    try {
      const r = await rotateKalshiKey({ keyId: "bad-key", pemText: pemB, dryRun: true, home, probeBase: stub.base });
      expect(r.ok).toBe(false);
      expect(r.probe.state).toBe("invalid");
      expect(r.probe.status).toBe(401);
    } finally {
      stub.stop();
    }
  });

  test("pem without PRIVATE KEY marker is rejected before any write/probe", async () => {
    const r = await rotateKalshiKey({ keyId: "k", pemText: "not a pem", home });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("PRIVATE KEY");
    expect(r.written).toEqual([]);
  });
});

describe("POST /ops/kalshi-rotate-key", () => {
  let server: ReturnType<typeof createResearchServer>;
  let base: string;
  let stub: ReturnType<typeof stubKalshi>;

  beforeAll(() => {
    server = createResearchServer({ port: 0 });
    base = `http://127.0.0.1:${server.port}`;
    stub = stubKalshi(200);
    process.env.KALSHI_ROTATE_HOME = home;
    process.env.KALSHI_API_BASE = stub.base;
  });

  afterAll(() => {
    server.stop(true);
    stub.stop();
  });

  const session = issueCsrfSession();
  const post = (body: Record<string, unknown>) =>
    fetch(`${base}/ops/kalshi-rotate-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": session.token, "cookie": CSRF_SESSION_COOKIE + "=" + session.sessionId },
      body: JSON.stringify(body),
    });

  test("apply without confirm → 400", async () => {
    const res = await post({ keyId: "k", pem: pemA });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("confirm");
  });

  test("missing fields → 400", async () => {
    const res = await post({ dryRun: true });
    expect(res.status).toBe(400);
  });

  test("dryRun previews without confirm and writes nothing", async () => {
    const res = await post({ keyId: "preview-key-9", pem: pemA, dryRun: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.probe.state).toBe("valid");
    expect(body.written).toEqual([]);
    expect(body.planned.length).toBe(2);
    expect(body.keyId).toBe("preview-…");
    expect(JSON.stringify(body)).not.toContain(pemA.slice(30, 60));
  });

  test("full apply writes files and resets the badge cache", async () => {
    // Prime the badge cache with a stale value so the reset is observable.
    delete process.env.KALSHI_API_KEY_ID;
    delete process.env.KALSHI_PRIVATE_KEY_PATH;
    const primed = await probeKalshiAuthCached();
    expect(primed.state).toBe("no-creds");

    const res = await post({ keyId: "applied-key-77", pem: pemB, confirm: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.probe.state).toBe("valid");
    expect(body.written.length).toBe(2);

    const { pemDest, shellFile } = kalshiRotatePaths(home);
    expect(await Bun.file(pemDest).exists()).toBe(true);
    expect(statSync(pemDest).mode & 0o777).toBe(0o600);
    expect(await Bun.file(shellFile).text()).toContain("applied-key-77");

    // Cache was reset + env updated: next probe re-fetches with the new key.
    const fresh = await probeKalshiAuthCached();
    expect(fresh.state).toBe("valid");
    expect(fresh.checkedAt).not.toBe(primed.checkedAt);
  });

  test("GET is not handled (POST only)", async () => {
    const res = await fetch(`${base}/ops/kalshi-rotate-key`);
    expect(res.status).toBe(404);
  });
});
