// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  PARTNER_DOMAIN_LAYERS,
  PARTNER_NAMING,
  buildDomainStatusReport,
  formatDomainStatusText,
} from "../../src/partner/domain.ts";

describe("partner domain architecture", () => {
  test("five layers with honest maturity counts", () => {
    expect(PARTNER_DOMAIN_LAYERS.map((l) => l.id)).toEqual([
      "partner",
      "communication",
      "accounts",
      "assets",
      "finance",
    ]);
    const report = buildDomainStatusReport();
    expect(report.totals.components).toBeGreaterThan(10);
    expect(report.totals.built).toBeGreaterThan(0);
    expect(report.totals.planned).toBeGreaterThan(0);
    expect(report.orchestration.missingForBotLoop.length).toBeGreaterThan(0);
    expect(PARTNER_NAMING.outIdExample).toBe("out-SPEN-1");
    expect(formatDomainStatusText(report)).toContain("partner domain");
  });
});
