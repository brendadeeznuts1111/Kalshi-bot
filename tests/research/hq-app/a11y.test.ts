// hq-app dashboard a11y pattern (WCAG 2.4.7/2.5.8/4.1.2/4.1.3) — static-file assertions.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const html = readFileSync(join(ROOT, "src/research/hq-app/index.html"), "utf8");
const js = readFileSync(join(ROOT, "src/research/hq-app/app.js"), "utf8");
const css = readFileSync(join(ROOT, "src/research/hq-app/styles.css"), "utf8");

describe("hq-app a11y pattern", () => {
  test("tablist semantics: role=tablist/tab/tabpanel + aria-selected + aria-controls", () => {
    expect(html).toContain('role="tablist" aria-label="Dashboard sections"');
    expect(html).toContain('role="tab" aria-selected="true" aria-controls="tab-overview"');
    expect(html).toContain('role="tab" aria-selected="false" aria-controls="tab-research"');
    expect(html).toContain('role="tabpanel" aria-labelledby="tab-btn-overview"');
    expect(html).toContain('aria-labelledby="tab-btn-ops"');
  });

  test("live regions announce updates (4.1.3): freshness + stamp", () => {
    expect(html).toContain('id="freshness" aria-live="polite"');
    expect(html).toContain('id="stamp" aria-live="polite"');
  });

  test("JS syncs aria-selected on tab switch and adds arrow-key nav (2.4.7/2.4.11)", () => {
    expect(js).toContain('x.setAttribute("aria-selected", on ? "true" : "false")');
    expect(js).toContain('ev.key !== "ArrowLeft" && ev.key !== "ArrowRight"');
    expect(js).toContain('activateTab(next)');
  });

  test("aria-current=page on the matching header nav link (3.2.3)", () => {
    expect(js).toContain('a.setAttribute("aria-current", "page")');
  });

  test("touch target size >= 44px for tabs + nav links (2.5.8 AA)", () => {
    expect(css).toContain("nav.tabs button, header .links a");
    expect(css).toContain("min-height: 2.75rem");
  });

  test("skip link + main landmark (2.4.1)", () => {
    expect(html).toContain('class="skip-link" href="#main-content"');
    expect(html).toContain('<main id="main-content">');
  });

  test("text resizable: no px font-size in hq styles (1.4.4)", () => {
    expect(css).not.toMatch(/font-size: [0-9.]+px/);
  });

  test("markdown/report tables reflow horizontally (1.4.10)", () => {
    const w = readFileSync(join(ROOT, "src/lib/widget-page.ts"), "utf8");
    expect(w).toContain('div.prose table { display: block; max-width: 100%; width: max-content; overflow-x: auto; }');
  });

  test("auto-refresh pause control (2.2.1/2.2.2)", () => {
    expect(html).toContain('id="refresh-toggle" class="refresh-toggle" aria-pressed="false"' );
    expect(js).toContain('refreshToggle.setAttribute("aria-pressed", "true")');
    expect(js).toContain("clearInterval(refreshTimer)");
    expect(js).toContain('refreshToggle.textContent = "Resume updates"');
  });
});
