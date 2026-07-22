// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  formatAgentReportMarkdown,
  selectReportDimensions,
} from "../src/agent/agent-report.ts";

describe("agent report", () => {
  test("selectReportDimensions filters architecture slices", () => {
    const file = {
      candidateCap: 100,
      defaultDimension: "all",
      dimensions: {
        all: { label: "All", queries: ["q"] },
        "market-making": { label: "MM", queries: ["q"] },
        tracking: { label: "Track", queries: ["q"] },
        "sports-nfl": { label: "NFL", queries: ["q"] },
      },
    };
    const ids = selectReportDimensions(file).map((d) => d.id);
    expect(ids).toContain("market-making");
    expect(ids).toContain("tracking");
    expect(ids).not.toContain("sports-nfl");
    expect(ids).not.toContain("all");
  });

  test("formatAgentReportMarkdown includes dimension sections", () => {
    const md = formatAgentReportMarkdown({
      generatedAt: "2099-01-01T00:00:00.000Z",
      architectureNotes: ["Composite bot note"],
      dimensions: [
        {
          dimension: "arbitrage",
          label: "Cross-venue arbitrage",
          runId: "run-1",
          generatedAt: "2099-01-01T00:00:00.000Z",
          stats: { discovered: 14, gated: 1, inspected: 1, shortlist: 1 },
          shortlist: [
            {
              fullName: "owner/repo",
              total: 69.5,
              verification: "⚠ watchlist",
              auditTier: "watchlist",
              topPattern: "RSA-PSS, key file",
            },
          ],
          notes: [],
        },
      ],
    });
    expect(md).toContain("Cross-venue arbitrage");
    expect(md).toContain("owner/repo");
    expect(md).toContain("Composite bot note");
  });
});
