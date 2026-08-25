// Bun.Image pipeline tests (§70) — lock the verified surface incl. the
// geometry-ordering correction (rotate/flip/flop AFTER resize are no-ops).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeSrc(dir: string): string {
  const p = join(dir, "src.png");
  writeFileSync(p, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFElEQVR42mP8z8Dwn4GBgYGJgZGBAQAbYgIBL8f2GQAAAABJRU5ErkJggg==", "base64"));
  return p;
}

describe("Bun.Image pipeline (§70)", () => {
  test("metadata + chainable resize.webp.write", async () => {
    const dir = mkdtempSync(join(tmpdir(), "img-t-"));
    const src = makeSrc(dir);
    const m = await Bun.file(src).image().metadata();
    expect(m.width).toBe(2);
    expect(m.height).toBe(1);
    const n = await Bun.file(src).image().resize(40, 40, { fit: "inside" }).webp({ quality: 80 }).write(join(dir, "t.webp"));
    expect(typeof n).toBe("number");
    expect(n).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
  });

  test("terminals: bytes/buffer/blob/toBase64/dataurl", async () => {
    const dir = mkdtempSync(join(tmpdir(), "img-t2-"));
    const src = makeSrc(dir);
    const bytes = await Bun.file(src).image().resize(8, 8).png().bytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    const buf = await Bun.file(src).image().resize(8, 8).png().buffer();
    expect(Buffer.isBuffer(buf)).toBe(true);
    const blob = await Bun.file(src).image().resize(8, 8).png().blob();
    expect(blob.type).toBe("image/png");
    const b64 = await Bun.file(src).image().resize(8, 8).png().toBase64();
    expect(typeof b64).toBe("string");
    const du = await Bun.file(src).image().resize(8, 8).png().dataurl();
    expect(du.startsWith("data:image/png;base64,")).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("fit inside preserves aspect; fill stretches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "img-t3-"));
    const src = makeSrc(dir); // 2x1
    const inside = join(dir, "i.png");
    const fill = join(dir, "f.png");
    await Bun.file(src).image().resize(50, 100, { fit: "inside" }).png().write(inside);
    await Bun.file(src).image().resize(50, 100, { fit: "fill" }).png().write(fill);
    const mi = await Bun.file(inside).image().metadata();
    const mf = await Bun.file(fill).image().metadata();
    expect(mi).toMatchObject({ width: 50, height: 25 }); // 2:1 inside 50x100
    expect(mf).toMatchObject({ width: 50, height: 100 });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Bun.Image geometry ordering (§70 correction)", () => {
  test("rotate(90) alone swaps dimensions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "img-t4-"));
    const src = makeSrc(dir); // 2x1
    const out = join(dir, "r.png");
    await Bun.file(src).image().rotate(90).png().write(out);
    const m = await Bun.file(out).image().metadata();
    expect(m).toMatchObject({ width: 1, height: 2 });
    rmSync(dir, { recursive: true, force: true });
  });

  test("rotate AFTER resize is a NO-OP (doc correction)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "img-t5-"));
    const src = makeSrc(dir);
    const out = join(dir, "rr.png");
    await Bun.file(src).image().resize(20, 10).rotate(90).png().write(out);
    const m = await Bun.file(out).image().metadata();
    expect(m).toMatchObject({ width: 20, height: 10 }); // rotate dropped
    rmSync(dir, { recursive: true, force: true });
  });

  test("flip/flop AFTER resize produce identical bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "img-t6-"));
    const src = makeSrc(dir);
    const base = await Bun.file(src).image().resize(20, 10).png().bytes();
    const flip = await Bun.file(src).image().resize(20, 10).flip().png().bytes();
    const flop = await Bun.file(src).image().resize(20, 10).flop().png().bytes();
    expect(flip.join(",")).toBe(base.join(","));
    expect(flop.join(",")).toBe(base.join(","));
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Bun.Image misc (§70)", () => {
  test("placeholder() returns a data: URL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "img-t7-"));
    const src = makeSrc(dir);
    const ph = await Bun.file(src).image().placeholder();
    expect(typeof ph).toBe("string");
    expect(ph.startsWith("data:image/")).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("dims are -1 before terminal, output dims after", async () => {
    const dir = mkdtempSync(join(tmpdir(), "img-t8-"));
    const src = makeSrc(dir);
    const img = Bun.file(src).image();
    expect((img as any).width).toBe(-1);
    await img.resize(30, 30).png().bytes();
    expect((img as any).width).toBe(30);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Bun.Image error codes (§71)", () => {
  test("garbage bytes -> ERR_IMAGE_UNKNOWN_FORMAT", async () => {
    let code = "";
    try { await new (Bun as any).Image(new TextEncoder().encode("not an image")).metadata(); }
    catch (e) { code = (e as any).code ?? ""; }
    expect(code).toBe("ERR_IMAGE_UNKNOWN_FORMAT");
  });

  test("truncated PNG -> ERR_IMAGE_DECODE_FAILED", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFElEQVR42mP8z8Dwn4GBgYGJgZGBAQAbYgIBL8f2GQAAAABJRU5ErkJggg==", "base64");
    let code = "";
    try { await new (Bun as any).Image(png.subarray(0, 20)).metadata(); }
    catch (e) { code = (e as any).code ?? ""; }
    expect(code).toBe("ERR_IMAGE_DECODE_FAILED");
  });

  test("SVG -> ERR_IMAGE_UNKNOWN_FORMAT (no rasterizer, §12)", async () => {
    let code = "";
    try { await new (Bun as any).Image(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"><rect/></svg>")).metadata(); }
    catch (e) { code = (e as any).code ?? ""; }
    expect(code).toBe("ERR_IMAGE_UNKNOWN_FORMAT");
  });
});

describe("Bun.Image resize signature (§72)", () => {
  test("resize(width) auto-height preserves aspect (2:1 -> 80x40)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "img-r1-"));
    const src = makeSrc(dir);
    const big = join(dir, "big.png");
    await Bun.file(src).image().resize(40, 20).png().write(big);
    const out = join(dir, "r.png");
    await Bun.file(big).image().resize(80).png().write(out);
    const m = await Bun.file(out).image().metadata();
    expect(m).toMatchObject({ width: 80, height: 40 });
    rmSync(dir, { recursive: true, force: true });
  });

  test("resize(null, h) THROWS — height-only NOT supported (doc correction)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "img-r2-"));
    const src = makeSrc(dir);
    let threw = false;
    try { await Bun.file(src).image().resize(null as any, 60).png().bytes(); } catch { threw = true; }
    expect(threw).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("resize(undefined, h) THROWS — width is required", async () => {
    const dir = mkdtempSync(join(tmpdir(), "img-r3-"));
    const src = makeSrc(dir);
    let threw = false;
    try { await Bun.file(src).image().resize(undefined as any, 60).png().bytes(); } catch { threw = true; }
    expect(threw).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("resize(w, undefined) treats height as omitted (auto)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "img-r4-"));
    const src = makeSrc(dir);
    const out = join(dir, "r.png");
    await Bun.file(src).image().resize(80, undefined as any).png().write(out);
    const m = await Bun.file(out).image().metadata();
    expect(m.width).toBe(80);
    expect(m.height).toBe(40); // 2:1 preserved
    rmSync(dir, { recursive: true, force: true });
  });
});