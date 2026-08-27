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
});
