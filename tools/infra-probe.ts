#!/usr/bin/env bun
/**
 * `bun run infra:probe` — probe the infrastructure machinery (§76):
 * rate limiter token-bucket + memoryPressure event surface.
 *
 * VERIFIED on Bun 1.4.0:
 *   - rate limiter: burst of max succeeds then 429; X-RateLimit-* headers
 *     present; a full window fully refills; a partial window refills
 *     proportionally (500ms of 1000ms window, max 10 -> 5 tokens back);
 *     per-key isolation (different X-Forwarded-For = separate buckets).
 *   - process.on('memoryPressure'): event appears in eventNames() only
 *     after a listener is registered; removeListener removes it (the
 *     hot-reload guard pattern in serve.ts works).
 *
 * CORRECTED (semantics mismatch):
 *   - skipSuccessful: true does NOT let successful requests bypass the
 *     limit once failures exhausted the bucket — consume() blocks (429)
 *     BEFORE next() runs, so the refund never happens for blocked
 *     requests. The option only keeps successes from DEPLETING the
 *     bucket (refund on success). Documented, not a code change (the
 *     failure-isolating behavior is arguably intended).
 *
 * @see docs/AGENT-PITFALLS.md §76
 */
import { createRateLimiter } from "../src/regulatory/middleware/rate-limit.ts";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// R1: burst + 429
const limiter = createRateLimiter({ windowMs: 1000, max: 3 });
const ok = async () => new Response("ok");
const codes: number[] = [];
for (let i = 0; i < 5; i++) codes.push((await limiter(new Request("http://x"), ok)).status);
check("R1 burst max then 429", codes.join(",") === "200,200,200,429,429", codes.join(","));

// R2: headers
const h = await limiter(new Request("http://x"), ok);
check("R2 X-RateLimit headers", h.headers.get("x-ratelimit-limit") === "3" && h.headers.get("x-ratelimit-remaining") !== null, "limit=" + h.headers.get("x-ratelimit-limit") + " remaining=" + h.headers.get("x-ratelimit-remaining"));

// R3: full window refills
await new Promise((r) => setTimeout(r, 1100));
check("R3 full window refills", (await limiter(new Request("http://x"), ok)).status === 200, "ok");

// R4: partial refill proportional
const l2 = createRateLimiter({ windowMs: 1000, max: 10 });
for (let i = 0; i < 10; i++) await l2(new Request("http://y"), ok);
await new Promise((r) => setTimeout(r, 500));
const dCodes: number[] = [];
for (let i = 0; i < 6; i++) dCodes.push((await l2(new Request("http://y"), ok)).status);
check("R4 partial refill ~half window (5 tokens back)", dCodes.join(",") === "200,200,200,200,200,429", dCodes.join(","));

// R5: per-key isolation
const l3 = createRateLimiter({ windowMs: 1000, max: 1 });
const a = (await l3(new Request("http://x", { headers: { "x-forwarded-for": "1.1.1.1" } }), ok)).status;
const b = (await l3(new Request("http://x", { headers: { "x-forwarded-for": "1.1.1.1" } }), ok)).status;
const c = (await l3(new Request("http://x", { headers: { "x-forwarded-for": "2.2.2.2" } }), ok)).status;
check("R5 per-key isolation", a === 200 && b === 429 && c === 200, a + "," + b + "," + c);

// R6: skipSuccessful semantics (documented correction)
const l4 = createRateLimiter({ windowMs: 10000, max: 2, skipSuccessful: true });
const fail = async () => new Response("err", { status: 500 });
await l4(new Request("http://z"), fail);
await l4(new Request("http://z"), fail);
const s = (await l4(new Request("http://z"), ok)).status;
check("R6 skipSuccessful does NOT bypass exhausted bucket (doc correction)", s === 429, s + " (consume blocks before next())");

// M1: memoryPressure event surface
const before = process.eventNames().includes("memoryPressure" as never);
const handler = () => {};
process.on("memoryPressure" as never, handler);
const after = process.eventNames().includes("memoryPressure" as never);
process.removeListener("memoryPressure" as never, handler);
const removed = process.eventNames().includes("memoryPressure" as never);
check("M1 memoryPressure eventNames lifecycle", !before && after && !removed, "before=" + before + " after=" + after + " removed=" + removed);

console.log("---");
const fails = results.filter((r) => !r.pass);
console.log("infra:probe — " + (results.length - fails.length) + "/" + results.length + " pass" + (fails.length ? " · FAIL: " + fails.map((f) => f.name).join(", ") : ""));
process.exit(fails.length ? 1 : 0);