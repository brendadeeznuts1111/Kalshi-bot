// Artifact interface tests - the uniform contract (src/lib/artifact.ts, §194).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fromBuildOutput, etagFor, responseFor, sha256Hex, fromBunFile } from "../../src/lib/artifact.ts";

describe("BuildArtifact contract", () => {
  test("entry naming [hash] gives a non-null hash (BA-namingHash)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art-"));
    const e = join(dir, "app.ts");
    writeFileSync(e, "export const x = 1;");
    const build = await Bun.build({ entrypoints: [e], outdir: join(dir, "out"), naming: { entry: "[name]-[hash].[ext]" } as any });
    const a = fromBuildOutput(build.outputs[0] as any);
    expect(a.hash).toBeTruthy();
    expect(a.kind).toBe("entry-point");
    expect(a.size).toBeGreaterThan(0);
    expect(a.type).toContain("javascript");
    expect((await a.text()).length).toBeGreaterThan(0);
  });

  test("PINNED: new Response(artifact) sets Content-Type but NOT ETag (BA-response)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art2-"));
    const e = join(dir, "a.ts");
    writeFileSync(e, "const x = 1;");
    const build = await Bun.build({ entrypoints: [e], outdir: join(dir, "o"), naming: { entry: "[name]-[hash].[ext]" } as any });
    const a = fromBuildOutput(build.outputs[0] as any);
    const raw = new Response(build.outputs[0] as any);
    expect(raw.headers.get("content-type")).toContain("javascript");
    expect(raw.headers.get("etag")).toBeNull(); // must set manually
    const withEtag = responseFor(a, { cache: "public, max-age=60" });
    expect(withEtag.headers.get("etag")).toBe('"' + a.hash + '"');
    expect(withEtag.headers.get("cache-control")).toBe("public, max-age=60");
  });

  test("arrayBuffer(): real ArrayBuffer, byteLength === size, Artifact.bytes() matches (BA-arrayBuffer)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art-ab-"));
    const e = join(dir, "app.ts");
    writeFileSync(e, 'export const msg = "héllo → world";');
    const build = await Bun.build({ entrypoints: [e], outdir: join(dir, "out"), naming: { entry: "[name]-[hash].[ext]" } as any });
    const raw = build.outputs[0] as any;
    const a = fromBuildOutput(raw);
    const ab = await raw.arrayBuffer();
    expect(ab instanceof ArrayBuffer).toBe(true);
    expect(ab.byteLength).toBe(a.size); // byteLength === size (S01b)
    expect(new TextDecoder().decode(ab)).toBe(await a.text()); // UTF-8 round-trip (S01b)
    expect(typeof (raw as any).bytes).toBe("undefined"); // phantom on 1.4.0 (BA-methods pin)
    const viaBytes = await a.bytes(); // Artifact.bytes() wraps arrayBuffer()
    expect(viaBytes instanceof Uint8Array).toBe(true);
    expect(viaBytes.length).toBe(a.size);
    expect(viaBytes.join(",")).toBe(new Uint8Array(ab).join(","));
    // binary asset (png) byte path: arrayBuffer preserves the bytes exactly
    const pngPath = join(dir, "pix.png");
    writeFileSync(pngPath, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04]));
    writeFileSync(join(dir, "img.ts"), 'import p from "./pix.png"; export const u = p;');
    const b2 = await Bun.build({ entrypoints: [join(dir, "img.ts")], outdir: join(dir, "out2") });
    const asset = b2.outputs.find((o: any) => o.kind === "asset") as any;
    expect(asset).toBeTruthy();
    const pngAB = await asset.arrayBuffer();
    expect(pngAB.byteLength).toBe(asset.size);
    expect(new Uint8Array(pngAB.slice(0, 4)).join(",")).toBe("137,80,78,71"); // PNG magic
  });

  test("stream(): ReadableStream whose text() equals text(); no #10004 type confusion (BA-stream)", async () => {
    // #10004 regression (fixed by oven-sh/bun#33144, merged 2026-07-01): reading a
    // cached getter (e.g. .kind) before the first .stream() call used to make
    // .stream() return that getter's string instead of a ReadableStream. This
    // runtime (34cbb9a40 >= fix 7f33321f) is probe-locked — the test FAILS on a
    // pre-fix build by design (evidence S01c).
    const dir = mkdtempSync(join(tmpdir(), "art-str-"));
    const e = join(dir, "app.ts");
    writeFileSync(e, 'export const msg = "stream-ok";');
    const build = await Bun.build({ entrypoints: [e], outdir: join(dir, "out") });
    const raw = build.outputs[0] as any;
    const a = fromBuildOutput(raw);
    const kind = raw.kind; // touch the cached getter FIRST — the #10004 trigger
    const s = raw.stream();
    expect(s instanceof ReadableStream).toBe(true);
    expect(await new Response(s).text()).toBe(await a.text()); // real content, not the kind string
    expect(raw.kind).toBe(kind); // stream must not clobber the kind slot
  });

  test("sourcemap: 'linked' nests a sourcemap artifact (BA-sourcemapNested)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art3-"));
    const e = join(dir, "a.ts");
    writeFileSync(e, "const x: number = 1;");
    const build = await Bun.build({ entrypoints: [e], outdir: join(dir, "o"), sourcemap: "linked" as any });
    const a = fromBuildOutput(build.outputs[0] as any);
    expect(a.sourcemap).not.toBeNull();
    expect(a.sourcemap!.kind).toBe("sourcemap");
  });
});

describe("Bun.SHA256 / derived artifacts", () => {
  test("sha256Hex matches the known sha256 digest of 'abc' (BA-sha256)", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("etagFor wraps hash in quotes; null hash -> undefined", () => {
    expect(etagFor({ hash: "abc123" })).toBe('"abc123"');
    expect(etagFor({ hash: null })).toBeUndefined();
  });

  test("fromBunFile wraps a file with a computed hash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "art4-"));
    const f = join(dir, "tile.webp");
    writeFileSync(f, "x");
    const a = await fromBunFile(Bun.file(f), "tile", { computeHash: true });
    expect(a.kind).toBe("tile");
    expect(a.hash).toBe(sha256Hex("x"));
    expect(a.size).toBe(1);
  });
});
