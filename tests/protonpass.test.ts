// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretCacheManager } from "../src/protonpass/cache.ts";
import { CircuitBreaker, CircuitOpenError } from "../src/protonpass/circuit.ts";
import { withRetry, RetryExhaustedError } from "../src/protonpass/retry.ts";
import { spawnWithTimeout, withTimeout, TimeoutError } from "../src/protonpass/timeout.ts";
import { runStartupGate, type GateCheck } from "../src/protonpass/gate.ts";
import { SecretTelemetry } from "../src/protonpass/telemetry.ts";
import { writePemTemp, writeSecureTemp, withTempFile } from "../src/protonpass/ssh-temp.ts";
import { loadKalshiBotToken } from "../src/protonpass/agent-session.ts";

function tmpCachePath(): string {
  return join(tmpdir(), `protonpass-test-${crypto.randomUUID()}.json`);
}

describe("protonpass cache", () => {
  test("set/get round-trips a value", async () => {
    const cache = new SecretCacheManager({ path: tmpCachePath() });
    await cache.set("k", "v");
    expect(await cache.get("k")).toBe("v");
    await cache.clear();
    expect(await cache.get("k")).toBeNull();
  });

  test("expired entries are dropped on get", async () => {
    const cache = new SecretCacheManager({ path: tmpCachePath(), defaultTtlMs: 5 });
    await cache.set("k", "v");
    await Bun.sleep(10);
    expect(await cache.get("k")).toBeNull();
  });

  test("purgeExpired removes only expired entries", async () => {
    const cache = new SecretCacheManager({ path: tmpCachePath() });
    await cache.set("fresh", "v", 60_000);
    await cache.set("stale", "v", 1);
    await Bun.sleep(5);
    const { purged, remaining } = await cache.purgeExpired();
    expect(purged).toBe(1);
    expect(remaining).toBe(1);
    expect(await cache.get("fresh")).toBe("v");
  });

  test("delete removes a key", async () => {
    const cache = new SecretCacheManager({ path: tmpCachePath() });
    await cache.set("k", "v");
    await cache.delete("k");
    expect(await cache.get("k")).toBeNull();
  });
});

describe("protonpass circuit breaker", () => {
  const failing = () => Promise.reject(new Error("boom"));

  test("opens after failureThreshold failures", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, recoveryTimeoutMs: 10_000 });
    for (let i = 0; i < 2; i++) {
      await expect(cb.execute(failing)).rejects.toThrow("boom");
    }
    expect(cb.currentState).toBe("open");
    await expect(cb.execute(() => Promise.resolve(1))).rejects.toBeInstanceOf(CircuitOpenError);
  });

  test("half-open after recovery timeout, closes on success", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, recoveryTimeoutMs: 10 });
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    expect(cb.currentState).toBe("open");
    await Bun.sleep(20);
    expect(cb.currentState).toBe("half-open");
    await expect(cb.execute(() => Promise.resolve("ok"))).resolves.toBe("ok");
    expect(cb.currentState).toBe("closed");
    expect(cb.stats.failures).toBe(0);
  });

  test("re-opens when a half-open probe fails", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, recoveryTimeoutMs: 10 });
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    await Bun.sleep(20);
    expect(cb.currentState).toBe("half-open");
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    expect(cb.currentState).toBe("open");
  });

  test("limits concurrent half-open probes", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, recoveryTimeoutMs: 10, halfOpenMaxCalls: 1 });
    await expect(cb.execute(failing)).rejects.toThrow("boom");
    await Bun.sleep(20);
    // Occupy the single half-open slot with a pending promise
    let release!: () => void;
    const pending = cb.execute(() => new Promise<void>((r) => { release = r as () => void; }));
    await expect(cb.execute(() => Promise.resolve(1))).rejects.toBeInstanceOf(CircuitOpenError);
    release();
    await pending;
  });
});

describe("protonpass retry", () => {
  test("returns on first success without retrying", async () => {
    let calls = 0;
    const out = await withRetry(() => { calls++; return Promise.resolve(42); });
    expect(out).toBe(42);
    expect(calls).toBe(1);
  });

  test("exhausts attempts and throws RetryExhaustedError", async () => {
    let calls = 0;
    await expect(
      withRetry(() => { calls++; return Promise.reject(new Error("nope")); }, { maxAttempts: 3, baseMs: 1, jitter: false }),
    ).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(calls).toBe(3);
  });

  test("backs off exponentially without jitter", async () => {
    const delays: number[] = [];
    await withRetry(
      () => Promise.reject(new Error("x")),
      { maxAttempts: 3, baseMs: 1, maxMs: 1_000, jitter: false, onRetry: (_e, _a, d) => { delays.push(d); } },
    ).catch(() => {});
    expect(delays).toEqual([1, 2]);
  });

  test("succeeds on a later attempt", async () => {
    let calls = 0;
    const out = await withRetry(
      () => (calls++ < 2 ? Promise.reject(new Error("flaky")) : Promise.resolve("done")),
      { maxAttempts: 3, baseMs: 1, jitter: false },
    );
    expect(out).toBe("done");
    expect(calls).toBe(3);
  });
});

describe("protonpass timeout", () => {
  test("spawnWithTimeout captures stdout and exit code", async () => {
    const r = await spawnWithTimeout("echo", ["hello"], { timeoutMs: 5_000 });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("hello");
    expect(r.timedOut).toBe(false);
  });

  test("spawnWithTimeout kills a hung command", async () => {
    const r = await spawnWithTimeout("sleep", ["30"], { timeoutMs: 50 });
    expect(r.timedOut).toBe(true);
    expect(r.killed).toBe(true);
    expect(r.code).toBeNull();
  });

  test("withTimeout rejects with TimeoutError", async () => {
    const slow = new Promise(() => {});
    await expect(withTimeout(slow, 20)).rejects.toBeInstanceOf(TimeoutError);
    await expect(withTimeout(slow, 20)).rejects.toMatchObject({ timeoutMs: 20 });
  });

  test("withTimeout passes through fast promises", async () => {
    await expect(withTimeout(Promise.resolve("fast"), 1_000)).resolves.toBe("fast");
  });
});

describe("protonpass gate", () => {
  const check = (name: string, ok: boolean, required: boolean): GateCheck => ({
    name,
    test: () => ok,
    required,
    hint: `${name} hint`,
  });

  test("passes when all required checks pass", async () => {
    const result = await runStartupGate([check("a", true, true), check("b", true, false)]);
    expect(result.passed).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test("failed optional check is a skip, not a blocker", async () => {
    const result = await runStartupGate([check("a", true, true), check("b", false, false)]);
    expect(result.passed).toBe(true);
    expect(result.checks.find((c) => c.name === "b")?.status).toBe("skip");
  });

  test("failed required check blocks with hint", async () => {
    const result = await runStartupGate([check("a", false, true)]);
    expect(result.passed).toBe(false);
    expect(result.blockers).toEqual(["a: a hint"]);
    expect(result.checks[0]?.status).toBe("fail");
  });

  test("throwing check counts as failure", async () => {
    const result = await runStartupGate([{
      name: "throws",
      test: () => { throw new Error("kaboom"); },
      required: true,
      hint: "h",
    }]);
    expect(result.passed).toBe(false);
    expect(result.blockers).toEqual(["throws: kaboom"]);
  });
});

describe("protonpass telemetry", () => {
  test("summary aggregates counts and durations", () => {
    const t = new SecretTelemetry();
    t.record({ uri: "pass://v/a", durationMs: 10, status: "ok", fromCache: false });
    t.record({ uri: "pass://v/b", durationMs: 90, status: "error", error: "x", fromCache: false });
    t.record({ uri: "pass://v/a", durationMs: 1, status: "cached", fromCache: true });
    const s = t.summary();
    expect(s.totalEvents).toBe(3);
    expect(s.okCount).toBe(1);
    expect(s.errorCount).toBe(1);
    expect(s.cacheHitCount).toBe(1);
    expect(s.slowestUri).toBe("pass://v/b");
    expect(s.slowestMs).toBe(90);
    expect(s.avgDurationMs).toBe(34);
  });

  test("empty summary is zeroed", () => {
    const s = new SecretTelemetry().summary();
    expect(s.totalEvents).toBe(0);
    expect(s.slowestUri).toBeNull();
  });
});

describe("protonpass ssh-temp", () => {
  test("writePemTemp normalizes escaped newlines and sets 0600", async () => {
    const pem = "-----BEGIN TEST-----\\nabc\\n-----END TEST-----";
    const temp = await writePemTemp(pem);
    const content = await Bun.file(temp.path).text();
    expect(content).toBe("-----BEGIN TEST-----\nabc\n-----END TEST-----\n");
    expect(statSync(temp.path).mode & 0o777).toBe(0o600);
    await temp.cleanup();
    expect(await Bun.file(temp.path).exists()).toBe(false);
  });

  test("writePemTemp rejects non-PEM content", async () => {
    await expect(writePemTemp("not a key")).rejects.toThrow("BEGIN");
  });

  test("writeSecureTemp honors prefix/suffix", async () => {
    const temp = await writeSecureTemp("data", { prefix: "pp-test-", suffix: ".txt" });
    expect(temp.path).toContain("pp-test-");
    expect(temp.path.endsWith(".txt")).toBe(true);
    await temp.cleanup();
  });

  test("withTempFile cleans up even when fn throws", async () => {
    let seenPath = "";
    await expect(
      withTempFile("x", async (p) => { seenPath = p; throw new Error("inner"); }),
    ).rejects.toThrow("inner");
    expect(seenPath).not.toBe("");
    expect(await Bun.file(seenPath).exists()).toBe(false);
  });
});

describe("protonpass agent-session", () => {
  test("loadKalshiBotToken accepts pst_ token from env", async () => {
    const prev = process.env.PROTON_PASS_KALSHI_BOT_TOKEN;
    process.env.PROTON_PASS_KALSHI_BOT_TOKEN = "pst_unit_test_token";
    try {
      expect(await loadKalshiBotToken()).toBe("pst_unit_test_token");
    } finally {
      if (prev === undefined) delete process.env.PROTON_PASS_KALSHI_BOT_TOKEN;
      else process.env.PROTON_PASS_KALSHI_BOT_TOKEN = prev;
    }
  });
});
