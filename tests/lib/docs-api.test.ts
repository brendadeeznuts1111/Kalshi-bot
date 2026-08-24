// docs:api runtime-surface tests (§62) — the load-bearing claims the
// tool's classification depends on: the three real doc bugs it caught
// (Bun.watch / Bun.zstd / Bun.image) and the intentional non-existence
// docs it must NOT flag.
import { describe, expect, test } from "bun:test";

describe("docs:api runtime surface (§62)", () => {
  test("Bun.Image exists (capital class); lowercase Bun.image does NOT", () => {
    expect(typeof Bun.Image).toBe("function");
    expect((Bun as any).image).toBeUndefined();
  });

  test("zstd family: only the *Sync members exist, not Bun.zstd", () => {
    expect(typeof Bun.zstdCompressSync).toBe("function");
    expect(typeof Bun.zstdDecompressSync).toBe("function");
    expect((Bun as any).zstd).toBeUndefined();
  });

  test("Bun.watch does NOT exist (content:watch is the CLI flag)", () => {
    expect((Bun as any).watch).toBeUndefined();
  });

  test("Bun.ffi / Bun.html are intentionally documented as non-existent", () => {
    expect((Bun as any).ffi).toBeUndefined();
    expect((Bun as any).html).toBeUndefined();
  });

  test("readableStreamTo* is a family: real members exist", () => {
    expect(typeof Bun.readableStreamToArrayBuffer).toBe("function");
    expect(typeof Bun.readableStreamToText).toBe("function");
  });

  test("STRICT callability: docs:api exits 0 (no phantom call-sites on 1.4.0)", async () => {
    // The gate runs docs:api with STRICT=1; a call-site on a MISSING token
    // would fail. On the current docs the surface is clean — lock it.
    const proc = Bun.spawn(["bun", "run", "docs:api"], {
      cwd: process.cwd(),
      env: { ...process.env, STRICT: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(0);
    expect(out).toContain("0 genuine drift");
  });
});