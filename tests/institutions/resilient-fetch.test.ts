import { describe, expect, test } from "bun:test";
import {
  computeBackoffMs,
  createCircuitBreaker,
  fetchWithRetry,
  streamNdjsonLines,
  type CircuitBreaker,
  type FetchFn,
} from "../../src/institutions/resilient-fetch.ts";

describe("computeBackoffMs", () => {
  test("increases exponentially", () => {
    const random = () => 0;
    expect(computeBackoffMs(0, 500, 10_000, 0, random)).toBe(500);
    expect(computeBackoffMs(1, 500, 10_000, 0, random)).toBe(1000);
    expect(computeBackoffMs(2, 500, 10_000, 0, random)).toBe(2000);
    expect(computeBackoffMs(3, 500, 10_000, 0, random)).toBe(4000);
    expect(computeBackoffMs(4, 500, 10_000, 0, random)).toBe(8000);
    expect(computeBackoffMs(5, 500, 10_000, 0, random)).toBe(10_000); // capped
  });

  test("applies jitter", () => {
    const random = () => 0.5;
    const base = computeBackoffMs(0, 500, 10_000, 0.25, random);
    // 500 + 500 * 0.25 * 0.5 = 500 + 62.5 => floor => 562
    expect(base).toBe(562);
  });
});

describe("createCircuitBreaker", () => {
  test("starts closed", () => {
    const cb = createCircuitBreaker();
    expect(cb.state).toBe("closed");
    expect(cb.failures).toBe(0);
    expect(cb.lastFailureAt).toBeNull();
    cb.guard(); // should not throw
  });

  test("opens after threshold failures", () => {
    const cb = createCircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe("closed");
    cb.recordFailure();
    expect(cb.state).toBe("open");
    expect(() => cb.guard()).toThrow(/OPEN/);
  });

  test("transitions to half-open after resetMs", () => {
    const cb = createCircuitBreaker({ failureThreshold: 1, resetMs: 50 });
    cb.recordFailure();
    expect(cb.state).toBe("open");

    // Still open immediately
    expect(() => cb.guard()).toThrow(/OPEN/);

    // After resetMs passes, accessing state triggers half-open
    const start = Date.now();
    while (Date.now() - start < 60) {
      /* spin */
    }
    expect(cb.state).toBe("half-open");
    cb.guard(); // should not throw now
  });

  test("closes after half-open successes", () => {
    const cb = createCircuitBreaker({ failureThreshold: 1, resetMs: 10, halfOpenSuccesses: 2 });
    cb.recordFailure();
    expect(cb.state).toBe("open");

    // Wait for resetMs to pass, then trigger half-open via state access
    const start = Date.now();
    while (Date.now() - start < 15) { /* spin */ }
    expect(cb.state).toBe("half-open");
    cb.recordSuccess();
    expect(cb.state).toBe("half-open");
    cb.recordSuccess();
    expect(cb.state).toBe("closed");
    expect(cb.failures).toBe(0);
  });

  test("re-opens on half-open failure", () => {
    const cb = createCircuitBreaker({ failureThreshold: 1, resetMs: 10 });
    cb.recordFailure();
    expect(cb.state).toBe("open");

    // Wait for resetMs to pass
    const start = Date.now();
    while (Date.now() - start < 15) { /* spin */ }

    expect(cb.state).toBe("half-open");
    cb.recordFailure();
    expect(cb.state).toBe("open");
  });
});

describe("fetchWithRetry", () => {
  function mockFetch(responses: Response[]): FetchFn {
    let i = 0;
    return (() => {
      const res = responses[i++];
      if (!res) return Promise.resolve(new Response("exhausted", { status: 500 }));
      return Promise.resolve(res);
    }) as FetchFn;
  }

  test("returns ok response immediately", async () => {
    const res = new Response('{"ok":true}', { status: 200 });
    const fetchImpl = mockFetch([res]);
    const out = await fetchWithRetry("https://example.com", {}, { retries: 0, fetchImpl });
    expect(out.status).toBe(200);
  });

  test("retries on 429 and succeeds", async () => {
    const responses = [
      new Response("too fast", { status: 429 }),
      new Response("ok", { status: 200 }),
    ];
    const fetchImpl = mockFetch(responses);
    const out = await fetchWithRetry(
      "https://example.com",
      {},
      { retries: 2, backoffMs: 1, jitter: 0, fetchImpl },
    );
    expect(out.status).toBe(200);
  });

  test("retries on 500 and returns final non-ok", async () => {
    const responses = [
      new Response("err", { status: 500 }),
      new Response("err", { status: 500 }),
      new Response("still bad", { status: 502 }),
    ];
    const fetchImpl = mockFetch(responses);
    const out = await fetchWithRetry(
      "https://example.com",
      {},
      { retries: 2, backoffMs: 1, jitter: 0, fetchImpl },
    );
    expect(out.status).toBe(502);
  });

  test("throws on non-retryable 4xx", async () => {
    const responses = [new Response("nope", { status: 400 })];
    const fetchImpl = mockFetch(responses);
    const out = await fetchWithRetry(
      "https://example.com",
      {},
      { retries: 2, backoffMs: 1, jitter: 0, fetchImpl },
    );
    // Non-retryable errors return the response directly
    expect(out.status).toBe(400);
  });

  test("throws after exhausting retries on network errors", async () => {
    const fetchImpl = () => Promise.reject(new Error("net down"));
    await expect(
      fetchWithRetry("https://example.com", {}, { retries: 1, backoffMs: 1, jitter: 0, fetchImpl }),
    ).rejects.toThrow(/net down/);
  });

  test("circuit breaker opens after threshold", async () => {
    const cb = createCircuitBreaker({ failureThreshold: 2 });
    const fetchImpl = () => Promise.reject(new Error("fail"));

    await expect(
      fetchWithRetry("https://example.com", {}, { retries: 0, backoffMs: 1, fetchImpl, breaker: cb }),
    ).rejects.toThrow(/fail/);
    expect(cb.state).toBe("closed"); // 1 failure, still closed

    await expect(
      fetchWithRetry("https://example.com", {}, { retries: 0, backoffMs: 1, fetchImpl, breaker: cb }),
    ).rejects.toThrow(/fail/);
    expect(cb.state).toBe("open"); // 2 failures, now open

    await expect(
      fetchWithRetry("https://example.com", {}, { retries: 0, backoffMs: 1, fetchImpl, breaker: cb }),
    ).rejects.toThrow(/OPEN/);
  });

  test("circuit breaker records success on ok response", async () => {
    const cb = createCircuitBreaker({ failureThreshold: 2 });
    let calls = 0;
    const fetchImpl = () => {
      calls++;
      return Promise.resolve(new Response("ok", { status: 200 }));
    };

    const out = await fetchWithRetry(
      "https://example.com",
      {},
      { retries: 0, fetchImpl, breaker: cb },
    );
    expect(out.status).toBe(200);
    expect(cb.failures).toBe(0);
    expect(calls).toBe(1);
  });
  test("retries on timeout and succeeds", async () => {
    let calls = 0;
    const fetchImpl = (_input: unknown, init?: RequestInit) => {
      calls++;
      if (calls === 1 && init?.signal) {
        const err = new Error("The operation timed out.");
        err.name = "TimeoutError";
        return Promise.reject(err);
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    };

    const out = await fetchWithRetry(
      "https://example.com",
      {},
      { retries: 1, backoffMs: 1, jitter: 0, timeoutMs: 5_000, fetchImpl },
    );
    expect(out.status).toBe(200);
    expect(calls).toBe(2);
  });

  test("throws after exhausting retries on timeout", async () => {
    const err = new Error("The operation timed out.");
    err.name = "AbortError";
    const fetchImpl = () => Promise.reject(err);

    await expect(
      fetchWithRetry("https://example.com", {}, { retries: 1, backoffMs: 1, jitter: 0, timeoutMs: 100, fetchImpl }),
    ).rejects.toThrow(/timed out/);
  });
});

describe("compress + streamNdjsonLines (folded-in Bun 1.4 patterns)", () => {
  test("fetchWithRetry forwards compress to the fetch impl", async () => {
    const seen: unknown[] = [];
    const fetchImpl: FetchFn = async (input, init) => {
      seen.push((init as { compress?: unknown }).compress);
      return new Response("ok");
    };
    const res = await fetchWithRetry("https://x.test/", { method: "POST", body: "{}" }, { retries: 0, compress: "gzip", fetchImpl });
    expect(await res.text()).toBe("ok");
    expect(seen[0]).toBe("gzip");
  });

  test("streamNdjsonLines parses NDJSON as it streams", async () => {
    const res = new Response(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("{\"a\":1}\n{\"b\":2}\n"));
        c.close();
      },
    }));
    const out: Array<Record<string, number>> = [];
    for await (const obj of streamNdjsonLines<Record<string, number>>(res)) out.push(obj);
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("streamNdjsonLines handles a final line without trailing newline", async () => {
    const res = new Response(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("{\"x\":9}"));
        c.close();
      },
    }));
    const out: unknown[] = [];
    for await (const obj of streamNdjsonLines(res)) out.push(obj);
    expect(out).toEqual([{ x: 9 }]);
  });
});

describe("compress + streamNdjsonLines (folded-in Bun 1.4 patterns)", () => {
  test("fetchWithRetry forwards compress to the fetch impl", async () => {
    const seen: unknown[] = [];
    const fetchImpl: FetchFn = async (input, init) => {
      seen.push((init as { compress?: unknown }).compress);
      return new Response("ok");
    };
    const res = await fetchWithRetry("https://x.test/", { method: "POST", body: "{}" }, { retries: 0, compress: "gzip", fetchImpl });
    expect(await res.text()).toBe("ok");
    expect(seen[0]).toBe("gzip");
  });

  test("streamNdjsonLines parses NDJSON as it streams", async () => {
    const res = new Response(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("{\"a\":1}\n{\"b\":2}\n"));
        c.close();
      },
    }));
    const out: Array<Record<string, number>> = [];
    for await (const obj of streamNdjsonLines<Record<string, number>>(res)) out.push(obj);
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("streamNdjsonLines handles a final line without trailing newline", async () => {
    const res = new Response(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("{\"x\":9}"));
        c.close();
      },
    }));
    const out: unknown[] = [];
    for await (const obj of streamNdjsonLines(res)) out.push(obj);
    expect(out).toEqual([{ x: 9 }]);
  });
});
