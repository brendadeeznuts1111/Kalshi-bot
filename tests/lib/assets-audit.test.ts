// Assets gate — content-hashed image verification (§46).
import { describe, expect, test } from "bun:test";
import { extractImageRefs } from "../../src/lib/assets-audit.ts";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { auditMarkdownAssets } from "../../src/lib/assets-audit.ts";

describe("extractImageRefs", () => {
  test("catches markdown ![alt](src) with title", () => {
    const refs = extractImageRefs("![logo](./img/logo.png \"t\")", "a.md");
    expect(refs.some((r) => r.src === "./img/logo.png" && r.kind === "markdown")).toBe(true);
  });
  test("catches HTML <img src> too (the callback misses these)", () => {
    const refs = extractImageRefs('<img src="./b.png" alt="b">', "a.md");
    expect(refs.some((r) => r.src === "./b.png" && r.kind === "html")).toBe(true);
  });
  test("skips remote URLs in the audit (not hashable locally)", () => {
    const refs = extractImageRefs("![r](https://x.com/i.png)", "a.md");
    expect(refs[0]!.src).toBe("https://x.com/i.png");
  });
});

describe("auditMarkdownAssets", () => {
  test("hashes existing images, flags missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "assets-"));
    mkdirSync(join(dir, "img"), { recursive: true });
    writeFileSync(join(dir, "img", "a.png"), "pngbytes");
    const md = join(dir, "post.md");
    writeFileSync(md, "![a](./img/a.png)\n\n![missing](./img/nope.png)\n");
    const { refs } = await auditMarkdownAssets(md, await Bun.file(md).text());
    const a = refs.find((r) => r.src === "./img/a.png");
    const missing = refs.find((r) => r.src === "./img/nope.png");
    rmSync(dir, { recursive: true, force: true });
    expect(a!.audit!.exists).toBe(true);
    expect(a!.audit!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(missing!.audit!.exists).toBe(false);
  });
});