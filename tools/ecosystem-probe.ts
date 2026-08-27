#!/usr/bin/env bun
/**
 * `bun run ecosystem:probe` — the enhanced-ecosystem-diagram claims (§157):
 * enabled-ANSIColors, Image.modulate, bunfig sections ([console]/[dev]/
 * [server]/[serve]/[serve.static]/[install] globalStore), node:http2
 * server push, env-inline placement. Bun 1.4.0.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// P1: Bun.enableANSIColors is a real boolean (theme gating).
check("P1 Bun.enableANSIColors boolean", typeof (Bun as any).enableANSIColors === "boolean", String(typeof (Bun as any).enableANSIColors));

// P2: Bun.Image.prototype has modulate (instance method) + the rest.
const imgMethods = Object.getOwnPropertyNames((Bun.Image as any).prototype);
check("P2 Image.modulate + resize/rotate/flip/flop", imgMethods.includes("modulate") && imgMethods.includes("resize") && imgMethods.includes("rotate") && imgMethods.includes("flip") && imgMethods.includes("flop"), imgMethods.slice(0, 12).join(","));

// P3-P7: bunfig sections — check the installed docs for documented forms.
const bunfigDoc = await Bun.file("node_modules/bun-types/docs/runtime/bunfig.mdx").text();
check("P3 [console] depth documented", /\[console\]/.test(bunfigDoc) && /depth = 3/.test(bunfigDoc), "");
check("P4 install.globalStore documented", /install\.globalStore/.test(bunfigDoc) && /BUN_INSTALL_GLOBAL_STORE/.test(bunfigDoc), "");
check("P5 NO [dev]/[server] bunfig sections (fabricated in the diagram)", !/\[dev\]/.test(bunfigDoc) && !/\[server\]/.test(bunfigDoc) && /\[serve\]/.test(bunfigDoc), "[serve] is the real section");

// P6: node:http2 has NO server push (pushStream undefined).
const http2 = await import("node:http2");
const h2srv = http2.createServer(() => {});
check("P6 node:http2 server push ABSENT", typeof (h2srv as any).pushStream === "undefined", String(typeof (h2srv as any).pushStream));
h2srv.close();

// P7: env inline lives under [serve.static], not top-level.
const htmlDoc = await Bun.file("node_modules/bun-types/docs/bundler/html-static.mdx").text();
const serveStaticEnv = htmlDoc.includes("[serve.static]") && htmlDoc.includes("env = \"PUBLIC_*\"");
check("P7 [serve.static] env is the real config", serveStaticEnv, "");

const failed = results.filter((r) => !r.pass);
console.log("ecosystem:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
