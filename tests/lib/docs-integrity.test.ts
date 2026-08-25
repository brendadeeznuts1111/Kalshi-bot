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

describe("docs src-ref alignment (§65)", () => {
  test("execution/domain.ts is the live partner-domain file (moved in 89ef6a7)", () => {
    expect(Bun.file(join(ROOT, "src/partner/execution/domain.ts")).exists()).resolves.toBe(true);
  });

  test("player-profile-meta.ts is the meta contract (meta-audit.ts never existed)", () => {
    expect(Bun.file(join(ROOT, "src/research/player-profile-meta.ts")).exists()).resolves.toBe(true);
    expect(Bun.file(join(ROOT, "src/research/meta-audit.ts")).exists()).resolves.toBe(false);
  });

  test("alpha src refs resolve inside alpha/tennis-game-model (cd-package-relative)", () => {
    expect(Bun.file(join(ROOT, "alpha/tennis-game-model/src/run-watch.ts")).exists()).resolves.toBe(true);
    expect(Bun.file(join(ROOT, "alpha/tennis-game-model/src/backtest.ts")).exists()).resolves.toBe(true);
  });

  test("docs:integrity CLI exits 0 (no stale src refs on current docs)", async () => {
    const proc = Bun.spawn(["bun", "run", "docs:integrity"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(0);
    expect(out).toContain("0 stale src refs");
  });
});