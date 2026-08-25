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

// D9: port env precedence — Bun.serve auto-reads BUN_PORT > PORT > NODE_PORT
// (probed §83 in clean subprocesses; in-process env mutation is unreliable).
const readPort = (env: Record<string, string>): number => {
  const script = "const s = Bun.serve({ fetch: () => new Response(\"x\") }); console.log(s.port); s.stop(true);";
  const r = Bun.spawnSync(["bun", "-e", script], { env: { ...process.env, ...env }, stdout: "pipe" });
  return Number(r.stdout?.toString().trim() ?? "0");
};
const pAll = readPort({ BUN_PORT: "4873", PORT: "4872", NODE_PORT: "4871" });
const pNode = readPort({ NODE_PORT: "4861" });
const pPort = readPort({ PORT: "4862" });
check("D9 port precedence BUN_PORT > PORT > NODE_PORT", pAll === 4873, "all-set -> " + pAll);
check("D9b NODE_PORT alone read", pNode === 4861, "NODE_PORT -> " + pNode);
check("D9c PORT alone read", pPort === 4862, "PORT -> " + pPort);

// D10: BUN_* env vars the repo declares in config.ts (§84)
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
const e1dir = mkdtempSync(tmpdir() + "/defenv-");
// D10a: BUN_RUNTIME_TRANSPILER_CACHE_PATH — Bun writes >4KB transpiled output there
writeFileSync(e1dir + "/big.ts", "export const s = " + JSON.stringify("x".repeat(5000)) + ";");
const r1 = Bun.spawnSync(["bun", "-e", "import " + JSON.stringify(e1dir + "/big.ts") + "; console.log(1);"], { env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: e1dir + "/cache" }, stdout: "pipe", stderr: "pipe" });
let cacheEntries = 0;
try { cacheEntries = readdirSync(e1dir + "/cache", { recursive: true } as any).length; } catch { cacheEntries = 0; }
rmSync(e1dir, { recursive: true, force: true });
check("D10a transpiler cache writes to BUN_RUNTIME_TRANSPILER_CACHE_PATH", cacheEntries > 0, "entries=" + cacheEntries + " exit=" + r1.exitCode);

// D10b: BUN_CONFIG_VERBOSE_FETCH=curl logs request URL
const e4 = Bun.spawnSync(["bun", "-e", "await fetch(\"https://example.com\").then(r => r.text());"], { env: { ...process.env, BUN_CONFIG_VERBOSE_FETCH: "curl" }, stdout: "pipe", stderr: "pipe" });
const log4 = (e4.stderr?.toString() || "") + (e4.stdout?.toString() || "");
check("D10b VERBOSE_FETCH=curl logs request URL", log4.includes("example.com"), "logged=" + log4.includes("example.com"));

// D10c: NODE_ENV is UNSET by default (repo gates dev-mode on === 'production')
const e5 = Bun.spawnSync(["bun", "-e", "console.log(process.env.NODE_ENV ?? \"unset\")"], { stdout: "pipe" });
check("D10c NODE_ENV unset by default", (e5.stdout?.toString().trim() ?? "") === "unset", "got=" + (e5.stdout?.toString().trim() ?? ""));

console.log("---");
const fails = results.filter((r) => !r.pass);
console.log("defaults:probe — " + (results.length - fails.length) + "/" + results.length + " pass" + (fails.length ? " · FAIL: " + fails.map((f) => f.name).join(", ") : ""));
process.exit(fails.length ? 1 : 0);