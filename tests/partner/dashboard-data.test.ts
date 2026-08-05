// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  PARTNER_OPERATOR_COMMANDS,
  buildPartnerDashboardSnapshot,
  renderPartnerDashboardHtml,
} from "../../src/partner/dashboard-data.ts";
import {
  parsePartnersToml,
  seedRegistryFromPartnersToml,
} from "../../src/partner/toml-config.ts";
import { writeOddsBookSnapshot } from "../../src/partner/ledger.ts";

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
skins = [
  { name = "ezlive", per_bet_max = 500, max_win = 2500, active = true },
]
`;

describe("partner dashboard data", () => {
  test("operator catalog is non-empty and includes bake + serve", () => {
    expect(PARTNER_OPERATOR_COMMANDS.length).toBeGreaterThan(5);
    const cmds = PARTNER_OPERATOR_COMMANDS.map((c) => c.cmd).join("\n");
    expect(cmds).toContain("partner:dashboard");
    expect(cmds).toContain("bun run serve");
  });

  test("snapshot + HTML are secret-safe and include registry outs", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedRegistryFromPartnersToml(db, parsePartnersToml(SAMPLE));
    writeOddsBookSnapshot(db, {
      outId: "out-SPEN-1",
      partnerId: "partner-spen",
      partnerCode: "SPEN",
      pricedLines: 12,
      pricedEvents: 2,
    });

    const snap = await buildPartnerDashboardSnapshot(db, {
      riskThreshold: "warn",
      tomlPath: null,
    });

    expect(snap.registry.activeOuts).toBe(1);
    expect(snap.outs.some((o) => o.id === "out-SPEN-1")).toBe(true);
    expect(snap.commands.length).toBe(PARTNER_OPERATOR_COMMANDS.length);
    // never embed raw secrets
    const blob = JSON.stringify(snap);
    expect(blob).not.toMatch(/Bearer\s+[A-Za-z0-9._-]+/i);
    expect(blob).not.toContain("password");

    const html = renderPartnerDashboardHtml(snap);
    expect(html).toContain("out-SPEN-1");
    expect(html).toContain("partner-dashboard-data");
    expect(html).toContain("bun run partner:dashboard");
  });
});
