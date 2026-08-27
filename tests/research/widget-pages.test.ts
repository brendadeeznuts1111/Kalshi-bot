// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { renderStreamsPage } from "../../src/research/streams-page.ts";
import { renderObservabilityPage } from "../../src/research/observability-page.ts";
import { renderPerformancePage } from "../../src/research/performance-page.ts";
import { designAgent } from "../../src/agent/design-agent.ts";

const pages: Array<[string, () => string]> = [
  ["streams", renderStreamsPage],
  ["observability", renderObservabilityPage],
  ["performance", renderPerformancePage],
];

describe("Bun capability widget pages", () => {
  for (const [name, render] of pages) {
    test(name + " page is token-compliant", () => {
      const a = designAgent.audit(render());
      expect(a.issues, name).toEqual([]);
    });

    // WCAG 2.2 chrome contract — every widget page, not just the report.
    test(name + " page carries the a11y chrome (skip link, main, focus, print)", () => {
      const html = render();
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('class="skip" href="#main"');
      expect(html).toContain('<main id="main">');
      expect(html).toContain("a:focus-visible");
      expect(html).toContain("@media print");
      expect(html).toContain('<th scope="col">');
      expect(html).toContain("tablewrap");
      expect(html).toContain("0.875rem/1.5"); // rem body font (56)
    });
  }

  test("streams page carries verified primitives and marks benchmarks", () => {
    const html = renderStreamsPage();
    expect(html).toContain("Bun.stringWidth");
    expect(html).toContain("CompressionStream");
    expect(html).toContain("marketing");
    expect(html).toContain("verified");
  });

  test("observability page lists the profilers this repo uses", () => {
    const html = renderObservabilityPage();
    expect(html).toContain("--cpu-prof-md");
    expect(html).toContain("--metafile-md");
    expect(html).toContain("memoryPressure");
    expect(html).toContain("Bun.markdown.ansi");
    expect(html).toContain("profile:all");
  });

  test("performance page does not claim marketing numbers as fact", () => {
    const html = renderPerformancePage();
    expect(html).toContain("NOT independently verified");
    expect(html).toContain("marketing");
  });
});
