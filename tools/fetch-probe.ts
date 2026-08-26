#!/usr/bin/env bun
/**
 * `bun run fetch:probe` — fetch/HTTP client semantics (§139): keep-alive
 * connection reuse, redirects, abort, streaming bodies, FormData, gzip
 * auto-decompression — probed against a node:http server (also exercises
 * Bun node:http compat). Bun 1.4.0, loopback only.
 */
import { createServer } from "node:http";
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };
const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(label + " timeout")), ms))]);

let conns = 0;
const gz = Bun.gzipSync("decompressed-content");
const server = createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://x");
  if (u.pathname === "/redirect") { res.statusCode = 302; res.setHeader("Location", "/target"); res.end(); return; }
  if (u.pathname === "/slow") { res.writeHead(200, { "Content-Type": "text/plain" }); res.write("a"); setTimeout(() => { res.write("b"); res.end(); }, 200); return; }
  if (u.pathname === "/echo") { const chunks: Buffer[] = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => { res.end(String(req.headers["content-type"] ?? "") + "|" + Buffer.concat(chunks).toString()); }); return; }
  if (u.pathname === "/gzip") { res.writeHead(200, { "Content-Encoding": "gzip" }); res.end(gz); return; }
  if (u.pathname === "/close") { res.setHeader("Connection", "close"); res.end("done"); return; }
  res.end("ok");
});
server.on("connection", () => { conns++; });

const PORT: number = await new Promise((r) => server.listen(0, "127.0.0.1", () => r((server.address() as any).port)));
const base = "http://127.0.0.1:" + PORT;

// P1 keep-alive: 5 sequential fetches reuse ONE connection.
for (let i = 0; i < 5; i++) { const r = await fetch(base + "/"); await r.text(); }
check("P1 keep-alive reuse (5 fetches, 1 conn)", conns === 1, "conns=" + conns);

// P1a Connection: close opens a new connection; next fetch opens another.
const rClose = await fetch(base + "/close"); await rClose.text();
const afterClose = conns;
const rAfter = await fetch(base + "/"); await rAfter.text();
check("P1a close breaks keep-alive for next fetch", afterClose === 1 && conns === 2, "afterClose=" + afterClose + " then=" + conns);

// P2 redirect modes.
const rFollow = await fetch(base + "/redirect");
check("P2 follow redirect", rFollow.status === 200 && rFollow.url.endsWith("/target"), "url=" + rFollow.url);
let errRedirect = "no-throw";
try { await fetch(base + "/redirect", { redirect: "error" }); } catch { errRedirect = "throws"; }
check("P2a redirect error throws", errRedirect === "throws", errRedirect);
const rManual = await fetch(base + "/redirect", { redirect: "manual" });
check("P2b redirect manual = unfollowed 302 (not opaque)", rManual.type === "default" && rManual.status === 302, "type=" + rManual.type + " status=" + rManual.status);

// P3 abort mid-stream.
try {
  const ctrl = new AbortController();
  const resp = await fetch(base + "/slow", { signal: ctrl.signal });
  const reader = resp.body!.getReader();
  const first = await withTimeout(reader.read(), 3000, "first-chunk");
  const gotA = new TextDecoder().decode(first.value as Uint8Array) === "a";
  ctrl.abort();
  let aborted = false;
  try { while (true) { const { done } = await reader.read(); if (done) break; } } catch (e) { aborted = String((e as Error).name).includes("Abort") || String(e).toLowerCase().includes("abort"); }
  check("P3 abort mid-stream", gotA && aborted, "gotA=" + gotA + " aborted=" + aborted);
} catch (e) { check("P3 abort mid-stream", false, String((e as Error).message).slice(0, 60)); }

// P4 streaming request body (ReadableStream POST).
const bodyStream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("chunk1-")); c.enqueue(new TextEncoder().encode("chunk2")); c.close(); } });
const rStream = await fetch(base + "/echo", { method: "POST", body: bodyStream });
const echoed = (await rStream.text()).split("|")[1];
check("P4 streaming request body", echoed === "chunk1-chunk2", JSON.stringify(echoed));

// P5 FormData multipart round-trip.
const fd = new FormData();
fd.append("field", "value");
fd.append("file", new Blob(["file-content"]), "f.txt");
const rFD = await fetch(base + "/echo", { method: "POST", body: fd });
const fdBody = await rFD.text();
const [ct, payload] = [fdBody.split("|")[0]!, fdBody.split("|")[1]!];
check("P5 FormData multipart", ct.includes("multipart/form-data") && ct.includes("boundary=") && payload.includes("file-content") && payload.includes("name=\"field\""), "ct=" + ct.slice(0, 40));

// P6 gzip auto-decompression.
const rGz = await fetch(base + "/gzip");
const gzText = await rGz.text();
check("P6 gzip auto-decompress", gzText === "decompressed-content", gzText.slice(0, 30));

// P7 incremental response streaming (chunks arrive over time).
const t0 = Date.now();
const rSlow = await fetch(base + "/slow");
const reader2 = rSlow.body!.getReader();
const c1 = await withTimeout(reader2.read(), 3000, "c1");
const c2 = await withTimeout(reader2.read(), 3000, "c2");
const d1 = new TextDecoder().decode(c1.value as Uint8Array);
const d2 = new TextDecoder().decode(c2.value as Uint8Array);
check("P7 incremental streaming", d1 === "a" && d2 === "b" && Date.now() - t0 >= 150, "d1=" + d1 + " d2=" + d2 + " elapsed=" + (Date.now() - t0) + "ms");

server.close();
const failed = results.filter((r) => !r.pass);
console.log("fetch:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
