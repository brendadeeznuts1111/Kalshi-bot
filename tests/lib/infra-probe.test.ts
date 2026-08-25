// Infrastructure machinery tests (§76) — rate limiter token bucket +
// memoryPressure event lifecycle.
import { describe, expect, test } from "bun:test";
import { createRateLimiter } from "../../src/regulatory/middleware/rate-limit.ts";

const ok = async () => new Response("ok");

describe("rate limiter token bucket (§76)", () => {
  test("burst of max succeeds then 429", async () => {
    const l = createRateLimiter({ windowMs: 1000, max: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await l(new Request("http://x"), ok)).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });

  test("X-RateLimit headers present on every response", async () => {
    const l = createRateLimiter({ windowMs: 1000, max: 3 });
    const res = await l(new Request("http://x"), ok);
    expect(res.headers.get("x-ratelimit-limit")).toBe("3");
    expect(res.headers.get("x-ratelimit-remaining")).not.toBeNull();
  });

  test("full window fully refills; partial refills proportionally", async () => {
    const l = createRateLimiter({ windowMs: 1000, max: 10 });
    for (let i = 0; i < 10; i++) await l(new Request("http://y"), ok);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await l(new Request("http://y"), ok)).status).toBe(200); // full refill
    // partial: exhaust again, wait half window, expect ~5 tokens back
    for (let i = 0; i < 10; i++) await l(new Request("http://y"), ok);
    await new Promise((r) => setTimeout(r, 500));
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await l(new Request("http://y"), ok)).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });

  test("per-key isolation: different IPs get separate buckets", async () => {
    const l = createRateLimiter({ windowMs: 1000, max: 1 });
    const a = (await l(new Request("http://x", { headers: { "x-forwarded-for": "1.1.1.1" } }), ok)).status;
    const b = (await l(new Request("http://x", { headers: { "x-forwarded-for": "1.1.1.1" } }), ok)).status;
    const c = (await l(new Request("http://x", { headers: { "x-forwarded-for": "2.2.2.2" } }), ok)).status;
    expect([a, b, c]).toEqual([200, 429, 200]);
  });

  test("skipSuccessful does NOT bypass an exhausted bucket (semantics doc §76)", async () => {
    const l = createRateLimiter({ windowMs: 10000, max: 2, skipSuccessful: true });
    const fail = async () => new Response("err", { status: 500 });
    await l(new Request("http://z"), fail);
    await l(new Request("http://z"), fail);
    const s = (await l(new Request("http://z"), ok)).status;
    expect(s).toBe(429); // consume() blocks before next(); refund never runs
  });
});

describe("memoryPressure event (§76)", () => {
  test("eventNames lifecycle: absent -> present after on() -> absent after removeListener", () => {
    expect(process.eventNames().includes("memoryPressure" as never)).toBe(false);
    const handler = () => {};
    process.on("memoryPressure" as never, handler);
    expect(process.eventNames().includes("memoryPressure" as never)).toBe(true);
    process.removeListener("memoryPressure" as never, handler);
    expect(process.eventNames().includes("memoryPressure" as never)).toBe(false);
  });
});