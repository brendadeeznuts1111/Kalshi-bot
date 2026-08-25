#!/usr/bin/env bun
/**
 * `bun run h2:probe` — HTTP/2 fetch multiplexing + serve HTTP protocol
 * semantics (§154): concurrent protocol:"http2" fetches share ONE
 * connection with concurrent streams; serve HEAD/chunked/100-continue.
 * Bun 1.4.0, loopback TLS.
 */
import { createSecureServer } from "node:http2";
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// Self-signed cert for loopback TLS (openssl, like serve-tls-probe).
const cg = Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-keyout", "scratch/h2-key.pem", "-out", "scratch/h2-cert.pem", "-days", "1", "-nodes", "-subj", "/CN=localhost"], { stdout: "ignore", stderr: "ignore" });
if (cg.exitCode !== 0) { console.log("FAIL openssl cert-gen", String(cg.stderr)); process.exit(1); }
const key = await Bun.file("scratch/h2-key.pem").text();
const cert = await Bun.file("scratch/h2-cert.pem").text();

// P1-P2: h2 fetch multiplexing — 8 concurrent requests, one connection.
let conns = 0;
let maxActive = 0;
let active = 0;
const srv = createSecureServer({ key, cert }, (req, res) => { setTimeout(() => res.end("ok:" + req.url), 150); });
srv.on("connection", () => { conns++; });
srv.on("stream", (stream: any) => { active++; if (active > maxActive) maxActive = active; stream.on("close", () => active--); });
await new Promise((r) => srv.listen(0, "127.0.0.1", () => r(null)));
const port = (srv.address() as any).port;
const t0 = Date.now();
const resps = await Promise.all(Array.from({ length: 8 }, (_, i) => fetch("https://127.0.0.1:" + port + "/r" + i, { protocol: "http2", tls: { rejectUnauthorized: false } })));
const bodies = await Promise.all(resps.map((r) => r.text()));
const elapsed = Date.now() - t0;
const allOk = bodies.every((b, i) => b === "ok:/r" + i);
check("P1 h2 fetch single connection", conns === 1, "conns=" + conns);
check("P2 h2 multiplexes streams", maxActive >= 4 && elapsed < 800 && allOk, "streams=" + maxActive + " elapsed=" + elapsed + "ms");
srv.close();

// P3-P5: Bun.serve HTTP protocol semantics.
const s = Bun.serve({ port: 0, fetch(req) {
  const u = new URL(req.url);
  if (u.pathname === "/head") return new Response("body-content", { headers: { "X-Probe": "1" } });
  if (u.pathname === "/chunked") return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("a")); setTimeout(() => { c.enqueue(new TextEncoder().encode("b")); c.close(); }, 100); } }));
  if (u.pathname === "/continue") return new Response(req.headers.get("expect") ?? "none");
  return new Response("root");
} });
const base = "http://127.0.0.1:" + s.port;
const head = await fetch(base + "/head", { method: "HEAD" });
check("P3 serve HEAD: empty body + content-length", head.status === 200 && (await head.text()).length === 0 && head.headers.get("content-length") === "12" && head.headers.get("x-probe") === "1", "cl=" + head.headers.get("content-length"));
const chunk = await fetch(base + "/chunked");
check("P4 serve chunked streaming", (await chunk.text()) === "ab" && chunk.headers.get("transfer-encoding") === "chunked" && chunk.headers.get("content-length") === null, "te=" + chunk.headers.get("transfer-encoding"));
const cont = await fetch(base + "/continue", { method: "POST", headers: { "Expect": "100-continue" }, body: "x" });
const contBody = await cont.text();
check("P5 Expect header reaches handler", contBody === "100-continue", contBody);
s.stop(true);

const failed = results.filter((r) => !r.pass);
console.log("h2:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
