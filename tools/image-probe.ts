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
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { Image } from "bun";
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

// P13: error-code surface (§71) — the doc's ERR_IMAGE_FORMAT_UNSUPPORTED is
// ONLY for platform-unavailable formats; bad input uses DIFFERENT codes.
const codeOf = async (input: Uint8Array): Promise<string> => {
  try { await new (Bun as any).Image(input).metadata(); return "no-error"; }
  catch (e) { return (e as any).code ?? "no-code"; }
};
const garbage = await codeOf(new TextEncoder().encode("not an image"));
check("P13a garbage -> ERR_IMAGE_UNKNOWN_FORMAT", garbage === "ERR_IMAGE_UNKNOWN_FORMAT", garbage);
const truncated = await codeOf(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFElEQVR42mP8z8Dwn4GBgYGJgZGBAQAbYgIBL8f2GQAAAABJRU5ErkJggg==", "base64").subarray(0, 20));
check("P13b truncated -> ERR_IMAGE_DECODE_FAILED", truncated === "ERR_IMAGE_DECODE_FAILED", truncated);
const svg = await codeOf(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"><rect/></svg>"));
check("P13c svg -> ERR_IMAGE_UNKNOWN_FORMAT (no rasterizer §12)", svg === "ERR_IMAGE_UNKNOWN_FORMAT", svg);

// P14: resize signature (§72) — width REQUIRED; null/undefined width THROW.
// The doc assumed resize(null, height) works (Sharp-style) — WRONG on Bun.
const r1 = join(dir, "res-w.png");
await Bun.file(SRC).image().resize(80).png().write(r1);
const mW = await writeMeta(r1);
check("P14a resize(width) auto-height", mW.width === 80 && mW.height === 40, JSON.stringify(mW) + " (2:1 src -> 80x40)");
const th = (fn: () => Promise<unknown>): string => { try { void fn(); return "no-throw"; } catch (e) { return "THREW " + (e as Error).constructor.name; } };
let nullThrew = "no-throw";
try { const f = join(dir, "null.png"); await Bun.file(SRC).image().resize(null as any, 60).png().write(f); } catch (e) { nullThrew = "THREW " + (e as Error).constructor.name; }
check("P14b resize(null, h) THROWS (doc correction)", nullThrew.startsWith("THREW"), nullThrew);
let undefThrew = "no-throw";
try { const f = join(dir, "undef.png"); await Bun.file(SRC).image().resize(undefined as any, 60).png().write(f); } catch (e) { undefThrew = "THREW " + (e as Error).constructor.name; }
check("P14c resize(undefined, h) THROWS (doc correction)", undefThrew.startsWith("THREW"), undefThrew);


// ── §117 additions: pasted API correction fully verified ─────────────

// P15: constructors — new Image(path) and new Image(bytes).
try { await new Image(SRC).bytes(); check("P15a new Image(path) constructor", true); } catch (e) { check("P15a new Image(path) constructor", false, String(e)); }
try { await new Image(readFileSync(SRC) as unknown as Uint8Array).bytes(); check("P15b new Image(bytes) constructor", true); } catch (e) { check("P15b new Image(bytes) constructor", false, String(e)); }

// P16: metadata format value reflects the source.
const metaFmt = (await new Image(SRC).metadata()).format;
check("P16 metadata format reflects source", metaFmt === "png", metaFmt);

// P17: resize single-arg keeps aspect (2x1 -> 10x5).
const rs = await new Image(SRC).resize(10).bytes();
const rsMeta = await new Image(rs).metadata();
check("P17 resize(width) keeps aspect", rsMeta.width === 10 && rsMeta.height === 5, rsMeta.width + "x" + rsMeta.height);

// P18: rotate enforces multiples of 90.
let rotThrew = false;
try { await new Image(SRC).rotate(45).bytes(); } catch { rotThrew = true; }
check("P18 rotate(45) throws (multiples of 90 only)", rotThrew);

// P19: flip and flop both exist.
const flipOk = await new Image(SRC).flip().bytes();
const flopOk = await new Image(SRC).flop().bytes();
check("P19 flip + flop exist", flipOk.length > 0 && flopOk.length > 0);

// P20: modulate brightness/saturation.
try { const mod = await new Image(SRC).modulate({ brightness: 1.2, saturation: 0 }).bytes(); check("P20 modulate works", mod.length > 0); } catch (e) { check("P20 modulate works", false, String(e)); }

// P21: per-format magics — jpeg ffd8, png 0x89, webp lossless VP8L vs lossy VP8.
const j21 = await new Image(SRC).jpeg({ quality: 85 }).bytes();
const p21 = await new Image(SRC).png({ compressionLevel: 6 }).bytes();
const wl21 = new TextDecoder().decode((await new Image(SRC).webp({ lossless: true }).bytes()).slice(0, 16));
const wq21 = new TextDecoder().decode((await new Image(SRC).webp({ quality: 80 }).bytes()).slice(0, 16));
check("P21 per-format magics (jpeg/png/webp lossless+lossy)", j21[0] === 0xff && j21[1] === 0xd8 && p21[0] === 0x89 && wl21.includes("VP8L") && wq21.includes("VP8 "), wl21.slice(4) + "/" + wq21.slice(4));

// P22: extension-inferred format — write(path) without an encode method.
const extPath = join(dir, "out.jpg");
await new Image(SRC).resize(10).write(extPath);
const extBytes = readFileSync(extPath);
check("P22 extension infers format (.jpg -> jpeg)", extBytes[0] === 0xff && extBytes[1] === 0xd8, "no encode method needed");

console.log("---");
const fails = results.filter((r) => !r.pass);
console.log("image:probe — " + (results.length - fails.length) + "/" + results.length + " pass" + (fails.length ? " · FAIL: " + fails.map((f) => f.name).join(", ") : ""));
rmSync(dir, { recursive: true, force: true });
process.exit(fails.length ? 1 : 0);