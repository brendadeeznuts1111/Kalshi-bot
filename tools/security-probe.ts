#!/usr/bin/env bun
/**
 * `bun run security:probe` — reproduce the Bun 1.4 security-hardening
 * probes against the INSTALLED runtime (docs/AGENT-PITFALLS.md §28).
 *
 * Generates a throwaway self-signed cert, spins a local TLS Bun.serve, and
 * verifies: fetch + checkServerIdentity (rejects before send), tls.connect
 * servername default + ERR_TLS_CERT_ALTNAME_INVALID on IP mismatch,
 * Bun.connect authorized=false on untrusted handshake, and the HTTP framing
 * 400s (bad/duplicate/conflicting Content-Length, invalid chunk size).
 * Exits 1 if any probe fails — run it after upgrading Bun.
 */
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import net from "node:net";
import tls from "node:tls";
import { $ } from "bun";

const dir = join(tmpdir(), "bunsec-probe-" + process.pid);
mkdirSync(dir, { recursive: true });

// self-signed cert for CN=localhost — native Bun.$ shell (no child_process)
const gen = await $`openssl req -x509 -newkey rsa:2048 -keyout ${join(dir, "key.pem")} -out ${join(dir, "cert.pem")} -days 1 -nodes -subj /CN=localhost -addext subjectAltName=DNS:localhost`.quiet();
if (gen.exitCode !== 0) {
  console.error("security:probe: openssl unavailable — cannot generate cert");
  process.exit(1);
}
const cert = readFileSync(join(dir, "cert.pem"));
const key = readFileSync(join(dir, "key.pem"));

let failures = 0;
const check = (label: string, ok: boolean, detail = ""): void => {
  console.log((ok ? "ok   " : "FAIL ") + label + (detail ? " — " + detail : ""));
  if (!ok) failures += 1;
};

const server = Bun.serve({ tls: { cert, key }, port: 0, fetch: () => new Response("secure hello") });
const port = server.port;

// 1. fetch + checkServerIdentity: Error returned -> reject BEFORE send
try {
  await fetch("https://127.0.0.1:" + port + "/", {
    tls: { ca: cert, checkServerIdentity: () => new Error("pin mismatch") },
  });
  check("fetch checkServerIdentity rejects on Error", false, "request went through");
} catch (e) {
  check("fetch checkServerIdentity rejects on Error", String(e).includes("pin mismatch"), String(e).slice(0, 40));
}

// 1b. returning undefined -> request proceeds
try {
  const res = await fetch("https://127.0.0.1:" + port + "/", {
    tls: { ca: cert, checkServerIdentity: () => undefined },
  });
  check("fetch checkServerIdentity undefined proceeds", res.status === 200, "status " + res.status);
} catch (e) {
  check("fetch checkServerIdentity undefined proceeds", false, String(e).slice(0, 50));
}

// 1c. ca alone does NOT bypass hostname check (IP vs CN=localhost)
try {
  await fetch("https://127.0.0.1:" + port + "/", { tls: { ca: cert } });
  check("ca alone bypasses hostname check", false, "connected by IP");
} catch (e) {
  const err = e as { code?: string; message?: string };
  check("ca alone does NOT bypass hostname check", err.code === "ERR_TLS_CERT_ALTNAME_INVALID", String(err.code ?? err.message?.slice(0, 30)));
}

// 2. tls.connect servername default
await new Promise<void>((resolve) => {
  const s = tls.connect({ host: "localhost", port, rejectUnauthorized: false, ca: cert }, () => {
    check("tls.connect sends host as servername", s.servername === "localhost", "servername=" + s.servername);
    s.destroy();
    resolve();
  });
  s.on("error", (e) => { check("tls.connect servername default", false, String(e).slice(0, 50)); resolve(); });
});

// 3. Bun.connect untrusted handshake -> authorized=false
const connected = await Bun.connect({
  hostname: "127.0.0.1",
  port: port as number,
  tls: true,
  socket: {
    open(socket) { check("Bun.connect authorized=false on untrusted", (socket as any).authorized === false, "authorized=" + (socket as any).authorized); },
    data() {},
  } as const,
});
await new Promise((r) => setTimeout(r, 150));
if (connected) connected.close?.();

// 4. HTTP framing hardening — needs a PLAIN HTTP server (raw TCP against
// the TLS server gets a TLS handshake, not HTTP framing responses).
// Handler MUST read the body for framing 400s to fire — Bun parses
// chunked/Content-Length lazily on req.text()/json() (probe: a handler
// that never reads the body gets 200 for an invalid chunk).
const plain = Bun.serve({
  port: 0,
  fetch: async (req) => {
    await req.text().catch(() => {});
    return new Response("ok");
  },
});
const plainPort = plain.port;
async function rawSend(payload: string): Promise<number> {
  return new Promise((resolve) => {
    const sock = net.connect(plainPort as number, "127.0.0.1", () => sock.write(payload));
    let status = 0;
    sock.on("data", (d) => {
      const m = /^HTTP\/1\.[01] (\d{3})/.exec(d.toString());
      if (m) status = parseInt(m[1], 10);
      sock.destroy();
      resolve(status);
    });
    sock.on("error", () => { sock.destroy(); resolve(status || 0); });
    setTimeout(() => { sock.destroy(); resolve(status || 0); }, 2000);
  });
}
const bad = [
  ["Content-Length: abc", "POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: abc\r\n\r\n"],
  ["CL + TE (smuggling)", "POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\nTransfer-Encoding: chunked\r\n\r\n"],
  ["Content-Length: -1", "POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: -1\r\n\r\n"],
  ["duplicate Content-Length", "POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 5\r\nContent-Length: 7\r\n\r\nhello"],
  ["invalid chunk size", "POST / HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\nZZZ\r\n"],
];
for (const [label, payload] of bad) {
  const st = await rawSend(payload);
  check("400 for " + label, st === 400, "status " + st);
}

server.stop(true);
plain.stop(true);
rmSync(dir, { recursive: true, force: true });
console.log(failures === 0 ? "security:probe ok — all " + (5 + bad.length) + " probes pass" : "security:probe: " + failures + " probe(s) FAILED");
process.exit(failures === 0 ? 0 : 1);
