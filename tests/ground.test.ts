import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  findStaleUrls,
  resolveToken,
  shapeLookup,
} from "../src/lib/ground.ts";
import { runGroundCheck } from "../tools/ground-check.ts";
import type { GroundManifest } from "../src/lib/ground.ts";

const ROOT = join(import.meta.dir, "..");

describe("ground manifest (generated)", () => {
  let manifest: GroundManifest;

  test("manifest exists and matches pinned bun", async () => {
    manifest = (await Bun.file(join(ROOT, "tools/bun-grounding.json")).json()) as GroundManifest;
    expect(manifest.bunVersion).toBe("1.4.0");
    expect(manifest.generator).toBe("tools/ground-bun.ts");
    expect(manifest.rows.length).toBeGreaterThan(50);
  });

  test("key used symbols have rows with docs + gates", () => {
    const bySymbol = new Map(manifest.rows.map((r) => [r.symbol, r]));
    const file = bySymbol.get("Bun.file");
    expect(file).toBeDefined();
    expect(file!.docsUrl).toContain("bun.com/docs/runtime/file-io");
    expect(file!.gate).toBe("fs:probe");
    expect(file!.probeWired).toBe(true);
    expect(bySymbol.get("Bun.write")!.gate).toBe("fs:probe");
    expect(bySymbol.get("Bun.XML")!.docsUrl).toContain("bun.com/docs/runtime/xml");
    expect(bySymbol.get("Bun.Image")!.docsUrl).toContain("bun.com/docs/runtime/image");
    expect(bySymbol.get("Bun.$")!.gate).toBe("shell:probe");
  });

  test("unknown tokens and stale URLs are clean", () => {
    expect(manifest.unknownTokens).toEqual([]);
    expect(manifest.staleUrlCount).toBe(0);
  });
});

describe("stale-URL detection", () => {
  test("flags the dead /docs/api/ scheme and known 404s", () => {
    expect(findStaleUrls("see https://bun.com/docs/api/fetch")).toEqual(["bun.com/docs/api/"]);
    expect(findStaleUrls("https://bun.com/docs/runtime/bun-secrets")).toHaveLength(1);
    expect(findStaleUrls("https://bun.com/docs/runtime/file-io")).toEqual([]);
    expect(findStaleUrls("https://bun.com/docs/runtime/http/websockets")).toEqual([]);
  });
});

describe("shape resolution", () => {
  test("longest ns.name match, else top-level, else null", async () => {
    const shape = (await Bun.file(join(ROOT, "tools/bun-shape.json")).json()) as any;
    const lookup = shapeLookup(shape);
    const xmlParse = resolveToken("Bun.XML.parse", lookup);
    expect(xmlParse).not.toBeNull();
    expect(xmlParse!.ns).toBe("XML");
    expect(xmlParse!.name).toBe("parse");
    const file = resolveToken("Bun.file", lookup);
    expect(file!.name).toBe("file");
    expect(resolveToken("Bun.NotARealThing", lookup)).toBeNull();
  });
});

describe("ground:check gate", () => {
  test("passes on the clean state (freshness + coverage + probes + URLs)", async () => {
    const report = await runGroundCheck({ root: ROOT });
    expect(report.code).toBe(0);
    expect(report.failures).toEqual([]);
    expect(report.counts.probes).toBeGreaterThan(30);
    expect(report.counts.freshness).toBe(2);
    expect(report.counts.coverage).toBe(2);
    expect(report.counts.urls).toBe(1);
  }, 30000);
});
