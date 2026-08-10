// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  evaluateRiskHealth,
  formatRiskHealthTelegram,
  parseRiskThreshold,
  riskHealthFingerprint,
  riskOkUnderThreshold,
} from "../../src/partner/risk-health.ts";
import { writeDeskSnapshot, writeOddsBookSnapshot } from "../../src/partner/ledger.ts";
import {
  parsePartnersToml,
  seedRegistryFromPartnersToml,
} from "../../src/partner/toml-config.ts";
import { listActiveBettingAccounts } from "../../src/partner/registry.ts";

const SAMPLE = `
version = 1
[[partners]]
code = "SPEN"
id = "partner-spen"
name = "SPEN"
active = true
[[outs]]
id = "out-SPEN-1"
partner_code = "SPEN"
provider = "fantasy402"
env_prefix = "FANTASY402_"
working_balance = 5000
live_products = [
  { name = "ezlive", per_bet_max = 500, max_win = 2500, active = true },
  { name = "dark", per_bet_max = 1000, max_win = 5000, active = true },
]
`;

describe("risk health", () => {
  test("capacity without odds → warn", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedRegistryFromPartnersToml(db, parsePartnersToml(SAMPLE));
    const accounts = listActiveBettingAccounts(db);
    writeDeskSnapshot(db, {
      outId: "out-SPEN-1",
      partnerId: "partner-spen",
      partnerCode: "SPEN",
      provider: "fantasy402",
      totalPerBetMax: 1500,
      workingBalance: 5000,
      envOk: false,
      productCount: 2,
    });
    const report = evaluateRiskHealth(db, accounts, {
      envMap: {},
    });
    expect(
      report.findings.some((f) => f.code === "capacity_without_odds"),
    ).toBe(true);
  });

  test("odds without secrets → error", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedRegistryFromPartnersToml(db, parsePartnersToml(SAMPLE));
    const accounts = listActiveBettingAccounts(db);
    writeOddsBookSnapshot(db, {
      outId: "out-SPEN-1",
      partnerId: "partner-spen",
      partnerCode: "SPEN",
      pricedLines: 58,
      pricedEvents: 3,
    });
    const report = evaluateRiskHealth(db, accounts, { envMap: {} });
    expect(
      report.findings.some((f) => f.code === "odds_without_secrets"),
    ).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.errorCount).toBeGreaterThanOrEqual(1);
  });

  test("risk-threshold error ignores warns for ok/fingerprint", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedRegistryFromPartnersToml(db, parsePartnersToml(SAMPLE));
    const accounts = listActiveBettingAccounts(db);
    // capacity without odds → warn only
    const report = evaluateRiskHealth(db, accounts, { envMap: {} });
    expect(report.warnCount).toBeGreaterThan(0);
    expect(riskOkUnderThreshold(report, "error")).toBe(true);
    expect(riskOkUnderThreshold(report, "warn")).toBe(false);
    const fpWarn = riskHealthFingerprint(report, "warn");
    const fpError = riskHealthFingerprint(report, "error");
    expect(fpWarn).not.toBe(fpError);

    const tg = formatRiskHealthTelegram(report, {
      threshold: "error",
      includeHealthJson: true,
    });
    expect(tg).toContain("health.json:");
    expect(tg).toContain('"threshold":"error"');
  });

  test("parseRiskThreshold", () => {
    expect(parseRiskThreshold("error")).toBe("error");
    expect(parseRiskThreshold("WARNINGS")).toBe("warn");
    expect(parseRiskThreshold("off")).toBe("off");
    expect(parseRiskThreshold(undefined)).toBe("warn");
  });

  test("odds + secrets + capacity → no capacity_without_odds", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedRegistryFromPartnersToml(db, parsePartnersToml(SAMPLE));
    const accounts = listActiveBettingAccounts(db);
    writeOddsBookSnapshot(db, {
      outId: "out-SPEN-1",
      partnerId: "partner-spen",
      partnerCode: "SPEN",
      pricedLines: 10,
      pricedEvents: 2,
    });
    const report = evaluateRiskHealth(db, accounts, {
      envMap: {
        FANTASY402_BEARER_TOKEN: "t",
        FANTASY402_CUSTOMER_ID: "c",
        FANTASY402_AGENT_ID: "a",
        FANTASY402_PASSWORD: "p",
      },
    });
    expect(
      report.findings.some((f) => f.code === "capacity_without_odds"),
    ).toBe(false);
    expect(
      report.findings.some((f) => f.code === "odds_without_secrets"),
    ).toBe(false);
  });
});
