import { describe, expect, test } from "bun:test";

// Probe-locked Bun.Image behavior on Bun 1.4.0 — see docs/BUN_IMAGE.md.
// 16x8 RGB PNG fixture (embedded base64).
const FIXTURE =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAICAIAAAB/FOjAAAABD0lEQVR4nA3OIbbEIAxG4V8+iayMrERWRiKRyMhKZGVkJXJk5EiWkCWwhCyBJbzx93znAkDCHyFlHAyqOAW541LwQDHUieaQhTvQNx6A/hIloiMTMZ2VstDViZXKoGrUJonTvagHPZsU4JT4+LWZT+Zc+RLmzkW5Dm7GMvl27oufYN38AnIkIZIzS2a5qrBI6VJV2hAxuad0l2eJhrxbBqCU9CTNWS/+sVpEa9emKkNv0z71cdWlb+jY+gHsTJbJrmzMVqpVsdZN1O5h3eyZpm7vshH22WaA5+QXOWcv7LV6E/9N3Op9+GOu01/3sfwTbtu/QFwpmKLkqBythkjcPbrGM0It3hnD47PCIr475j+BVaAB5WRosgAAAABJRU5ErkJggg==";

const fixture = () => new Uint8Array(Buffer.from(FIXTURE, "base64"));
const input = () => new Bun.Image(fixture());
const meta = (bytes: Uint8Array) => new Bun.Image(bytes).metadata();
const dims = async (img: any) => {
  const out = await img.png().bytes();
  const m = await meta(out);
  return [m.width, m.height] as const;
};

describe("Bun.Image (Bun 1.4.0)", () => {
  test("metadata() reports width/height/format without decoding", async () => {
    const m = await input().metadata();
    expect(m).toEqual({ width: 16, height: 8, format: "png" });
  });

  test("resize single-arg keeps aspect; two-arg stretches; inside fits", async () => {
    expect(await dims(input().resize(800))).toEqual([800, 400]);
    expect(await dims(input().resize(800, 600))).toEqual([800, 600]);
    expect(await dims(input().resize(800, 600, { fit: "inside" }))).toEqual([800, 400]);
    expect(await dims(input().resize(800, 600, { withoutEnlargement: true }))).toEqual([16, 8]);
  });

  test("all documented filter names are accepted", async () => {
    for (const filter of ["lanczos3", "lanczos2", "mitchell", "cubic", "mks2013", "mks2021", "bilinear", "linear", "box", "nearest"]) {
      expect(await dims(input().resize(400, 200, { filter: filter as any }))).toEqual([400, 200]);
    }
  });

  test("rotate swaps dimensions; only multiples of 90", async () => {
    expect(await dims(input().rotate(90))).toEqual([8, 16]);
    expect(await dims(input().rotate(180))).toEqual([16, 8]);
    expect(() => input().rotate(45)).toThrow(/multiples of 90/);
  });

  test("flip/flop/modulate do not throw", async () => {
    expect(await dims(input().flip())).toEqual([16, 8]);
    expect(await dims(input().flop())).toEqual([16, 8]);
    expect(await dims(input().modulate({ brightness: 1.2, saturation: 0 }))).toEqual([16, 8]);
  });

  test("jpeg/png/webp round-trip with correct output format", async () => {
    expect((await meta(await input().jpeg({ quality: 85 }).bytes())).format).toBe("jpeg");
    expect((await meta(await input().png({ compressionLevel: 6 }).bytes())).format).toBe("png");
    expect((await meta(await input().webp({ quality: 80 }).bytes())).format).toBe("webp");
    expect((await meta(await input().webp({ lossless: true }).bytes())).format).toBe("webp");
  });

  test("indexed PNG palette option is accepted", async () => {
    // Size wins vs truecolor are source-dependent (docs: 3-5x for screenshots);
    // on a 16x8 fixture palette overhead dominates, so only validate the option.
    const indexed = await input().png({ palette: true, colors: 64, dither: true }).bytes();
    expect((await meta(indexed)).format).toBe("png");
    expect(indexed.length).toBeGreaterThan(0);
  });

  test("heic/avif encode on macOS, or ERR_IMAGE_FORMAT_UNSUPPORTED elsewhere", async () => {
    for (const fmt of ["heic", "avif"] as const) {
      try {
        const bytes = await (input() as any)[fmt]({ quality: 80 }).bytes();
        expect((await meta(bytes)).format).toBe(fmt);
      } catch (e: any) {
        expect(e?.code).toBe("ERR_IMAGE_FORMAT_UNSUPPORTED");
      }
    }
  });

  test("terminals: blob MIME, dataurl, write returns bytes", async () => {
    const img = input().resize(400).webp();
    const blob = await img.blob();
    expect(blob.type).toBe("image/webp");
    expect(blob.size).toBeGreaterThan(0);
    expect((await img.dataurl()).startsWith("data:image/webp;base64,")).toBe(true);
    expect((await img.buffer()).constructor.name).toBe("Buffer");
    const n = await img.write("/tmp/kalshi-image-test.webp");
    expect(n).toBe(blob.size);
    expect((await Bun.file("/tmp/kalshi-image-test.webp").size)).toBe(blob.size);
    expect(img.width).toBe(400);
    expect(img.height).toBe(200);
  });

  test("placeholder() returns an inline data URL", async () => {
    const lqip = await input().placeholder();
    expect(lqip.startsWith("data:image/")).toBe(true);
    expect(lqip.length).toBeLessThan(4000);
  });

  test("Blob#image() shorthand works", async () => {
    const m = await new Blob([fixture()]).image().metadata();
    expect(m.format).toBe("png");
  });

  test("backend toggle to 'bun' keeps the pipeline working", async () => {
    const original = (Bun.Image as any).backend;
    try {
      (Bun.Image as any).backend = "bun";
      expect((Bun.Image as any).backend).toBe("bun");
      expect((await input().metadata()).format).toBe("png");
    } finally {
      (Bun.Image as any).backend = original;
    }
  });

  test("Bun.serve routes ':id' param + auto Content-Type", async () => {
    const server = Bun.serve({
      port: 0,
      routes: {
        "/avatar/:id": async (req: any) => {
          const out = await input().resize(64, 64).webp().blob();
          return new Response(out, { headers: { "x-param": String(req.params?.id) } });
        },
      },
    } as any);
    try {
      const r = await fetch("http://127.0.0.1:" + server.port + "/avatar/abc123");
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/webp");
      expect(r.headers.get("x-param")).toBe("abc123");
    } finally {
      server.stop();
    }
  });

  async function rejection(fn: () => unknown): Promise<{ code?: string; message?: string } | null> {
    try { await fn(); return null; } catch (e: any) { return { code: e?.code, message: String(e?.message ?? e) }; }
  }

  test("maxPixels decompression-bomb guard rejects", async () => {
    const err = await rejection(() => new Bun.Image(fixture(), { maxPixels: 100 } as any).metadata());
    expect(err?.code).toBe("ERR_IMAGE_TOO_MANY_PIXELS");
  });

  test("garbage input rejects with ERR_IMAGE_UNKNOWN_FORMAT", async () => {
    const err = await rejection(() => new Bun.Image(new TextEncoder().encode("not an image")).metadata());
    expect(err?.code).toBe("ERR_IMAGE_UNKNOWN_FORMAT");
  });

  test("invalid filter throws at chain time", () => {
    expect(() => input().resize(100, 100, { filter: "bogus" as any })).toThrow(/filter must be one of/);
  });

  test("SharedArrayBuffer / resizable ArrayBuffer input is refused", async () => {
    const err1 = await rejection(() => new Bun.Image(new SharedArrayBuffer(64) as any).metadata());
    expect(String(err1?.message ?? "")).toContain("not supported");
    const resizable = new ArrayBuffer(64, { maxByteLength: 128 });
    const err2 = await rejection(() => new Bun.Image(resizable as any).metadata());
    expect(String(err2?.message ?? "")).toContain("not supported");
  });

  test("format is sniffed from bytes, ignoring file extension", async () => {
    const jpeg = await input().jpeg().bytes();
    const p = "/tmp/kalshi-image-fake.png"; // jpeg bytes under a .png name
    await Bun.write(p, jpeg);
    const m = await new Bun.Image(p).metadata();
    expect(m.format).toBe("jpeg");
  });

  test("no format method reuses the source format", async () => {
    const src = await input().webp().bytes();
    const out = await new Bun.Image(src).bytes();
    expect((await new Bun.Image(out).metadata()).format).toBe("webp");
  });

  test("width/height are -1 before a terminal, output dims after", async () => {
    const img = input().resize(400);
    expect(img.width).toBe(-1);
    expect(img.height).toBe(-1);
    await img.webp().bytes();
    expect(img.width).toBe(400);
    expect(img.height).toBe(200);
  });

  test("concurrent terminals on one pipeline both work", async () => {
    const img = input().resize(400);
    const [a, b] = await Promise.all([img.png().bytes(), img.webp().bytes()]);
    expect((await new Bun.Image(a).metadata()).format).toBe("png");
    expect((await new Bun.Image(b).metadata()).format).toBe("webp");
  });

  test("chains from the same base are independent", async () => {
    const img = input();
    const a = await dims(img.resize(100));
    const b = await dims(img.resize(200));
    expect(a).toEqual([100, 50]);
    expect(b).toEqual([200, 100]);
  });

  test("new Response(img) sets Content-Type automatically", async () => {
    const resp = new Response(input().resize(64).webp() as any);
    expect(resp.headers.get("content-type")).toBe("image/webp");
    const bytes = new Uint8Array(await resp.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  test("write(fd) accepts a raw file descriptor", async () => {
    const { openSync } = await import("node:fs");
    const fd = openSync("/tmp/kalshi-image-fd.png", "w");
    const n = await input().resize(100).png().write(fd as any);
    expect(n).toBeGreaterThan(0);
    expect((await Bun.file("/tmp/kalshi-image-fd.png").size)).toBe(n);
  });

  test("progressive JPEG contains SOF2; baseline contains SOF0", async () => {
    const find = (b: Uint8Array, marker: number) => {
      for (let i = 0; i < b.length - 1; i++) if (b[i] === 255 && b[i + 1] === marker) return i;
      return -1;
    };
    const prog = await input().jpeg({ progressive: true } as any).bytes();
    const base = await input().jpeg().bytes();
    expect(find(prog, 0xc2)).toBeGreaterThanOrEqual(0);
    expect(find(base, 0xc2)).toBeLessThan(0);
    expect(find(base, 0xc0)).toBeGreaterThanOrEqual(0);
  });

  test("indexed PNG emits color-type 3; plain PNG is RGBA (6)", async () => {
    const idx = await input().png({ palette: true, colors: 64 }).bytes();
    const tc = await input().png().bytes();
    expect(idx[25]).toBe(3); // IHDR color type: 8 sig + 4 len + 4 type + 8 w/h + 1 bitdepth
    expect(idx[24]).toBe(8); // bit depth
    expect(tc[25]).toBe(6); // Bun's default PNG is RGBA, not truecolor-2
  });

  test("EXIF orientation is applied by default; autoOrient:false skips it", async () => {
    const jpeg = await input().jpeg().bytes();
    const rest = jpeg.subarray(2); // after SOI
    const restBuf = Buffer.from(rest.buffer, rest.byteOffset, rest.byteLength);
    const exif = Buffer.alloc(6 + 8 + 18);
    exif.write("Exif\0\0", 0, "latin1");
    exif.writeUInt16LE(0x4949, 6);
    exif.writeUInt16LE(42, 8);
    exif.writeUInt32LE(8, 10);
    exif.writeUInt16LE(1, 14);
    exif.writeUInt16LE(0x0112, 16); // Orientation tag
    exif.writeUInt16LE(3, 18); // SHORT
    exif.writeUInt32LE(1, 20);
    exif.writeUInt16LE(6, 24); // Orientation=6 (rotate 90 CW)
    const app1 = Buffer.alloc(4 + exif.length);
    app1.writeUInt16BE(0xffe1, 0);
    app1.writeUInt16BE(exif.length + 2, 2);
    exif.copy(app1, 4);
    const out = Buffer.alloc(2 + app1.length + restBuf.length);
    out.writeUInt16BE(0xffd8, 0);
    app1.copy(out, 2);
    restBuf.copy(out, 2 + app1.length);

    const oriented = new Uint8Array(out);
    const auto = await new Bun.Image(oriented).metadata();
    expect([auto.width, auto.height]).toEqual([8, 16]); // 16x8 rotated by EXIF
    const raw = await new Bun.Image(oriented, { autoOrient: false } as any).metadata();
    expect([raw.width, raw.height]).toEqual([16, 8]);
  });
});
