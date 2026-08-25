#!/usr/bin/env bun
/**
 * `bun run runtime:probe` — runtime misc cluster (§134): env/argv/
 * sleep/version/revision/nanoseconds, peek, readableStreamTo*,
 * ArrayBufferSink, Transpiler, Terminal, WebView. Bun 1.4.0.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

check("P1 env object + round-trip", typeof Bun.env === "object" && typeof Bun.env.PATH === "string", "PATH=" + String(Bun.env.PATH).slice(0, 30));
check("P2 argv", Array.isArray(Bun.argv) && Bun.argv.length >= 1 && typeof Bun.argv[0] === "string", JSON.stringify(Bun.argv.slice(0, 2)));
const t0 = Date.now();
await Bun.sleep(30);
const dt = Date.now() - t0;
check("P3 sleep resolves", dt >= 25 && dt < 2000, dt + "ms");
check("P4 version/revision", /^\d+\.\d+\.\d+/.test(Bun.version) && /^[0-9a-f]{6,}$/.test(Bun.revision), Bun.version + " / " + Bun.revision);
const n1 = Bun.nanoseconds();
const n2 = Bun.nanoseconds();
check("P5 nanoseconds monotonic", typeof n1 === "number" && n2 >= n1, n1 + " -> " + n2);

const pF = Promise.resolve(42);
check("P6 peek fulfilled value", Bun.peek(pF) === 42, String(Bun.peek(pF)));
const pP = new Promise(() => {});
check("P6a peek pending -> promise identity", Bun.peek(pP) === pP, "identity=" + (Bun.peek(pP) === pP));
check("P6b peek.status", Bun.peek.status(pF) === "fulfilled" && Bun.peek.status(pP) === "pending", Bun.peek.status(pF) + "/" + Bun.peek.status(pP));

const ab = await Bun.readableStreamToArrayBuffer(new Response("ab-content").body!);
check("P7 readableStreamToArrayBuffer", new TextDecoder().decode(ab) === "ab-content", new TextDecoder().decode(ab));
const txt = await Bun.readableStreamToText(new Response("text-content").body!);
check("P7a readableStreamToText", txt === "text-content", txt);

const sink = new Bun.ArrayBufferSink();
sink.write("ab");
sink.write("cd");
const out = sink.end();
check("P8 ArrayBufferSink write/end", new TextDecoder().decode(out) === "abcd", new TextDecoder().decode(out as Uint8Array));

const tr = new Bun.Transpiler({ loader: "ts" });
const code = tr.transformSync("const x: number = 1;");
check("P9 Transpiler strips types", typeof code === "string" && code.includes("const x = 1") && !code.includes(": number"), code.trim());
check("P9a Transpiler JSX", typeof new Bun.Transpiler({ loader: "tsx" }).transformSync("const el = <div/>;") === "string", "");

check("P10 Terminal class", typeof Bun.Terminal === "function", typeof Bun.Terminal);

try {
  const v = new (Bun as any).WebView({ width: 200, height: 100 });
  const res = await v.evaluate("1 + 2");
  check("P11 WebView evaluate", res === 3, String(res));
  v.close();
} catch (e) { check("P11 WebView evaluate", false, String((e as Error).message).slice(0, 80)); }

// P12 module imports resolve: bun: + node: compat (objective step 1).
const mods = ["bun:ffi", "bun:sqlite", "node:path", "node:fs", "node:util", "node:os", "node:crypto", "node:tls", "node:net", "node:child_process"];
const modResults: Record<string, string> = {};
for (const m of mods) { try { const mod: any = await import(m); modResults[m] = mod && Object.keys(mod).length > 0 ? "ok" : "empty"; } catch (e) { modResults[m] = "ERR:" + String((e as Error).message).slice(0, 40); } }
const modFail = Object.entries(modResults).filter(([, v]) => v !== "ok");
check("P12 bun:/node: imports resolve", modFail.length === 0, JSON.stringify(modFail));

// P13 sleepSync blocks synchronously (granularity ~100ms on 1.4.0).
const s0 = performance.now();
Bun.sleepSync(30);
const sdt = performance.now() - s0;
check("P13 sleepSync blocks synchronously", typeof Bun.sleepSync === "function" && sdt >= 25 && sdt < 2000, sdt.toFixed(0) + "ms for 30ms request");

// P13a version_with_sha: "v1.4.0 (34cbb9a40)".
const vws = Bun.version_with_sha;
check("P13a version_with_sha", typeof vws === "string" && vws.startsWith("v" + Bun.version) && vws.includes(Bun.revision.slice(0, 9)), String(vws));

// P13b readableStreamToFormData: exists but CANNOT parse a standard
// multipart stream in 1.4.0 (throws for short AND long boundaries; the
// SAME body parses via Response.formData()) - pin-negative: a future
// fix flips this check to FAIL for re-verification.
const LF = String.fromCharCode(10);
const Q = String.fromCharCode(34);
const mkBody = (b: string) => "--" + b + LF + "Content-Disposition: form-data; name=" + Q + "a" + Q + LF + LF + "1" + LF + "--" + b + "--" + LF;
const streamOf = (body: string) => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } });
let parsedOk = false;
try {
  await Bun.readableStreamToFormData(streamOf(mkBody("b1")), "multipart/form-data; boundary=b1");
  parsedOk = true;
} catch { /* expected */ }
check("P13b readableStreamToFormData broken in 1.4.0", parsedOk === false, parsedOk ? "parses OK - behavior CHANGED, re-verify" : "standard multipart throws (same body parses via Response.formData())");
const failed = results.filter((r) => !r.pass);
console.log("runtime:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
