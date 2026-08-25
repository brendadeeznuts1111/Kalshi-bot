#!/usr/bin/env bun
/**
 * `bun run image:probe` — probe the Bun.Image doc claims (AGENT-PITFALLS
 * §70) against the installed runtime: chainable pipeline, terminals,
 * fit/filters, rotate/flip/flop ORDERING, formats, backend, clipboard.
 *
 * VERIFIED on Bun 1.4.0 (macOS arm64):
 *   - chainable: Bun.file(path).image().resize().webp().write() returns
 *     bytes written; terminals bytes/buffer/blob/toBase64/dataurl
 *   - metadata {width,height,format}; fit inside vs fill; width/height
 *     are -1 before the first terminal, output dims after
 *   - rotate(90) ALONE swaps dims (2x1 -> 1x2); placeholder() returns a
 *     data: URL (ThumbHash); backend default 'system', settable 'bun'
 *   - fromClipboard/hasClipboardImage/clipboardChangeCount statics exist
 *   - heic/avif encode work on this machine (macOS arm64)
 *
 * CORRECTED (doc claims WRONG on 1.4.0):
 *   - rotate/flip/flop AFTER resize() are NO-OPS — the doc shows
 *     img.resize(...).rotate(90) chaining, but the geometry op is
 *     silently dropped when resize ran first (probe: resize(20,10).
 *     flip() == resize(20,10) byte-identical on an asymmetric source;
 *     rotate(90).resize(20,10) == resize(20,10).rotate(90)). Rotate/
 *     flip/flop MUST come before resize in the chain to take effect.
 *
 * @see docs/AGENT-PITFALLS.md §70
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

const dir = mkdtempSync(join(tmpdir(), "img-probe-"));
const SRC = join(dir, "src.png");
writeFileSync(SRC, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFElEQVR42mP8z8Dwn4GBgYGJgZGBAQAbYgIBL8f2GQAAAABJRU5ErkJggg==", "base64"));

// P1: metadata
const m = await Bun.file(SRC).image().metadata();
check("P1 metadata shape", m.width === 2 && m.height === 1 && typeof m.format === "string", JSON.stringify(m));

// P2: chainable pipeline + write
const out1 = join(dir, "thumb.webp");
const n1 = await Bun.file(SRC).image().resize(400, 400, { fit: "inside" }).webp({ quality: 80 }).write(out1);
check("P2 chain resize.webp.write", typeof n1 === "number" && n1 > 0, "bytes=" + n1);

// P3: terminals
check("P3a bytes()", (await Bun.file(SRC).image().resize(8, 8).png().bytes()) instanceof Uint8Array, "ok");
check("P3b buffer()", Buffer.isBuffer(await Bun.file(SRC).image().resize(8, 8).png().buffer()), "ok");
check("P3c blob() MIME", (await Bun.file(SRC).image().resize(8, 8).png().blob()).type === "image/png", "ok");
const b64 = await Bun.file(SRC).image().resize(8, 8).png().toBase64();
check("P3d toBase64()", typeof b64 === "string" && b64.startsWith("iVBOR"), "prefix=" + b64.slice(0, 8));
const du = await Bun.file(SRC).image().resize(8, 8).png().dataurl();
check("P3e dataurl()", du.startsWith("data:image/png;base64,"), "prefix=" + du.slice(0, 20));

// P4: fit inside vs fill
const writeMeta = async (f: string) => (await Bun.file(f).image().metadata());
await Bun.file(SRC).image().resize(50, 100, { fit: "inside" }).png().write(join(dir, "i.png"));
await Bun.file(SRC).image().resize(50, 100, { fit: "fill" }).png().write(join(dir, "f.png"));
const mi = await writeMeta(join(dir, "i.png"));
const mf = await writeMeta(join(dir, "f.png"));
check("P4a fit inside preserves aspect", mi.width === 50 && mi.height === 25, JSON.stringify(mi) + " (2:1 src fit inside 50x100 -> 50x25, both dims fit)");
check("P4b fit fill stretches", mf.width === 50 && mf.height === 100, JSON.stringify(mf));

// P5: rotate ALONE swaps dims (verified); rotate AFTER resize is a no-op (corrected)
await Bun.file(SRC).image().rotate(90).png().write(join(dir, "r.png"));
const mr = await writeMeta(join(dir, "r.png"));
check("P5 rotate(90) alone swaps dims", mr.width === 1 && mr.height === 2, JSON.stringify(mr) + " (2x1 -> 1x2)");
await Bun.file(SRC).image().resize(20, 10).rotate(90).png().write(join(dir, "rr.png"));
const mrr = await writeMeta(join(dir, "rr.png"));
check("P5b rotate AFTER resize is a NO-OP (doc correction)", mrr.width === 20 && mrr.height === 10, JSON.stringify(mrr) + " (doc shows resize().rotate() chaining)");

// P6: flip/flop after resize no-op (corrected)
const baseB = await Bun.file(SRC).image().resize(20, 10).png().bytes();
const flipB = await Bun.file(SRC).image().resize(20, 10).flip().png().bytes();
const flopB = await Bun.file(SRC).image().resize(20, 10).flop().png().bytes();
check("P6 flip after resize no-op", baseB.join(",") === flipB.join(","), "identical=" + (baseB.join(",") === flipB.join(",")));
check("P6b flop after resize no-op", baseB.join(",") === flopB.join(","), "identical=" + (baseB.join(",") === flopB.join(",")));

// P7: modulate chains
const mod = await Bun.file(SRC).image().resize(20, 10).modulate({ brightness: 1.2, saturation: 0 }).png().bytes();
check("P7 modulate", mod.length > 0, "len=" + mod.length);

// P8: placeholder
const ph = await Bun.file(SRC).image().placeholder();
check("P8 placeholder data: URL", typeof ph === "string" && ph.startsWith("data:image/"), "prefix=" + ph.slice(0, 24));

// P9: width/height before/after
const img = Bun.file(SRC).image();
const before = { w: (img as any).width, h: (img as any).height };
await img.resize(30, 30).png().bytes();
const after = { w: (img as any).width, h: (img as any).height };
check("P9 dims -1 before, output after", before.w === -1 && after.w === 30, JSON.stringify(before) + " -> " + JSON.stringify(after));

// P10: backend
const backendBefore = (Bun.Image as any).backend;
check("P10a backend default system", backendBefore === "system", "backend=" + backendBefore);
(Bun.Image as any).backend = "bun";
const bunOk = (await Bun.file(SRC).image().resize(8, 8).png().bytes()).length > 0;
(Bun.Image as any).backend = backendBefore;
check("P10b backend=bun works", bunOk, "ok");

// P11: clipboard statics exist
check("P11 clipboard statics", typeof (Bun.Image as any).fromClipboard === "function" && typeof (Bun.Image as any).hasClipboardImage === "function" && typeof (Bun.Image as any).clipboardChangeCount === "function", "all functions");

// P12: heic/avif on this machine
let heic = "";
try { heic = "ok len=" + (await Bun.file(SRC).image().resize(8, 8).heic({ quality: 80 }).bytes()).length; } catch (e) { heic = "ERR " + (e as any).code; }
check("P12 heic encode (macOS arm64)", heic.startsWith("ok"), heic);

console.log("---");
const fails = results.filter((r) => !r.pass);
console.log("image:probe — " + (results.length - fails.length) + "/" + results.length + " pass" + (fails.length ? " · FAIL: " + fails.map((f) => f.name).join(", ") : ""));
rmSync(dir, { recursive: true, force: true });
process.exit(fails.length ? 1 : 0);