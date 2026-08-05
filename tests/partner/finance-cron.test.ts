// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  formatFinanceCronReportText,
  runFinanceCron,
} from "../../src/partner/finance-cron.ts";
import {
  parsePartnersToml,
  seedRegistryFromPartnersToml,
} from "../../src/partner/toml-config.ts";

const SAMPLE = `
version = 1
[[partners]]
code = "SPEN"
id = "partner-spen"
name = "Partner SPEN"
active = true

[[outs]]
id = "out-SPEN-1"
partner_code = "SPEN"
provider = "fantasy402"
env_prefix = "FANTASY402_"
skins = [
  { name = "ezlive", per_bet_max = 500, max_win = 2500, active = true },
  { name = "dark", per_bet_max = 1000, max_win = 5000, active = true },
]
`;

describe("partner finance-cron", () => {
  test("registry-driven report with env presence and capacity", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedRegistryFromPartnersToml(db, parsePartnersToml(SAMPLE));

    const report = await runFinanceCron(db, {
      probeInventory: false,
      probeLogin: false,
      notify: false,
      envMap: {
        FANTASY402_BEARER_TOKEN: "tok",
        FANTASY402_CUSTOMER_ID: "C1",
        FANTASY402_AGENT_ID: "A1",
        FANTASY402_PASSWORD: "p",
      },
    });

    expect(report.outCount).toBe(1);
    expect(report.partnerCount).toBe(1);
    expect(report.totalCapacity).toBe(1500);
    expect(report.partners[0]?.partnerCode).toBe("SPEN");
    expect(report.partners[0]?.outs[0]?.envOk).toBe(true);
    expect(report.skippedMissingSecrets).toBe(0);
    expect(report.ledgerWrites).toBe(1);
    expect(report.risk).toBeDefined();
    expect(report.riskFingerprint).toBeTruthy();
    expect(formatFinanceCronReportText(report)).toContain("out-SPEN-1");

    const n = (
      db
        .query(
          `SELECT COUNT(*) AS c FROM partner_ledger WHERE kind = 'desk_snapshot'`,
        )
        .get() as { c: number }
    ).c;
    expect(n).toBe(1);

    const riskRows = (
      db
        .query(
          `SELECT COUNT(*) AS c FROM partner_ledger WHERE kind = 'risk_health'`,
        )
        .get() as { c: number }
    ).c;
    expect(riskRows).toBe(1);
  });

  test("risk alert dedupes same fingerprint", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedRegistryFromPartnersToml(db, parsePartnersToml(SAMPLE));
    const envMap = {};
    const r1 = await runFinanceCron(db, {
      probeInventory: false,
      probeLogin: false,
      notify: false,
      riskAlert: true,
      envMap,
    });
    expect(r1.riskAlertDeduped).toBe(false); // first run, no prev
    // second run same state → dedupe (would notify only if telegram env set;
    // fingerprint same ⇒ riskAlertDeduped true when hasIssues)
    const r2 = await runFinanceCron(db, {
      probeInventory: false,
      probeLogin: false,
      notify: false,
      riskAlert: true,
      envMap,
    });
    if ((r2.risk?.errorCount ?? 0) + (r2.risk?.warnCount ?? 0) > 0) {
      expect(r2.riskAlertDeduped).toBe(true);
    }
  });

  test("strict-env throws when secrets missing", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedRegistryFromPartnersToml(db, parsePartnersToml(SAMPLE));
    await expect(
      runFinanceCron(db, {
        strictEnv: true,
        probeInventory: false,
        probeLogin: false,
        notify: false,
        envMap: {},
      }),
    ).rejects.toThrow(/strict-env/);
  });

  test("partner filter", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedRegistryFromPartnersToml(db, parsePartnersToml(SAMPLE));
    const report = await runFinanceCron(db, {
      partnerFilter: "OTHER",
      probeInventory: false,
      notify: false,
      envMap: {},
    });
    expect(report.outCount).toBe(0);
  });
});
