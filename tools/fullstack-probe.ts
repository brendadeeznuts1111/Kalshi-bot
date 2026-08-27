#!/usr/bin/env bun
/**
 * `bun run fullstack:probe` — the fullstack combo (§162): HTML imports
 * + method-keyed API routes + :id params + development mode in ONE
 * Bun.serve (the repo hq-app serving pattern), plus the WebSocket
 * permessage-deflate option surface.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// Fixture HTML for the import route.
// Own fixture dir — scratch/html-fixture belongs to html:probe (§129).
await Bun.write("scratch/fullstack-fixture/index.html", '<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body><div id="root"></div><script type="module" src="./app.ts"></script></body></html>');
await Bun.write("scratch/fullstack-fixture/style.css", "body { color: red; }\n");
await Bun.write("scratch/fullstack-fixture/app.ts", 'document.getElementById("root")!.textContent = "hi";\n');
const page: any = await import("../scratch/fullstack-fixture/index.html").then((m) => m.default);

// P1: HTML import + API routes + :id params + development in one serve.
const srv = Bun.serve({ port: 0, development: true, routes: {
  "/": page as any,
  "/api/users": {
    GET: () => new Response("users-list"),
    POST: async (req: Request) => new Response("post:" + await req.text()),
  },
  "/api/users/:id": (req: any) => new Response("user:" + req.params.id),
} });
const base = "http://127.0.0.1:" + srv.port;
const home = await (await fetch(base + "/")).text();
const get = await (await fetch(base + "/api/users")).text();
const post = await (await fetch(base + "/api/users", { method: "POST", body: "x" })).text();
const param = await (await fetch(base + "/api/users/42")).text();
check("P1 fullstack combo", home.includes("<!doctype") && get === "users-list" && post === "post:x" && param === "user:42", "get=" + get + " param=" + param);
srv.stop(true);

// P2: WebSocket permessage-deflate option — boolean, default true (the
// upgrade advertises permessage-deflate; client_max_window_bits). The
// diagram's extensions-object form is NOT the documented API.
const BT = "node_modules/bun-types/bun.d.ts";
const bd = await Bun.file(BT).text();
check("P2 perMessageDeflate typed boolean default true", bd.includes("perMessageDeflate?: boolean") && bd.includes("permessage-deflate; client_max_window_bits") && bd.includes("@default true"), "");
let extErr = "accepted";
try { new (WebSocket as any)("ws://127.0.0.1:1/", undefined, { extensions: { permessageDeflate: {} } }); } catch (e) { extErr = "throws"; }
check("P2a extensions-object form not rejected (older shape)", extErr === "accepted", extErr);

const failed = results.filter((r) => !r.pass);
console.log("fullstack:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
