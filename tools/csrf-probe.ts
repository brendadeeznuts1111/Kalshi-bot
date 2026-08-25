#!/usr/bin/env bun
/**
 * `bun run csrf:probe` — probe the CSRF machinery (AGENT-PITFALLS §77):
 * session-bound token verification, anti-replay, secret pinning, expiry.
 *
 * VERIFIED on Bun 1.4.0:
 *   - Bun.CSRF.generate/verify exist; generate(undefined, opts) THROWS
 *     'Secret is required' (the module's documented claim).
 *   - session-binding: a token minted for session A FAILS under session B
 *     (the anti-replay property the Bun docs require) — the critical
 *     security claim verified.
 *   - missing token OR missing cookie -> reject; csrfGuard returns 403.
 *   - existing kalshi_session cookie preserves the sessionId (no churn).
 *   - different secret -> verify fails (secret pinning via
 *     KALSHI_CSRF_SECRET works).
 *   - expiresIn accepts any non-negative integer (module's 24h = 86400000
 *     works); the error message 'between 0 and 900' is MISLEADING — only
 *     negatives throw; +2^31 accepted (probe nuance, not a module bug).
 *
 * @see docs/AGENT-PITFALLS.md §77
 */
import { issueCsrfSession, verifyCsrfRequest, csrfGuard, CSRF_HEADER_NAME, CSRF_SESSION_COOKIE } from "../src/research/csrf.ts";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// C1: API surface + secret required
check("C1 Bun.CSRF.generate/verify exist", typeof (Bun as any).CSRF?.generate === "function" && typeof (Bun as any).CSRF?.verify === "function", "ok");
let gThrew = false;
try { (Bun as any).CSRF.generate(undefined, { sessionId: "x" }); } catch (e) { gThrew = String(e).includes("Secret is required"); }
check("C1b generate(undefined) throws Secret is required", gThrew, "ok");

// C2: valid request verifies
const s1 = issueCsrfSession(undefined, { KALSHI_CSRF_SECRET: "test-secret" });
const cookieReq = new Request("http://x", { headers: { "cookie": CSRF_SESSION_COOKIE + "=" + s1.sessionId, [CSRF_HEADER_NAME]: s1.token } });
check("C2 valid request verifies", verifyCsrfRequest(cookieReq, { KALSHI_CSRF_SECRET: "test-secret" }), "ok");

// C3: anti-replay — token session A + cookie session B fails
const other = issueCsrfSession(undefined, { KALSHI_CSRF_SECRET: "test-secret" });
const forged = new Request("http://x", { headers: { "cookie": CSRF_SESSION_COOKIE + "=" + other.sessionId, [CSRF_HEADER_NAME]: s1.token } });
check("C3 forged (token A, cookie B) rejected", !verifyCsrfRequest(forged, { KALSHI_CSRF_SECRET: "test-secret" }), "ok");

// C4: missing token/cookie + guard 403
const noToken = new Request("http://x", { headers: { "cookie": CSRF_SESSION_COOKIE + "=" + s1.sessionId } });
const noCookie = new Request("http://x", { headers: { [CSRF_HEADER_NAME]: s1.token } });
check("C4 missing token/cookie rejected", !verifyCsrfRequest(noToken, { KALSHI_CSRF_SECRET: "test-secret" }) && !verifyCsrfRequest(noCookie, { KALSHI_CSRF_SECRET: "test-secret" }), "ok");
const guardStatus = (await csrfGuard(forged, async () => new Response("ok"), { KALSHI_CSRF_SECRET: "test-secret" })).status;
check("C4b csrfGuard forged -> 403", guardStatus === 403, "status=" + guardStatus);

// C5: session preservation
const withCookie = new Request("http://x", { headers: { "cookie": CSRF_SESSION_COOKIE + "=existing-sid" } });
check("C5 existing cookie preserves sessionId", issueCsrfSession(withCookie, { KALSHI_CSRF_SECRET: "test-secret" }).sessionId === "existing-sid", "ok");

// C6: different secret fails
const sA = issueCsrfSession(undefined, { KALSHI_CSRF_SECRET: "secret-A" });
const reqB = new Request("http://x", { headers: { "cookie": CSRF_SESSION_COOKIE + "=" + sA.sessionId, [CSRF_HEADER_NAME]: sA.token } });
check("C6 token-A under secret-B rejected", !verifyCsrfRequest(reqB, { KALSHI_CSRF_SECRET: "secret-B" }), "ok");

// C7: expiresIn bounds (probe nuance — error msg says 0..900, really >= 0)
let negThrew = false; try { (Bun as any).CSRF.generate("test-secret", { sessionId: "x", expiresIn: -1 }); } catch { negThrew = true; }
let bigOk = false; try { const t = (Bun as any).CSRF.generate("test-secret", { sessionId: "x", expiresIn: 86400000 }); bigOk = (Bun as any).CSRF.verify(t, { secret: "test-secret", sessionId: "x" }); } catch { bigOk = false; }
check("C7 expiresIn: negative throws, 24h accepted", negThrew && bigOk, "negThrew=" + negThrew + " bigOk=" + bigOk);

console.log("---");
const fails = results.filter((r) => !r.pass);
console.log("csrf:probe — " + (results.length - fails.length) + "/" + results.length + " pass" + (fails.length ? " · FAIL: " + fails.map((f) => f.name).join(", ") : ""));
process.exit(fails.length ? 1 : 0);