#!/usr/bin/env bun
/**
 * bun run etag:probe - Bun's automatic ETag/304 behavior (§176), probing
 * the four documented claims on the pinned 1.4.0:
 *   P1 static routes in Bun.serve (new Response(file.bytes())) get an
 *      ETag + If-None-Match -> 304
 *   P2 fullstack dev server production mode (development: false) adds
 *      Cache-Control + ETag
 *   P3 Bun.build BuildArtifact wrapped in new Response() sets
 *      Content-Type + Etag
 *   P4 S3Client.stat returns the object etag as metadata (type-level;
 *      a live etag value needs a real S3 object)
 * In-process only (no spawn). Own fixture dir (scratch/etag-fixture).
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  - " + detail : "")); };

// Fixture bytes file for the static route probe.
await Bun.write("scratch/etag-fixture/bytes.txt", "etag-probe-bytes");

// P1: static routes - new Response(await file.bytes()).
const srv = Bun.serve({ port: 0, routes: {
  "/bytes": new Response(await Bun.file("scratch/etag-fixture/bytes.txt").bytes()),
  "/plain": new Response("plain-static-response"),
} });
const base = "http://127.0.0.1:" + srv.port;
const b = await fetch(base + "/bytes");
const et = b.headers.get("etag");
check("P1a file.bytes() static route has an ETag", et !== null && et.length > 0, "etag=" + String(et));
const nm = await fetch(base + "/bytes", { headers: { "If-None-Match": String(et) } });
check("P1b If-None-Match match -> 304 on the file route", nm.status === 304, "status=" + nm.status);
const pl = await fetch(base + "/plain");
check("P1c plain static Response has an ETag", pl.headers.get("etag") !== null, "etag=" + String(pl.headers.get("etag")));
srv.stop(true);

// P2: fullstack dev server, production mode (development: false).
await Bun.write("scratch/etag-fixture/index.html", "<!doctype html><h1>etag-probe</h1>");
const page: any = await import("../scratch/etag-fixture/index.html").then((m) => m.default);
const srv2 = Bun.serve({ port: 0, development: false, routes: { "/": page as any } });
const h = await fetch("http://127.0.0.1:" + srv2.port + "/");
check("P2 fullstack dev:false adds ETag + Cache-Control", h.headers.get("etag") !== null && h.headers.get("cache-control") !== null, "etag=" + String(h.headers.get("etag")) + " cache-control=" + String(h.headers.get("cache-control")));
srv2.stop(true);

// P3: Bun.build artifact wrapped in new Response().
await Bun.write("scratch/etag-fixture/input.ts", "export const value = 42;\n");
const built = await Bun.build({ entrypoints: ["scratch/etag-fixture/input.ts"], outdir: "scratch/etag-fixture/out" });
const art = built.outputs[0];
const artResp = new Response(art);
// PIN-NEGATIVE correction (deep-probed on 1.4.0): the docs claim "sets
// Content-Type and Etag" is WRONG - Content-Type is set but Etag is NULL
// at construct time, after body read, served via a handler route, AND as a
// static route value (static values get Last-Modified instead). Also
// BuildArtifact is NOT a Blob (instanceof Blob = false; no .bytes()). If a
// future Bun adds the Etag, these flip FAIL for re-verification.
check("P3 Response(BuildArtifact): Content-Type set, Etag NOT (docs corrected)", artResp.headers.get("content-type") !== null && artResp.headers.get("etag") === null, "content-type=" + String(artResp.headers.get("content-type")) + " etag=" + String(artResp.headers.get("etag")));
await artResp.arrayBuffer();
check("P3a Etag stays null after body read", artResp.headers.get("etag") === null, "etag=" + String(artResp.headers.get("etag")));
check("P3b BuildArtifact is NOT a Blob (docs claim corrected)", (art as any) instanceof Blob === false && typeof (art as any).bytes === "undefined", "instanceof Blob=" + String((art as any) instanceof Blob));
const srv3 = Bun.serve({ port: 0, routes: { "/out.js": new Response(art) } });
const s3resp = await fetch("http://127.0.0.1:" + srv3.port + "/out.js");
check("P3c static route value: Etag null, Last-Modified present", s3resp.headers.get("etag") === null && s3resp.headers.get("last-modified") !== null, "etag=" + String(s3resp.headers.get("etag")) + " lm=" + String(s3resp.headers.get("last-modified")));
srv3.stop(true);

// P4: S3Client.stat - type-level etag metadata; live value needs real S3.
const s3 = new Bun.S3Client({ bucket: "probe", accessKeyId: "k", secretAccessKey: "s" });
const statP = s3.stat("probe.txt");
check("P4 S3Client.stat returns a Promise (etag on live stat)", typeof s3.stat === "function" && statP instanceof Promise, "typeof stat=" + typeof s3.stat);
statP.catch(() => { /* network - expected without real S3 */ });
const BT = "node_modules/bun-types/s3.d.ts";
const s3dts = await Bun.file(BT).text();
check("P4a S3Stats declares etag: string (type-level metadata)", /etag: string/.test(s3dts), "declared in s3.d.ts");

const failed = results.filter((r) => !r.pass);
console.log("etag:probe - " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
