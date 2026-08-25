#!/usr/bin/env bun
/**
 * `bun run routes:probe` — lock the Bun.serve routes API surface (§122):
 * exact/named/dir/fetch patterns the repo relies on, and the forms that
 * do NOT work on 1.4.0 (method-prefixed keys, dir error/headers options,
 * SPA-fallback nested routes, wildcard param capture).
 */
import { serve } from "bun";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

const dir = mkdtempSync(join("/tmp", "routes-probe-"));
writeFileSync(join(dir, "index.html"), "<h1>idx</h1>");
writeFileSync(join(dir, "a.txt"), "AAAA");
const base2 = "http://localhost:";

const server = serve({
  port: 0,
  routes: {
    "/exact": () => new Response("exact-hit"),
    "/users/:id": (req) => new Response((req.params as any).id),
    "/wild/*": (req) => new Response(new URL(req.url).pathname),
    "/static/*": { dir },
  },
  fetch(req) { return new Response("fb:" + new URL(req.url).pathname); },
});
const base = base2 + server.port;
async function run() {
  check("P1 exact route", await (await fetch(base + "/exact")).text() === "exact-hit");
  check("P2 named param (:id -> params.id)", await (await fetch(base + "/users/42")).text() === "42");
  check("P3 wildcard: params empty, req.url intact", await (await fetch(base + "/wild/deep/path")).text() === "/wild/deep/path");
  const f = await fetch(base + "/static/a.txt");
  check("P4 dir file: content-type + accept-ranges + etag + lm", f.status === 200 && (f.headers.get("content-type") ?? "").includes("text/plain") && f.headers.get("accept-ranges") === "bytes" && !!f.headers.get("etag") && !!f.headers.get("last-modified"));
  const r = await fetch(base + "/static/a.txt", { headers: { Range: "bytes=0-1" } });
  check("P5 dir Range -> 206 + Content-Range", r.status === 206 && r.headers.get("content-range") === "bytes 0-1/4");
  const idx = await fetch(base + "/static/");
  check("P6 dir index.html", (await idx.text()).includes("idx"));
  const miss = await fetch(base + "/static/nope.txt");
  check("P7 dir missing -> built-in 404 (empty)", miss.status === 404 && (await miss.text()) === "");
  check("P8 fetch fallback for unmatched", await (await fetch(base + "/unmatched")).text() === "fb:/unmatched");
}
await run();
server.stop(true);

// P9: method-prefixed route keys are REJECTED.
let methodErr = "";
try { serve({ port: 0, routes: { "GET /m": () => new Response("x") } }); methodErr = "accepted"; } catch (e: any) { methodErr = String(e.message); }
check("P9 method-prefixed keys rejected (path-only)", methodErr.includes("Path must start with"), methodErr.slice(0, 50));

// P10: dir error/headers options NOT honored.
const s2 = serve({ port: 0, routes: { "/x/*": { dir, error: () => new Response("custom-404", { status: 404 }), headers: { "x-probe": "1" } } as any } });
const m = await fetch(base2 + s2.port + "/x/missing.txt");
const h = await fetch(base2 + s2.port + "/x/a.txt");
check("P10 dir error/headers options not honored", m.status === 404 && (await m.text()) === "" && h.headers.get("x-probe") === null);
s2.stop(true);

// P11: SPA-fallback nested routes NOT honored (deep path under dir is empty).
const s3 = serve({ port: 0, routes: { "/spa/*": { dir, routes: { "/*": () => new Response("spa-fb") } } as any } });
const deep = await fetch(base2 + s3.port + "/spa/any/deep/route");
const deepBody = await deep.text();
check("P11 SPA-fallback nested routes not honored", deepBody === "" || deepBody.includes("spa-fb") === false, "body=" + deepBody.slice(0, 20));
s3.stop(true);
rmSync(dir, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
console.log("routes:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);
