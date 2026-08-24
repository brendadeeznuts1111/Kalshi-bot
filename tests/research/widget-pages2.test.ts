// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { renderUtilitiesPage } from "../../src/research/utilities-page.ts";
import { renderOverviewPage } from "../../src/research/overview-page.ts";
import { renderColorPage } from "../../src/research/color-page.ts";
import { renderLivePage } from "../../src/research/live-page.ts";
import { renderHashingPage } from "../../src/research/hashing-page.ts";
import { renderPruningPage } from "../../src/research/pruning-page.ts";
import { renderSecurityPage } from "../../src/research/security-page.ts";
import { renderSpeedPage } from "../../src/research/speed-page.ts";
import { renderMapPage } from "../../src/research/map-page.ts";
import { renderMarkdownPage } from "../../src/research/markdown-page.ts";
import { renderTranspilerPage } from "../../src/research/transpiler-page.ts";
import { designAgent } from "../../src/agent/design-agent.ts";

describe("utilities + overview widget pages", () => {
  test("both are token-compliant", () => {
    expect(designAgent.audit(renderUtilitiesPage()).issues).toEqual([]);
    expect(designAgent.audit(renderOverviewPage()).issues).toEqual([]);
  });

  test("utilities page lists verified built-ins with probe status", () => {
    const html = renderUtilitiesPage();
    for (const u of ["Bun.JSON5", "Bun.JSONL", "Bun.JSONC", "Bun.XML", "Bun.TOML", "ML-DSA", "Bun.stringWidth", "Bun.SQL", "Bun.Archive"]) {
      expect(html, u).toContain(u);
    }
    expect(html).toContain("verified");
    expect(html).toContain("Bun.Archive"); // present with the write-API note
  });

  test("overview page separates verified from marketing", () => {
    const html = renderOverviewPage();
    expect(html).toContain("1,517"); // the compat-test claim, labeled
    expect(html).toContain("marketing");
    expect(html).toContain("verified");
    expect(html).toContain("15+");
  });

  test("color page is token-compliant (theme is TOKENS-backed)", () => {
    // Probe-table example hexes (#800080 color-mix, #ff0000 hwb, #ff0000aa
    // alpha) are DATA (probe outputs), not UI chrome — allowlisted like the
    // partner-dashboard state.json hexes.
    const legal = ["#800080", "#ff0000", "#ff0000aa"];
    expect(designAgent.audit(renderColorPage(), { legal }).issues).toEqual([]);
  });

  test("color page carries verified + corrected + marketing claims", () => {
    const html = renderColorPage();
    expect(html).toContain("primary");
    expect(html).toContain("ansi-16m");
    expect(html).toContain("corrected"); // luminance/object/array/p3 busted
    expect(html).toContain("verified"); // color-mix, hwb, FORCE_COLOR
    expect(html).toContain("marketing"); // ~100 ns perf claim labeled
    expect(html).toContain("WCAG");
    expect(html).toContain("encodeSolidColorPng");
  });

  test("live page is token-compliant", () => {
    expect(designAgent.audit(renderLivePage()).issues).toEqual([]);
  });

  test("live page carries verified + corrected claims", () => {
    const html = renderLivePage();
    expect(html).toContain("/api/live");
    expect(html).toContain("server.upgrade");
    expect(html).toContain("corrected"); // Bun.SQL=Postgres, markdown options
    expect(html).toContain("verified"); // publish/subscribe, dedup, cron
    expect(html).toContain("bun:sqlite");
  });

  test("hashing page is token-compliant", () => {
    expect(designAgent.audit(renderHashingPage()).issues).toEqual([]);
  });

  test("hashing page corrects Bun.sha + labels the perf claim", () => {
    const html = renderHashingPage();
    expect(html).toContain("SHA-512/256"); // Bun.sha identity correction
    expect(html).toContain("corrected");
    expect(html).toContain("marketing"); // Uint8Array-faster claim labeled
    expect(html).toContain("CryptoHasher");
    expect(html).toContain("If-None-Match");
  });

  test("pruning page is token-compliant", () => {
    expect(designAgent.audit(renderPruningPage()).issues).toEqual([]);
  });

  test("pruning page corrects Bun.rename + documents the matrix", () => {
    const html = renderPruningPage();
    expect(html).toContain("Bun.rename");
    expect(html).toContain("renameSync");
    expect(html).toContain("corrected");
    expect(html).toContain("decision matrix");
    expect(html).toContain(".meta.json");
  });

  test("security page is token-compliant", () => {
    expect(designAgent.audit(renderSecurityPage()).issues).toEqual([]);
  });

  test("security page documents verified TLS + framing claims", () => {
    const html = renderSecurityPage();
    expect(html).toContain("checkServerIdentity");
    expect(html).toContain("ERR_TLS_CERT_ALTNAME_INVALID");
    expect(html).toContain("authorized=false");
    expect(html).toContain("400 Bad Request");
    expect(html).toContain("verified");
  });

  test("speed page is token-compliant", () => {
    expect(designAgent.audit(renderSpeedPage()).issues).toEqual([]);
  });

  test("speed page documents URL perf + build options + test flags", () => {
    const html = renderSpeedPage();
    expect(html).toContain("new URL");
    expect(html).toContain("reactCompiler");
    expect(html).toContain("optimizeImports");
    expect(html).toContain("--shard");
    expect(html).toContain("marketing");
    expect(html).toContain("verified");
  });

  test("map page is token-compliant", () => {
    expect(designAgent.audit(renderMapPage()).issues).toEqual([]);
  });

  test("map page covers all five anchors + integration layers", () => {
    const html = renderMapPage();
    for (const a of ["#faster", "#bun-build", "#bun-test", "#bun-install", "#what-s-new"]) {
      expect(html, a).toContain(a);
    }
    expect(html).toContain("metafile-md");
    expect(html).toContain("channels");
    expect(html).toContain("branding");
    expect(html).toContain("pipeline");
    expect(html).toContain("data");
  });

  test("markdown page is token-compliant", () => {
    expect(designAgent.audit(renderMarkdownPage()).issues).toEqual([]);
  });

  test("markdown page carries verified + corrected API matrix", () => {
    const html = renderMarkdownPage();
    expect(html).toContain("headings");
    expect(html).toContain("x-wikilink");
    expect(html).toContain("listItem");
    expect(html).toContain("corrected"); // no-op options (underline, latexMath…)
    expect(html).toContain("verified");
  });

  test("transpiler page is token-compliant", () => {
    expect(designAgent.audit(renderTranspilerPage()).issues).toEqual([]);
  });

  test("transpiler page separates + highlights every Import.kind", () => {
    const html = renderTranspilerPage();
    for (const k of ["import-statement", "require-call", "require-resolve", "dynamic-import", "import-rule", "url-token", "internal", "entry-point-build"]) {
      expect(html, k).toContain(k);
    }
    expect(html).toContain("corrected"); // require-resolve dropped / CSS kinds bundler-only
    expect(html).toContain("highlighted");
  });
});
