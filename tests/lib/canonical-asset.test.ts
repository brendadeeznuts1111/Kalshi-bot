// @see https://bun.com/docs/runtime/image
// @see https://bun.com/reference/bun/CryptoHasher
// Locks the canonical-asset contract: byte-deterministic tuples from the same
// inputs, grounded fit set ("inside" | "fill" only — AGENT-PITFALLS §190),
// key-sorted + float-normalized metadata, and digest/hash parity.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { generateCanonicalAsset, normalizeNumbers, sortObjectKeys, type CanonicalAsset } from "../../src/lib/canonical-asset.ts";

const TMP = "/tmp/canonical-asset-test";
const SRC = join(TMP, "src.png");

// 4x4 solid red PNG (valid file, tiny).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR42mNk+M9Qz0AEYBxVSFUAAPwCAmdL0G8AAAAASUVORK5CYII=",
  "base64",
);

beforeAll(async () => {
  rmSync(TMP, { recursive: true, force: true });
  await Bun.write(SRC, PNG);
});
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("generateCanonicalAsset determinism", () => {
  test("same inputs -> byte-identical tuple (hash, digest, metadata, bytes)", async () => {
    const opts = { width: 16, height: 16, fit: "inside", name: "demo", timestamp: 1_700_000_000_000, extra: { x: 0.1 + 0.2 } } as const;
    const a = await generateCanonicalAsset(SRC, opts);
    const b = await generateCanonicalAsset(SRC, opts);
    expect(a.assetHash).toBe(b.assetHash);
    expect(a.metadataDigest).toBe(b.metadataDigest);
    expect(Buffer.from(a.processedImage).equals(Buffer.from(b.processedImage))).toBe(true);
    expect(a.metadata).toEqual(b.metadata);
  });

  test("assetHash is the sha256 of the exact processed bytes (0x-prefixed)", async () => {
    const a = await generateCanonicalAsset(SRC, { width: 8, height: 8, timestamp: 0 });
    const rehash = Bun.CryptoHasher.hash("sha256", a.processedImage, "hex") as string;
    expect(a.assetHash).toBe("0x" + rehash);
    expect(a.metadata.asset_hash).toBe(a.assetHash);
  });

  test("metadataDigest is the sha256 of the exact sorted metadata JSON", async () => {
    const a = await generateCanonicalAsset(SRC, { width: 8, height: 8, timestamp: 0 });
    const rehash = Bun.CryptoHasher.hash("sha256", JSON.stringify(a.metadata), "hex") as string;
    expect(a.metadataDigest).toBe("0x" + rehash);
  });

  test("processed output is a PNG (Bun.Image metadata ground truth)", async () => {
    const a = await generateCanonicalAsset(SRC, { width: 8, height: 8, timestamp: 0 });
    const meta = await new Bun.Image(a.processedImage).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(8);
    expect(meta.height).toBe(8);
  });

  test("missing file throws", async () => {
    expect(generateCanonicalAsset(join(TMP, "nope.png"), {})).rejects.toThrow(/not found/i);
  });
});

describe("fit set is grounded (AGENT-PITFALLS §190)", () => {
  test("inside and fill work", async () => {
    for (const fit of ["inside", "fill"] as const) {
      const a = await generateCanonicalAsset(SRC, { width: 8, height: 8, fit, timestamp: 0 });
      expect(a.processedImage.length).toBeGreaterThan(0);
    }
  });

  test("cover/contain/outside THROW on the runtime (Bun 1.4.0 fit = fill|inside)", async () => {
    for (const fit of ["cover", "contain", "outside"]) {
      expect(async () => {
        await Bun.file(SRC).image().resize(8, 8, { fit: fit as "inside" }).png().bytes();
      }, fit).toThrow(/fit must be one of/);
    }
  });

  test("Bun.file().image() is a sync factory (no await before the terminal)", () => {
    const img = Bun.file(SRC).image();
    expect(img).toBeInstanceOf(Bun.Image);
  });
});

describe("metadata canonicalization", () => {
  test("keys are sorted recursively; JSON is deterministic", async () => {
    const a = await generateCanonicalAsset(SRC, { width: 8, height: 8, timestamp: 0, extra: { zebra: 1, alpha: { y: 1, x: 2 } } });
    const keys = Object.keys(a.metadata);
    expect(keys).toEqual([...keys].sort());
    expect(Object.keys(a.metadata.alpha)).toEqual(["x", "y"]);
  });

  test("float normalization: 0.1+0.2 becomes 0.3 (no FP serialization drift)", async () => {
    const a = await generateCanonicalAsset(SRC, { width: 8, height: 8, timestamp: 0, extra: { price: 0.1 + 0.2 } });
    expect(a.metadata.price).toBe("0.3");
    const ints = await generateCanonicalAsset(SRC, { width: 8, height: 8, timestamp: 0, extra: { count: 42, n: 0.1 + 0.2 } });
    expect(ints.metadata.count).toBe(42); // integers untouched
    expect(ints.metadata.n).toBe("0.3");
  });

  test("normalizeNumbers guards: 1e21 and Infinity pass through (toFixed would throw)", () => {
    expect(normalizeNumbers({ big: 1e21, inf: Infinity, tiny: 0.5 })).toEqual({ big: 1e21, inf: Infinity, tiny: "0.5" });
  });

  test("sortArrays:true orders arrays deterministically (canonical JSON compare)", async () => {
    const a = await generateCanonicalAsset(SRC, { width: 8, height: 8, timestamp: 0, sortArrays: true, extra: { list: [3, 1, 2, { b: 1, a: 2 }, "z"] } });
    expect(a.metadata.list).toEqual([1, 2, 3, "z", { a: 2, b: 1 }]);
  });

  test("timestamp is explicit: epoch-0 warns; passing it keeps the digest stable", async () => {
    const warn = console.warn;
    const warns: string[] = [];
    console.warn = (m: unknown) => warns.push(String(m));
    try {
      const auto = await generateCanonicalAsset(SRC, { width: 8, height: 8 });
      expect(auto.metadata.created_at).toBe(0);
      expect(warns.length).toBeGreaterThan(0);
    } finally {
      console.warn = warn;
    }
    const fixed = await generateCanonicalAsset(SRC, { width: 8, height: 8, timestamp: 123 });
    expect(fixed.metadata.created_at).toBe(123);
    const fixed2 = await generateCanonicalAsset(SRC, { width: 8, height: 8, timestamp: 123 });
    expect(fixed2.metadataDigest).toBe(fixed.metadataDigest);
  });
});

describe("sortObjectKeys", () => {
  test("sorts keys recursively and keeps arrays in order by default", () => {
    expect(sortObjectKeys({ b: { d: 1, c: 2 }, a: [3, 1] })).toEqual({ a: [3, 1], b: { c: 2, d: 1 } });
  });
  test("sortArrays sorts arrays of mixed values deterministically", () => {
    const sorted = sortObjectKeys({ a: [10, "b", 2, { y: 1, x: 2 }] }, true);
    expect(sorted.a).toEqual([2, 10, "b", { x: 2, y: 1 }]);
  });
});