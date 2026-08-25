// docs:integrity tests (§63) — lock the load-bearing resolution facts the
// gate depends on: cross-file links resolve, same-file anchors use Bun's
// native slugs (NOT GitHub-style --), and repo-root-relative imports.
import { describe, expect, test } from "bun:test";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

describe("docs link anchors (§63)", () => {
  test("Bun native id drops em-dash — the anchor convention the gate enforces", () => {
    const html = Bun.markdown.html("## Quick reference — action thresholds", { headings: { ids: true } });
    expect(html).toContain("id=\"quick-reference-action-thresholds\"");
    expect(html).not.toContain("quick-reference--action-thresholds");
  });

  test("native slug for Bun.markdown heading is single-hyphen (BUN_TECH_STACK fix)", () => {
    const html = Bun.markdown.html("### `Bun.markdown` — native Markdown → HTML / ANSI", { headings: { ids: true } });
    expect(html).toContain("id=\"bunmarkdown-native-markdown-html-ansi\"");
  });
});

describe("docs import resolution (§63)", () => {
  test("repo-root-relative src imports resolve to real files", async () => {
    const targets = [
      join(ROOT, "src/db/client.ts"),
      join(ROOT, "src/institutions/hq-ui.ts"),
      join(ROOT, "src/institutions/filter-catalog.ts"),
    ];
    for (const t of targets) {
      const f = Bun.file(t);
      expect(await f.exists()).toBe(true);
    }
  });

  test("illustrative imports stay unreported (x, m, file:./dep)", () => {
    // These are in ILLUSTRATIVE_IMPORTS — they exist as docs patterns, not files
    expect(Bun.file(join(ROOT, "x.md")).exists()).resolves.toBe(false);
  });
});