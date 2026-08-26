#!/usr/bin/env bun
/**
 * `bun run html:probe` — probe the HTML-import / standalone-HTML /
 * HTMLRewriter surface (§129). Verified against Bun 1.4.0 (34cbb9a40)
 * and the installed bun-types docs (bundler/html-static,
 * bundler/standalone-html, runtime/html-rewriter, guides/runtime/import-html).
 * Self-contained: fixtures are generated into scratch/html-fixture.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

const FIX = "scratch/html-fixture";
await Bun.write(FIX + "/index.html", '<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body><div id="root"></div><img src="./logo.png" alt="logo"><script type="module" src="./app.ts"></script></body></html>');
await Bun.write(FIX + "/style.css", "body { background: #f00; }\n.marker-css { color: blue; }\n");
await Bun.write(FIX + "/app.ts", 'const msg = "HELLO_FROM_APP_TS";\ndocument.getElementById("root")!.textContent = msg;\nconsole.log(msg);\n');
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
await Bun.write(FIX + "/logo.png", Buffer.from(PNG, "base64"));

// Dynamic imports AFTER fixture writes — the gate is self-contained on a
// clean checkout (static imports would resolve before the fixtures exist).
const page: any = (await import("../scratch/html-fixture/index.html")).default;
const rawText: any = (await import("../scratch/html-fixture/index.html", { with: { type: "text" } })).default;
// bun-types types the attribute import as HTMLBundle — cast to the runtime truth (string).
const raw: string = rawText as unknown as string;

// P1: text import (with { type: "text" }) yields the raw HTML string.
check("P1 text import", typeof raw === "string" && raw.startsWith("<!doctype") && raw.includes("<script"), typeof raw + " len=" + raw.length);

// P2: plain .html import is an HTMLBundle with .index (no .files at runtime).
check("P2 HTML import bundle", typeof (page as any).index === "string" && (page as any).files === undefined, "index.len=" + String((page as any).index?.length) + " files=" + typeof (page as any).files);

// P3: Bun.HTMLBundle is interface-only — no runtime global constructor.
check("P3 no Bun.HTMLBundle runtime", typeof (Bun as any).HTMLBundle === "undefined", String(typeof (Bun as any).HTMLBundle));

// P4: compile:true + target:browser -> ONE standalone .html output.
const res = await Bun.build({ entrypoints: [FIX + "/index.html"], compile: true, target: "browser", outdir: "scratch/html-out" });
if (res.success) {
  const paths = res.outputs.map((o: any) => o.path.replace(process.cwd() + "/", ""));
  const html = await res.outputs[0]!.text();
  check("P4 single standalone html", paths.length === 1 && paths[0].endsWith(".html"), JSON.stringify(paths));
  check("P5 everything inlined", html.includes("<style>") && html.includes("<script type=\"module\">") && html.includes("data:image/png;base64,") && html.includes("HELLO_FROM_APP_TS") && html.includes("marker-css") && !/="\.\//.test(html), "len=" + html.length);
} else {
  check("P4 single standalone html", false, JSON.stringify(res.logs));
}

// P6: non-compile html build -> generated js/css/hashed-asset + rewritten html.
const res2 = await Bun.build({ entrypoints: [FIX + "/index.html"], outdir: "scratch/html-out2" });
if (res2.success) {
  const paths2 = res2.outputs.map((o: any) => o.path.replace(process.cwd() + "/", ""));
  const htmlOut = res2.outputs.find((o: any) => o.path.endsWith(".html"));
  const html2 = htmlOut ? await htmlOut.text() : "";
  const kinds = paths2.map((p: string) => p.split(".").pop()).join(",");
  check("P6 html-static outputs", paths2.length >= 3 && kinds.includes("js") && kinds.includes("css") && kinds.includes("png") && kinds.includes("html"), JSON.stringify(paths2));
  check("P6a html rewritten to chunk refs", html2.includes(".js") && html2.includes(".css"), html2.slice(0, 120));
} else {
  check("P6 html-static outputs", false, JSON.stringify(res2.logs));
}

// P7: HTMLRewriter global — string in -> string out; Response in -> Response out.
const RW = (globalThis as any).HTMLRewriter;
check("P7 HTMLRewriter global", typeof RW === "function", String(typeof RW));
if (typeof RW === "function") {
  const rw = new RW().on("*", { element(el: any) { el.tagName = el.tagName.toLowerCase(); }, text(t: any) { t.replace(t.text.toUpperCase()); } });
  const x = rw.transform("<DIV><P>hi</P></DIV>");
  check("P7a string transform", x === "<div><p>HI</p></div>", JSON.stringify(x));
  const rw2 = new RW().on("img", { element(el: any) { el.setAttribute("alt", "probe"); el.before("<a href=\"/x\">", { html: true }); el.after("</a>", { html: true }); } });
  const y = rw2.transform("<img src=\"a.png\">");
  check("P7b element handlers", y === "<a href=\"/x\"><img src=\"a.png\" alt=\"probe\"></a>", JSON.stringify(y));
  const z = new RW().on("h1", { element(el: any) { el.remove(); } }).transform("<h1>gone</h1><p>stay</p>");
  check("P7c selector + remove", z === "<p>stay</p>", JSON.stringify(z));
  const rv = new RW().on("b", { element(el: any) { el.remove(); } }).transform(new Response("<b>x</b><i>y</i>"));
  check("P7d Response in -> Response out", rv instanceof Response && (await rv.text()) === "<i>y</i>", rv.constructor.name);
}

// P8: HTML import as a serve route -> compiled chunks under /_bun/ + dev script.
const server = Bun.serve({ port: 0, routes: { "/": page } as any });
try {
  const resp = await fetch("http://127.0.0.1:" + server.port + "/");
  const body = await resp.text();
  const src = body.match(/<script[^>]*src="([^"]+)"/)?.[1];
  const chunk = src ? await (await fetch("http://127.0.0.1:" + server.port + src)).text() : "";
  check("P8 serve HTML route", resp.status === 200 && String(resp.headers.get("content-type")).includes("text/html") && !!src && chunk.includes("HELLO_FROM_APP_TS"), "ct=" + resp.headers.get("content-type"));
  check("P8a dev-client + beacon injected", body.includes("data-bun-dev-server-script") && body.includes("/_bun/unref"), "assets=" + (body.match(/\/_bun\//g) || []).length);
} catch (e) {
  check("P8 serve HTML route", false, String((e as Error).message));
}
server.stop(true);

const failed = results.filter((r) => !r.pass);
console.log("html:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
