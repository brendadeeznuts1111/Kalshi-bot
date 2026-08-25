#!/usr/bin/env bun
/**
 * `bun run node-compat:probe` — node: module BEHAVIOR on Bun 1.4.0
 * (§140). The repo imports node:path/fs/util/os/crypto/tls/net/
 * child_process; runtime:probe P12 verified they RESOLVE — this gate
 * verifies they BEHAVE (incl. crypto parity with Bun.CryptoHasher).
 */
import { join, resolve, basename, dirname, extname, relative } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { platform, arch, type as osType, hostname, tmpdir, cpus } from "node:os";
import { format, promisify, types } from "node:util";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { createServer as netServer, connect as netConnect } from "node:net";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };
const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(label + " timeout")), ms))]);

// P1 node:path (repo: path.join in config/toml-config).
check("P1 path join/resolve", join("a", "b") === "a/b" && resolve("a", "b").endsWith("a/b") && basename("/x/y.ts") === "y.ts" && dirname("/x/y.ts") === "/x" && extname("y.ts") === ".ts" && relative("/a/b", "/a/c") === "../c", join("a", "b"));

// P2 node:fs sync + mkdirSync (repo: mkdirSync in partner-dashboard).
mkdirSync("scratch/node-compat", { recursive: true });
writeFileSync("scratch/node-compat/f.txt", "fs-content");
check("P2 fs sync round-trip", readFileSync("scratch/node-compat/f.txt", "utf8") === "fs-content" && existsSync("scratch/node-compat/f.txt"), readFileSync("scratch/node-compat/f.txt", "utf8"));

// P3 node:fs/promises.
await writeFile("scratch/node-compat/p.txt", "promises-content");
check("P3 fs.promises", (await readFile("scratch/node-compat/p.txt", "utf8")) === "promises-content", "");

// P4 node:fs.watch fires on change (repo: match-liquidity-db-watch).
try {
  const w = watch("scratch/node-compat/f.txt");
  const evt = withTimeout(new Promise<string>((r) => w.on("change", () => r("changed"))), 4000, "watch");
  writeFileSync("scratch/node-compat/f.txt", "fs-content-2");
  const got = await evt;
  check("P4 fs.watch fires", got === "changed", got);
  w.close();
} catch (e) { check("P4 fs.watch fires", false, String((e as Error).message).slice(0, 60)); }

// P5 node:crypto parity with Bun.CryptoHasher (sha256 of abc).
const nodeSha = createHash("sha256").update("abc").digest("hex");
const bunSha = new Bun.CryptoHasher("sha256").update("abc").digest("hex");
check("P5 createHash === Bun.CryptoHasher", nodeSha === bunSha && nodeSha === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", nodeSha.slice(0, 16));
const hm = createHmac("sha256", "key").update("data").digest("hex");
check("P5a createHmac", typeof hm === "string" && hm.length === 64, hm.slice(0, 12));
check("P5b randomBytes/randomUUID", randomBytes(16).length === 16 && randomUUID().length === 36 && randomUUID()[14] === "4", "");

// P6 node:os.
check("P6 os platform/arch/type", typeof platform() === "string" && platform().length > 0 && typeof arch() === "string" && typeof osType() === "string" && typeof hostname() === "string" && typeof tmpdir() === "string" && Array.isArray(cpus()) && cpus().length > 0, platform() + "/" + arch());

// P7 node:util (repo: util.format in terminal-utils).
check("P7 util format/promisify/types", format("x %d", 5) === "x 5" && typeof promisify === "function" && types.isDate(new Date()) && !types.isDate(5), format("x %d", 5));

// P8 node:events EventEmitter.
const ee = new EventEmitter();
let heard = "";
ee.on("ping", (v: string) => { heard = v; });
ee.emit("ping", "pong");
const onceGot: number[] = [];
ee.once("once", (n: number) => onceGot.push(n));
ee.emit("once", 1); ee.emit("once", 2);
check("P8 EventEmitter on/once", heard === "pong" && onceGot.length === 1, "heard=" + heard + " once=" + onceGot.length);

// P9 node:child_process spawnSync.
const sp = spawnSync("bun", ["--version"], { encoding: "utf8" });
check("P9 child_process spawnSync", sp.status === 0 && typeof sp.stdout === "string" && sp.stdout.includes("1.4"), "status=" + sp.status + " out=" + String(sp.stdout).trim());

// P10 node:net TCP echo round-trip.
try {
  const srv = netServer((sock) => { sock.on("data", (d) => sock.write("echo:" + d.toString())); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as any).port;
  const got = await withTimeout(new Promise<string>((r) => { const c = netConnect({ host: "127.0.0.1", port }, () => { c.write("hi"); }); c.on("data", (d) => { r(d.toString()); c.end(); }); }), 4000, "net");
  check("P10 node:net echo", got === "echo:hi", got);
  srv.close();
} catch (e) { check("P10 node:net echo", false, String((e as Error).message).slice(0, 60)); }

const failed = results.filter((r) => !r.pass);
console.log("node-compat:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
