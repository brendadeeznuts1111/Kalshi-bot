// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  analyzeSource,
  emptyPatternHits,
  formatPatternReportMarkdown,
  formatPatternSummary,
  mergePatternHits,
  pickPatternSliceForComponent,
  selectEvidencePaths,
} from "../src/agent/pattern-extract.ts";
import type { RepoPatternReport } from "../src/agent/pattern-extract.ts";
import type { EvidenceLine } from "../src/research/types.ts";

describe("agent patterns", () => {
  test("analyzeSource detects auth, orders, dry-run, loop", () => {
    const sample = `
      const key = process.env.KALSHI_ACCESS_KEY;
      await client.post('/trade-api/v2/portfolio/orders', {
        side: 'buy', count: 1, price: 50, type: 'limit',
      });
      if (process.env.DRY_RUN === 'true') return;
      ws.onmessage = handler;
    `;
    const hits = analyzeSource(sample);
    expect(hits.auth).toContain("env-secrets");
    expect(hits.auth).toContain("trade-api-v2");
    expect(hits.orders).toContain("order-fields");
    expect(hits.dryRun).toContain("dry-run-default");
    expect(hits.loop).toContain("websocket");
  });

  test("selectEvidencePaths prefers auth/order paths and drops aggregate", () => {
    const lines: EvidenceLine[] = [
      { scope: "line", query: "q1", path: "src/auth.ts", component: "authApi" },
      { scope: "line", query: "q2", path: "src/auth.ts", component: "authApi" },
      { scope: "line", query: "q3", path: "README.md", component: "strategy" },
      { scope: "line", query: "q4", path: "(readme/code aggregate)", component: "orderRealism" },
    ];
    const paths = selectEvidencePaths(lines, 2);
    expect(paths).toEqual(["src/auth.ts", "README.md"]);
  });

  test("mergePatternHits deduplicates labels", () => {
    const a = emptyPatternHits();
    a.auth.push("env-secrets");
    const b = emptyPatternHits();
    b.auth.push("env-secrets", "trade-api-v2");
    const merged = mergePatternHits(a, b);
    expect(merged.auth).toEqual(["env-secrets", "trade-api-v2"]);
  });

  test("formatPatternReportMarkdown includes aggregate and repo sections", () => {
    const md = formatPatternReportMarkdown({
      runId: "test-run",
      generatedAt: "2099-01-01T00:00:00.000Z",
      dimension: "market-making",
      aggregate: { auth: ["env-secrets"] },
      repos: [
        {
          fullName: "owner/repo",
          score: 70,
          verification: "✗ unverified",
          evidencePaths: ["src/main.ts"],
          summary: emptyPatternHits(),
          files: [
            {
              path: "src/main.ts",
              components: ["authApi"],
              hits: { ...emptyPatternHits(), auth: ["env-secrets"] },
              excerpt: "process.env.KALSHI_ACCESS_KEY",
              fetchOk: true,
            },
          ],
        },
      ],
    });
    expect(md).toContain("Aggregate signals");
    expect(md).toContain("owner/repo");
    expect(md).toContain("env-secrets");
  });

  test("pickPatternSliceForComponent prefers authApi evidence file", () => {
    const repoReport: RepoPatternReport = {
      fullName: "owner/repo",
      score: 70,
      verification: "✗ unverified",
      evidencePaths: ["src/auth.ts"],
      summary: {
        ...emptyPatternHits(),
        auth: ["rsa-pss-signing", "kalshi-access-headers"],
      },
      files: [
        {
          path: "README.md",
          components: ["strategy"],
          hits: { ...emptyPatternHits(), auth: ["env-secrets"] },
          excerpt: "readme",
          fetchOk: true,
        },
        {
          path: "src/auth.ts",
          components: ["authApi"],
          hits: {
            ...emptyPatternHits(),
            auth: ["rsa-pss-signing", "kalshi-access-headers"],
          },
          excerpt: "KALSHI-ACCESS-SIGNATURE",
          fetchOk: true,
        },
      ],
    };
    const slice = pickPatternSliceForComponent(repoReport, "authApi");
    expect(slice.file).toBe("src/auth.ts");
    expect(slice.summary).toContain("RSA-PSS");
    expect(slice.excerpt).toContain("KALSHI-ACCESS");
  });

  test("formatPatternSummary maps known labels", () => {
    expect(formatPatternSummary(["rsa-pss-signing", "api-key-file"])).toBe(
      "RSA-PSS, key file",
    );
  });
});
