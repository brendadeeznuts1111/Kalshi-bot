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

// ── §177 refactor additions: Blob#image() gotchas + BuildArtifact.image() ──

// P23: BuildArtifact has NO .image() at runtime and is NOT instanceof Blob -
// bun-types says 'extends Blob', but the runtime artifact is Blob-CONFORMANT
// (type-level inheritance does NOT carry to runtime; S01 in BUN_BUILD_FINDINGS).
const artDir = join(dir, 'art');
const artEntry = join(dir, 'art.ts');
writeFileSync(artEntry, 'export const x = 1;\n');
const artRes = await Bun.build({ entrypoints: [artEntry], outdir: artDir });
const art = artRes.outputs[0] as any;
check('P23 BuildArtifact.image() ABSENT (instanceof Blob false)', typeof art.image === 'undefined' && art instanceof Blob === false, 'image=' + typeof art.image + ' isBlob=' + (art instanceof Blob));

// P24: the real Blob#image() / Bun.file().image() surface (where the gotchas live).
const plainBlob = new Blob([readFileSync(SRC)]);
check('P24 Blob#image() + Bun.file().image() exist', typeof (plainBlob as any).image === 'function' && typeof (Bun.file(SRC) as any).image === 'function', 'blob=' + typeof (plainBlob as any).image + ' file=' + typeof (Bun.file(SRC) as any).image);

// P25: format detection is by CONTENT, not extension or Content-Type.
const fakeJpg = join(dir, 'fake.jpg');
writeFileSync(fakeJpg, readFileSync(SRC));
const sniffFile = await (Bun.file(fakeJpg) as any).image().metadata();
const sniffBlob = await (new Blob([readFileSync(SRC)], { type: 'image/jpeg' }) as any).image().metadata();
check('P25 content sniffing (.jpg file + image/jpeg Blob -> png)', sniffFile.format === 'png' && sniffBlob.format === 'png', 'file=' + sniffFile.format + ' blob=' + sniffBlob.format);

// P26: maxPixels decompression-bomb guard - boundary is EXACTLY 2^28 pixels.
const crcTable = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (buf: Uint8Array) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const pngChunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
const mkHugePng = (w: number, h: number) => { const sig = Buffer.from('89504e470d0a1a0a', 'hex'); const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; const idat = Buffer.from('789c63600000020001000a39', 'hex'); return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]); };
const pxCode = async (w: number, h: number) => { try { await new Image(mkHugePng(w, h)).metadata(); return 'OK'; } catch (e) { return (e as any).code; } };
const underCap = await pxCode(16383, 16383);
const atCap = await pxCode(16384, 16384);
const bomb = await pxCode(40000, 40000);
check('P26 maxPixels default 268402689 (16383^2 ok, 16384^2 rejects)', underCap === 'OK' && atCap === 'ERR_IMAGE_TOO_MANY_PIXELS' && bomb === 'ERR_IMAGE_TOO_MANY_PIXELS', '16383^2=' + underCap + ' 16384^2=' + atCap + ' 40000^2=' + bomb);

// P27: lazy pipeline - .image() runs nothing; only terminals decode/throw.
const GARB = join(dir, 'garbage.png');
writeFileSync(GARB, 'not an image');
let lazySurface = false;
try { const im = (Bun.file(GARB) as any).image(); lazySurface = typeof im.resize === 'function' && typeof im.metadata === 'function'; } catch { lazySurface = false; }
let garbCode = '';
try { await (Bun.file(GARB) as any).image().metadata(); } catch (e: any) { garbCode = e.code ?? String(e); }
check('P27 lazy (.image() no-op; terminal throws)', lazySurface && garbCode === 'ERR_IMAGE_UNKNOWN_FORMAT', 'lazy=' + lazySurface + ' terminal=' + garbCode);

// P28: Response(img) - content-type + body; encode runs via terminal.
let ct = ''; let len = 0; let rErr = '';
try { const r = new Response((Bun.file(SRC) as any).image().resize(8, 8).png()); ct = r.headers.get('content-type') ?? 'none'; len = (await r.arrayBuffer()).byteLength; } catch (e: any) { rErr = e.code ?? String(e); }
check('P28 Response(img) content-type + body', ct === 'image/png' && len > 0 && rErr === '', 'ct=' + ct + ' len=' + len + ' err=' + rErr);

// ── §177 refactor: Image constructor gotchas (inputs, buffer guards, maxPixels, autoOrient) ──

// P29: path strings are FILESYSTEM paths - an arbitrary-file-read primitive.
let p29 = '';
try { await new Image(join(dir, 'nope.png')).metadata(); p29 = 'no-error'; } catch (e: any) { p29 = e.code ?? String(e); }
check('P29 path input = filesystem read (ENOENT when missing)', p29 === 'ENOENT', p29);

// P30: SharedArrayBuffer + resizable ArrayBuffer rejected.
const srcBytes = readFileSync(SRC);
const sabU8 = new Uint8Array(new SharedArrayBuffer(srcBytes.length));
sabU8.set(srcBytes);
const resizAB = new ArrayBuffer(srcBytes.length, { maxByteLength: srcBytes.length * 2 });
new Uint8Array(resizAB).set(srcBytes);
const ctorCode = async (input: any, opts?: any): Promise<string> => { try { await new Image(input, opts).metadata(); return 'ok'; } catch (e: any) { return e.code ?? String(e); } };
check('P30 shared + resizable ArrayBuffer rejected', (await ctorCode(sabU8)) === 'ERR_INVALID_ARG_TYPE' && (await ctorCode(resizAB)) === 'ERR_INVALID_ARG_TYPE', 'shared=' + (await ctorCode(sabU8)) + ' resizable=' + (await ctorCode(resizAB)));

// P31: input transferred between ctor and terminal - OBSERVED code deviates from the docs.
const tb = new ArrayBuffer(srcBytes.length);
new Uint8Array(tb).set(srcBytes);
const tImg = new Image(tb);
structuredClone(tb, { transfer: [tb] });
let p31 = '';
try { await tImg.metadata(); p31 = 'ok'; } catch (e: any) { p31 = e.code ?? String(e); }
check('P31 transferred buffer: observed ERR_IMAGE_UNKNOWN_FORMAT (docs say ERR_INVALID_STATE)', p31 === 'ERR_IMAGE_UNKNOWN_FORMAT', p31);

// P32: maxPixels option override is honored.
check('P32 maxPixels option (100: 10x10 ok, 11x11 rejects)', (await ctorCode(mkHugePng(10, 10), { maxPixels: 100 })) === 'ok' && (await ctorCode(mkHugePng(11, 11), { maxPixels: 100 })) === 'ERR_IMAGE_TOO_MANY_PIXELS', '10x10=' + (await ctorCode(mkHugePng(10, 10), { maxPixels: 100 })) + ' 11x11=' + (await ctorCode(mkHugePng(11, 11), { maxPixels: 100 })));

// P33: autoOrient defaults to true - EXIF Orientation=6 applied (2x1 -> 1x2), disabled keeps raw.
const jpeg33 = await new Image(SRC).jpeg({ quality: 90 }).bytes();
const exif33 = Buffer.alloc(6 + 8 + 2 + 12 + 4);
exif33.write('Exif\x00\x00', 0); exif33.write('II', 6); exif33.writeUInt16LE(42, 8); exif33.writeUInt32LE(8, 10); exif33.writeUInt16LE(1, 14); exif33.writeUInt16LE(0x0112, 16); exif33.writeUInt16LE(3, 18); exif33.writeUInt32LE(1, 20); exif33.writeUInt16LE(6, 24); exif33.writeUInt32LE(0, 28);
const app133 = Buffer.alloc(2 + 2 + exif33.length);
app133.writeUInt16BE(0xffe1, 0); app133.writeUInt16BE(2 + exif33.length, 2); exif33.copy(app133, 4);
const exifJpeg = Buffer.concat([jpeg33.subarray(0, 2), app133, jpeg33.subarray(2)]);
const m33d = await new Image(exifJpeg).metadata();
const m33f = await new Image(exifJpeg, { autoOrient: false }).metadata();
check('P33 autoOrient default true (EXIF orientation applied)', m33d.width === 1 && m33d.height === 2 && m33f.width === 2 && m33f.height === 1, 'default=' + m33d.width + 'x' + m33d.height + ' false=' + m33f.width + 'x' + m33f.height);

// ── §177 refactor: Prisma Compute image-transformations claims ──

// P34: withoutEnlargement prevents upscaling; resize(w,h) without fit stretches.
const up34 = await new Image(SRC).resize(800, 600, { withoutEnlargement: true }).png().bytes();
const st34 = await new Image(SRC).resize(800, 600).png().bytes();
const upM34 = await new Image(up34).metadata();
const stM34 = await new Image(st34).metadata();
check('P34 withoutEnlargement (2x1 stays; no-fit stretches to 800x600)', upM34.width === 2 && upM34.height === 1 && stM34.width === 800 && stM34.height === 600, 'with=' + upM34.width + 'x' + upM34.height + ' without=' + stM34.width + 'x' + stM34.height);

// P35: resize(width, undefined, options) - the applyResize helper pattern.
let p35 = '';
try { const b = await new Image(SRC).resize(800, undefined, { fit: 'inside', withoutEnlargement: true, filter: 'lanczos3' }).png().bytes(); const m = await new Image(b).metadata(); p35 = 'ok ' + m.width + 'x' + m.height; } catch (e: any) { p35 = 'ERR ' + (e.code ?? String(e)); }
check('P35 resize(width, undefined, opts) accepted', p35.startsWith('ok'), p35);

// P36: progressive JPEG = multi-scan (SOF2); baseline = SOF0 only.
const hasM = (buf: Uint8Array, marker: number) => { for (let i = 0; i < buf.length - 1; i++) if (buf[i] === 0xff && buf[i + 1] === marker) return true; return false; };
const prog36 = await new Image(SRC).jpeg({ quality: 80, progressive: true }).bytes();
const base36 = await new Image(SRC).jpeg({ quality: 80 }).bytes();
check('P36 progressive JPEG (SOF2) vs baseline (SOF0)', hasM(prog36, 0xc2) && hasM(base36, 0xc0) && !hasM(base36, 0xc2), 'progSOF2=' + hasM(prog36, 0xc2) + ' baseSOF0=' + hasM(base36, 0xc0) + ' baseSOF2=' + hasM(base36, 0xc2));

// P37: palette PNG = indexed colour type 3.
const pal37 = await new Image(SRC).png({ palette: true, colors: 64, dither: true }).bytes();
const plain37 = await new Image(SRC).png().bytes();
check('P37 palette PNG -> color type 3 (plain 6)', pal37[25] === 3 && plain37[25] === 6, 'palette=' + pal37[25] + ' plain=' + plain37[25]);

// P38: Bun.s3 is an S3Client INSTANCE (not callable); Bun.s3.file().image() is the form; crop absent.
const s3Client: any = (Bun as any).s3;
let s3Call = 'callable';
try { (Bun as any).s3('x'); } catch (e: any) { s3Call = 'NOT callable (S3Client instance)'; }
const s3File = s3Client.file('x');
check('P38 Bun.s3 is an S3Client (use .file()); crop absent', s3Call.startsWith('NOT') && typeof s3File.image === 'function' && typeof s3File.write === 'function' && typeof (new Image(SRC) as any).crop === 'undefined', s3Call + ' | file.image=' + typeof s3File.image + ' | crop=' + typeof (new Image(SRC) as any).crop);

console.log("---");
const fails = results.filter((r) => !r.pass);
console.log("image:probe — " + (results.length - fails.length) + "/" + results.length + " pass" + (fails.length ? " · FAIL: " + fails.map((f) => f.name).join(", ") : ""));
rmSync(dir, { recursive: true, force: true });
process.exit(fails.length ? 1 : 0);