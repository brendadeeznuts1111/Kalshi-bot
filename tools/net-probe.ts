#!/usr/bin/env bun
/**
 * `bun run net:probe` — network cluster (§134): listen/connect TCP
 * round-trip, udpSocket send/recv, dns, redis shape, secrets get-only.
 * Bun 1.4.0. All loopback; 5s timeouts guard every await.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };
const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(label + " timeout")), ms))]);

// P1 TCP round-trip: Bun.listen + Bun.connect on loopback.
let server: any = null;
try {
  server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data(sock: any, buf: any) { sock.write("echo:" + buf.toString()); } } } as any);
  let echoed = "";
  const client = await withTimeout(Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data(sock: any, buf: any) { const s = buf.toString(); if (s.startsWith("echo:")) { echoed = s; sock.end(); } } } } as any), 5000, "connect");
  client.write("hi");
  await withTimeout(new Promise<void>((r) => { const iv = setInterval(() => { if (echoed) { clearInterval(iv); r(); } }, 10); setTimeout(() => { clearInterval(iv); r(); }, 4000); }), 5000, "echo-wait");
  check("P1 listen+connect round-trip", echoed === "echo:hi", echoed);
} catch (e) { check("P1 listen+connect round-trip", false, String((e as Error).message).slice(0, 80)); } finally { try { server?.stop(true); } catch { /* ok */ } }

// P2 udpSocket send/recv on loopback.
try {
  const p1 = 41000 + Math.floor(Math.random() * 500);
  const p2 = p1 + 1;
  const udp = await Bun.udpSocket({ hostname: "127.0.0.1", port: p1 } as any);
  let udpGot = "";
  const udp2 = await Bun.udpSocket({ hostname: "127.0.0.1", port: p2, socket: { data: (_s: any, buf: any) => { udpGot = new TextDecoder().decode(buf); } } } as any);
  udp.send(Buffer.from("udp-payload"), udp2.port, "127.0.0.1");
  await withTimeout(new Promise<void>((r) => { const iv = setInterval(() => { if (udpGot) { clearInterval(iv); r(); } }, 10); setTimeout(() => { clearInterval(iv); r(); }, 4000); }), 5000, "udp-wait");
  check("P2 udpSocket send/recv", udpGot === "udp-payload", udpGot);
  udp.close(); udp2.close();
} catch (e) { check("P2 udpSocket send/recv", false, String((e as Error).message).slice(0, 80)); }

// P3 dns: prefetch + lookup("localhost") resolves offline via hosts.
check("P3 dns prefetch/lookup fns", typeof Bun.dns.prefetch === "function" && typeof Bun.dns.lookup === "function", Object.keys(Bun.dns).join(","));
try {
  const l = await Bun.dns.lookup("localhost");
  check("P3a dns.lookup localhost", !!l && l.length > 0 && l[0].address !== undefined, JSON.stringify(l).slice(0, 80));
} catch (e) { check("P3a dns.lookup localhost", false, String((e as Error).message).slice(0, 80)); }

// P4 redis: client shape only (no server in the gate — no connect).
check("P4 redis shape", typeof Bun.redis === "object" && typeof (Bun.redis as any)?.constructor === "function", "ctor=" + String(typeof (Bun.redis as any)?.constructor));

// P5 secrets: get on a MISSING ref -> null (never mutates the vault).
// repo passes { service, name } objects (src/lib/secrets.ts) — the runtime
// REQUIRES the object form; a bare string throws (pinned in P5c). Positional
// form works per the repo comment (P5b).
try {
  const v = await withTimeout(Bun.secrets.get({ service: "com.kalshi-bot.probe", name: "definitely-missing" }), 5000, "secrets-get");
  check("P5 secrets.get object missing -> null", v === null || v === undefined, String(v));
} catch (e) { check("P5 secrets.get object missing -> null", true, "throw:" + String((e as Error).message).slice(0, 60)); }
let posErr = "no-throw";
try { await (Bun.secrets.get as any)("com.kalshi-bot.probe", "definitely-missing"); } catch (e) { posErr = "throws"; }
check("P5b secrets positional form works", posErr === "no-throw", posErr);
let strErr = "no-throw";
try { await (Bun.secrets.get as any)("bare-string-ref"); } catch (e) { strErr = "throws"; }
check("P5c secrets bare string throws (pinned)", strErr === "throws", strErr);
check("P5a secrets API", typeof Bun.secrets.get === "function" && typeof Bun.secrets.set === "function", Object.keys(Bun.secrets).join(","));

const failed = results.filter((r) => !r.pass);
console.log("net:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
