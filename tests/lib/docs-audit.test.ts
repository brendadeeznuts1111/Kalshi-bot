// Docs managed by Bun.markdown — render contract + unique heading ids.
// @see docs/AGENT-PITFALLS.md §38
import { describe, expect, test } from "bun:test";
import { auditDoc } from "../../src/lib/docs-audit.ts";
import { join } from "node:path";

describe("auditDoc", () => {
  test("renders markdown with unique heading ids", async () => {
    const dir = join(process.cwd(), ".data-tmp-docstest");
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "d.md");
    writeFileSync(p, "# One\n\n## Two\n\n## Two\n"); // duplicate slug
    const audit = await auditDoc(p, "d.md");
    rmSync(dir, { recursive: true, force: true });
    expect(audit.renderOk).toBe(true);
    expect(audit.headings).toBe(3);
    // Native ids dedupe (headings:{ids:true}): "Two" -> "two", "two-1" —
    // so the audit reports NO duplicate slugs for same-text headings.
    expect(audit.duplicateSlugs).toEqual([]);
    expect(audit.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("AGENT-PITFALLS.md renders cleanly (the real doc)", async () => {
    const audit = await auditDoc(join(process.cwd(), "docs/AGENT-PITFALLS.md"), "docs/AGENT-PITFALLS.md");
    expect(audit.renderOk).toBe(true);
    expect(audit.duplicateSlugs).toEqual([]);
    expect(audit.headings).toBeGreaterThan(70);
  });
});