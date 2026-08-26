#!/usr/bin/env bun
/**
 * `bun run serve-tls:probe` — close the §116/§120 next-step: real TLS +
 * HTTP/2/3 negotiation and the serve options depth (§123).
 */
import { serve } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

const dir = mkdtempSync(join(tmpdir(), "tls-probe-"));
const keyPath = join(dir, "key.pem");
const certPath = join(dir, "cert.pem");
const gen = Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath, "-days", "1", "-nodes", "-subj", "/CN=localhost"], { stdout: "ignore", stderr: "ignore" });
const key = await Bun.file(keyPath).text();
const cert = await Bun.file(certPath).text();
const NOVERIFY = { rejectUnauthorized: false } as any;

// P1: TLS serve + request scheme.
const s1 = serve({ port: 0, tls: { key, cert }, fetch(req) { return new Response(new URL(req.url).protocol); } });
const scheme = await (await fetch("https://localhost:" + s1.port + "/", { tls: NOVERIFY })).text();
check("P1 TLS serve (https protocol via req.url)", scheme === "https:", scheme);
s1.stop(true);

// P2 CORRECTED: serve http2:true does NOT negotiate h2 on 1.4.0 — the
// option is accepted and the server serves HTTP/1.1 over TLS, but an
// explicit h2 client fails (Bun fetch protocol http2 -> HTTP2Unsupported;
// node:http2 -> "h2 is not supported"). Pinned as a negative-behavior
// check: it self-invalidates when a Bun fix makes h2 negotiate.
const s2 = serve({ port: 0, tls: { key, cert }, http2: true, fetch() { return new Response("h2ok"); } } as any); // http2 not even in the serve types (§123)
let h2ok = "";
try { h2ok = await (await fetch("https://localhost:" + s2.port + "/", { tls: NOVERIFY, protocol: "http2" } as any)).text(); } catch (e: any) { h2ok = "ERR " + String(e.message).slice(0, 60); }
const defaultOk = await (await fetch("https://localhost:" + s2.port + "/", { tls: NOVERIFY })).text();
check("P2 serve http2:true serves h1.1 but does NOT negotiate h2 (pinned)", h2ok.includes("HTTP2Unsupported") && defaultOk === "h2ok", h2ok + " | default=" + defaultOk);
s2.stop(true);

// P3: http3:true + TLS — server starts and serves over the TLS socket.
let h3ok = "";
try { const s3 = serve({ port: 0, tls: { key, cert }, http3: true, fetch() { return new Response("h3ok"); } }); h3ok = await (await fetch("https://localhost:" + s3.port + "/", { tls: NOVERIFY })).text(); s3.stop(true); } catch (e: any) { h3ok = "ERR " + String(e.message).slice(0, 60); }
check("P3 serve http3:true + TLS starts and serves", h3ok === "h3ok", h3ok);

// P4: maxRequestBodySize enforcement.
const s4 = serve({ port: 0, maxRequestBodySize: 1024, fetch(req) { return new Response("got:" + req.method); } });
const small = await fetch("http://localhost:" + s4.port + "/", { method: "POST", body: "x".repeat(100) });
const big = await fetch("http://localhost:" + s4.port + "/", { method: "POST", body: "x".repeat(5000) });
check("P4 maxRequestBodySize: small ok, large 413", small.status === 200 && big.status === 413, "small=" + small.status + " big=" + big.status);
s4.stop(true);

// P5: serve error handler fires on a handler throw.
const s5 = serve({ port: 0, error() { return new Response("custom-500", { status: 500 }); }, fetch() { throw new Error("boom"); } });
const e5 = await fetch("http://localhost:" + s5.port + "/");
check("P5 serve error handler on throw", e5.status === 500 && (await e5.text()) === "custom-500");
s5.stop(true);

rmSync(dir, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log("serve-tls:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);
