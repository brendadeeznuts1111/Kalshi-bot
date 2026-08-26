// blog-assets mirror manifest hashes validate against the actual files
// (the artifact interface, §194 - manifest-as-artifact pattern).
import { describe, expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/artifact.ts";

describe("blog mirror artifact-manifest", () => {
  test("every manifest hash matches the on-disk file (consumer validation)", async () => {
    const manifest = JSON.parse(await Bun.file("public/blog/index.json").text());
    expect(Object.keys(manifest.hashes).length).toBeGreaterThan(0);
    for (const [f, h] of Object.entries(manifest.hashes as Record<string, string>)) {
      const content = await Bun.file("public/blog/" + f).text();
      expect(sha256Hex(content)).toBe(h);
    }
  });

  test("manifest entryCount matches the blog-map entries", async () => {
    const manifest = JSON.parse(await Bun.file("public/blog/index.json").text());
    const blogMap = JSON.parse(await Bun.file("public/blog/blog-map.json").text());
    expect(manifest.entryCount).toBe(blogMap.entries.length);
  });
});