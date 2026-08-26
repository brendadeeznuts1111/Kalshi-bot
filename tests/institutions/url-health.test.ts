// @see https://bun.com/docs/test/index#run-tests
// @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
import { describe, expect, test } from "bun:test";
import {
  probeHttp,
  probeKalshiExchange,
  probeOfficialCatalog,
  type UrlHealthReport,
} from "../../src/institutions/url-health.ts";
import { OFFICIAL_URLS, resolveProbeUrl } from "../../src/institutions/official-urls.ts";

describe("url-health", () => {
  test("probeHttp accepts 401 when listed", async () => {
    const odds = resolveProbeUrl(
      "oddsApi",
      "apiBaseV4",
      OFFICIAL_URLS.oddsApi.apiBaseV4,
    )!;
    const r = await probeHttp(odds.url, odds.okStatuses, 12_000);
    expect(r.ok).toBe(true);
    expect([200, 401]).toContain(r.status);
  });

  test("probeKalshiExchange prod is live", async () => {
    const row = await probeKalshiExchange("prod", 12_000);
    expect(row.probeUrl).toContain("/exchange/status");
    expect(row.ok).toBe(true);
    expect(row.status).toBe(200);
    expect(row.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("probeOfficialCatalog returns schema v1 report", async () => {
    // Bounded report retry (same philosophy as probeHttp's network-failure
    // retry, 108): one transient DNS/connection hiccup under parallel load
    // must not fail the live liveness report; a genuinely dead endpoint
    // fails both attempts. The probe itself is unchanged.
    let report: UrlHealthReport | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      report = await probeOfficialCatalog({
        timeoutMs: 12_000,
        includeGlossary: false,
        concurrency: 4,
      });
      if (report.ok && report.failed === 0) break;
    }
    expect(report!.schemaVersion).toBe(1);
    expect(report!.checked).toBeGreaterThan(10);
    expect(report!.skipped).toBeGreaterThanOrEqual(1); // wss
    expect(report!.ok).toBe(true);
    expect(report!.failed).toBe(0);
  }, 60_000);
});