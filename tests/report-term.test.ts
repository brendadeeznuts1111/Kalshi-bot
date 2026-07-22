// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { joinPath } from "../src/research/paths.ts";
import { parseReportTermCli, renderReportTerm } from "../src/agent/report-term.ts";

describe("report-term", () => {
  test("parseReportTermCli defaults to latest.md", () => {
    const opts = parseReportTermCli([]);
    expect(opts.file.endsWith("research/reports/latest.md")).toBe(true);
    expect(opts.raw).toBe(false);
  });

  test("renderReportTerm applies Bun.markdown.ansi", async () => {
    const path = joinPath(import.meta.dir, ".tmp-report.md");
    await Bun.write(path, "# Title\n\n**bold**");
    const ansi = await renderReportTerm({ file: path, raw: false });
    expect(ansi.length).toBeGreaterThan(10);
    expect(ansi).not.toBe("# Title\n\n**bold**");
  });

  test("renderReportTerm raw mode returns file text", async () => {
    const path = joinPath(import.meta.dir, ".tmp-report-raw.md");
    const text = "# Raw\n";
    await Bun.write(path, text);
    const out = await renderReportTerm({ file: path, raw: true });
    expect(out).toBe(text);
  });
});
