import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeSolidColorPng } from "../../src/partner/visuals.ts";
import { getOptimalQuality, metadataGate } from "../../src/lib/image-quality.ts";

describe("getOptimalQuality (adaptive encode quality from dimensions)", () => {
  test("larger images get lower numeric quality tiers", () => {
    expect(getOptimalQuality({ width: 5000, height: 3000 })).toBe(75); // 15MP
    expect(getOptimalQuality({ width: 2000, height: 2001 })).toBe(80); // ~4MP (strictly > 4M)
    expect(getOptimalQuality({ width: 1200, height: 1000 })).toBe(85); // 1.2MP
    expect(getOptimalQuality({ width: 100, height: 50 })).toBe(90);    // 5k
  });
});

describe("metadataGate (metadata as the cheap decision gate)", () => {
  let dir: string;
  let png: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-gate-"));
    png = join(dir, "solid.png");
    await writeFile(png, encodeSolidColorPng(90, 120, 200, 64));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("metadata() reads the header and the same pipeline can re-encode", async () => {
    const out = await metadataGate(png, async (meta, img) => {
      expect(meta).toMatchObject({ width: 64, height: 64, format: "png" });
      const bytes = await img.resize(32, 32, { fit: "inside" }).png().bytes();
      // Encoded PNG, not raw pixels:
      expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      return bytes.length;
    });
    expect(out).toBeGreaterThan(0);
  });
});
