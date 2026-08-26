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
