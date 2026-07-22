// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { joinPath, REPORT_DIR } from "../src/research/paths.ts";
import { renderMarkdownBody, readDimensionReportMarkdown } from "../src/agent/dashboard-report.ts";
import { formatRateLimitFootprintLine, readCacheFallbackFootprint } from "../src/agent/dashboard-telemetry.ts";

describe("dashboard-report", () => {
  test("renderMarkdownBody wraps Bun.markdown.html output", () => {
    const html = renderMarkdownBody("# Title\n\nparagraph");
    expect(html).toContain("markdown-body");
    expect(html).toContain("<h1>");
  });

  test("readDimensionReportMarkdown reads latest.md for all dimension", async () => {
    const file = Bun.file(joinPath(REPORT_DIR, "latest.md"));
    if (!(await file.exists())) return;
    const md = await readDimensionReportMarkdown("all");
    expect(md).toBeTruthy();
    expect(md).toContain("#");
  });
});

describe("dashboard-telemetry", () => {
  test("readCacheFallbackFootprint returns counts", () => {
    const footprint = readCacheFallbackFootprint();
    expect(footprint.inspectCacheRepoCount).toBeGreaterThanOrEqual(0);
    expect(typeof footprint.searchCacheAvailable).toBe("boolean");
  });

  test("formatRateLimitFootprintLine handles null", () => {
    expect(formatRateLimitFootprintLine(null)).toContain("unavailable");
  });
});
