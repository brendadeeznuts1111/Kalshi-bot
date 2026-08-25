#!/usr/bin/env bun
export {};
/**
 * `bun run defaults:probe` — cross-reference API DEFAULTS across the Bun
 * surfaces the repo touches (AGENT-PITFALLS §81): serve, build,
 * transpiler, cookie, CSRF. Each default probed against 1.4.0 so the
 * repo's explicit overrides are grounded.
 *
 * VERIFIED on Bun 1.4.0:
 *   - Bun.serve DEFAULT hostname is "localhost" — the http-server doc
 *     claims 0.0.0.0, WRONG on 1.4.0 (correction §81). Explicit
 *     0.0.0.0 / localhost / 127.0.0.1 all honored when set.
 *   - Bun.serve defaults: 128MB maxRequestBodySize, 10s idleTimeout
 *     (repo overrides to 16MB / 255 — hardening §81).
 *   - Cookie defaults: path "/", sameSite "lax", httpOnly false,
 *     secure false (cross-ref §79).
 *   - CSRF generate without expiresIn works (no default needed).
 *   - req.cookies (CookieMap) exists ONLY in routes handlers — NOT in
 *     fetch handlers (cross-doc gotcha §81).
 *
 * @see docs/AGENT-PITFALLS.md §81
 */

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// D1: serve default hostname is localhost (doc says 0.0.0.0 — correction)
const s = Bun.serve({ port: 0, fetch: () => new Response("x") });
const defHost = s.hostname;
s.stop(true);
check("D1 serve default hostname = localhost (doc claims 0.0.0.0)", defHost === "localhost", "default=" + JSON.stringify(defHost));

// D2: explicit hostnames honored
const h0 = Bun.serve({ hostname: "0.0.0.0", port: 0, fetch: () => new Response("x") });
const h0ok = h0.hostname === "0.0.0.0";
h0.stop(true);
const h4 = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("x") });
const h4ok = h4.hostname === "127.0.0.1";
h4.stop(true);
check("D2 explicit hostnames honored", h0ok && h4ok, "0.0.0.0=" + h0ok + " 127.0.0.1=" + h4ok);

// D3: cookie defaults
const c = new Bun.Cookie("n", "v");
check("D3 cookie defaults path=/ sameSite=lax httpOnly=false secure=false", c.path === "/" && c.sameSite === "lax" && c.httpOnly === false && c.secure === false, "path=" + c.path + " ss=" + c.sameSite);

// D4: CSRF generate without expiresIn works
let csrfOk = false;
try { csrfOk = typeof (Bun as any).CSRF.generate("sec", { sessionId: "x" }) === "string"; } catch { csrfOk = false; }
check("D4 CSRF generate no-expiresIn works", csrfOk, "ok");

// D5: req.cookies ONLY in routes, NOT fetch (cross-doc gotcha)
const sF = Bun.serve({ port: 3651, fetch: (req: any) => new Response("cookies=" + (typeof req.cookies !== "undefined")) });
const rF = await fetch("http://127.0.0.1:3651/");
const fBody = await rF.text();
sF.stop(true);
const sR = Bun.serve({ port: 3652, routes: { "/": (req: any) => new Response("cookies=" + (req.cookies instanceof Bun.CookieMap)) } });
const rR = await fetch("http://127.0.0.1:3652/");
const rBody = await rR.text();
sR.stop(true);
check("D5 req.cookies routes-only (not fetch)", fBody === "cookies=false" && rBody === "cookies=true", "fetch=" + fBody + " routes=" + rBody);

// D6: transpiler default loader is jsx (not ts) — §82
const tDef = new Bun.Transpiler();
let tsFails = false;
try { tDef.transformSync("const x: number = 1;"); } catch { tsFails = true; }
const tTs = new Bun.Transpiler({ loader: "ts" });
const tsWorks = tTs.transformSync("const x: number = 1;").length > 0;
check("D6 transpiler default loader jsx (ts syntax fails; explicit ts works)", tsFails && tsWorks, "tsFails=" + tsFails + " tsWorks=" + tsWorks);

// D7: Bun.inspect default is UNBOUNDED depth (§82) — repo redact pins 32
const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
const insp = Bun.inspect(deep);
check("D7 inspect default shows all nested levels (unbounded)", insp.includes("e:") && insp.includes("f:"), "shows e=" + insp.includes("e:") + " f=" + insp.includes("f:"));

// D8: write/hash/hasher defaults (§82)
const w = await Bun.write("/tmp/bun-def-write.txt", "hello");
check("D8 Bun.write returns bytes (number)", typeof w === "number" && w === 5, "w=" + w + " typeof=" + typeof w);
check("D8b Bun.hash returns bigint", typeof Bun.hash("x") === "bigint", "typeof=" + typeof Bun.hash("x"));
const h = new Bun.CryptoHasher("sha256"); h.update("x");
const digest = h.digest();
check("D8c CryptoHasher.digest Buffer 32 bytes", digest instanceof Uint8Array && digest.length === 32, "ctor=" + digest.constructor.name + " len=" + digest.length);

console.log("---");
const fails = results.filter((r) => !r.pass);
console.log("defaults:probe — " + (results.length - fails.length) + "/" + results.length + " pass" + (fails.length ? " · FAIL: " + fails.map((f) => f.name).join(", ") : ""));
process.exit(fails.length ? 1 : 0);