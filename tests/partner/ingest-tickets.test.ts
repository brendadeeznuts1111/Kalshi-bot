// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  classifyTicketStatus,
  ensurePartnerLedgerSchema,
  sumTicketTotalsForDay,
  writeTicketFromBetGroup,
} from "../../src/partner/ledger.ts";
import { parseBetGroupsResponse } from "../../src/partner/fantasy-ultra/parse.ts";
import {
  formatFinanceCronReportText,
  runFinanceCron,
} from "../../src/partner/finance-cron.ts";
import {
  evaluateRiskHealth,
} from "../../src/partner/risk-health.ts";
import {
  listActiveBettingAccounts,
} from "../../src/partner/registry.ts";
import {
  parsePartnersToml,
  seedRegistryFromPartnersToml,
} from "../../src/partner/toml-config.ts";

const betTicketWire = {
  betGroups: [
    {
      betGroupId: 307200153,
      ticketNumber: 1036636660,
      finalOdds: 1.8928569555282593,
      risk: 68,
      toWin: 60.71,
      result: 0,
      state: 0,
      currency: "USD",
      componentBets: [
        {
          betId: 335749942,
          eventId: 196878741,
          periodId: "m",
          marketId: "3",
          key: "2",
          team1: "A",
          team2: "B",
          finalOdds: 1.89,
          state: 0,
        },
      ],
    },
  ],
  e: 0,
  d: "",
};

const REGISTRY = `
version = 1
[[partners]]
code = "SPEN"
id = "partner-spen"
name = "Partner SPEN"
[[outs]]
id = "out-SPEN-1"
partner_code = "SPEN"
provider = "fantasy402"
env_prefix = "FANTASY402_SPEN_1_"
skins = [{ name = "ezlive", per_bet_max = 500, max_win = 2500, active = true }]
`;

describe("partner ticket ingest + finance totals", () => {
  test("classifyTicketStatus from Fantasy markers", () => {
    expect(classifyTicketStatus({ result: 0, state: 0 })).toBe("open");
    expect(classifyTicketStatus({ isWin: 1 })).toBe("settled");
    expect(classifyTicketStatus({ isWin: 0 })).toBe("settled");
    expect(classifyTicketStatus({ result: 2 })).toBe("settled");
  });

  test("writeTicketFromBetGroup + upsert settlement + day rollup", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    ensurePartnerLedgerSchema(db);
    const { groups } = parseBetGroupsResponse(betTicketWire);
    expect(groups[0]!.result).toBe(0);
    expect(groups[0]!.state).toBe(0);

    const row = writeTicketFromBetGroup(db, {
      outId: "out-SPEN-1",
      partnerId: "partner-spen",
      partnerCode: "SPEN",
      provider: "fantasy402",
      group: groups[0]!,
    });
    expect(row.action).toBe("inserted");
    expect(row.row).not.toBeNull();
    expect(row.row!.amount).toBe(68);
    expect(row.row!.secondaryAmount).toBeCloseTo(60.71, 2);
    const raw = JSON.parse(row.row!.rawJson) as {
      status: string;
      legs: unknown[];
    };
    expect(raw.status).toBe("open");
    expect(raw.legs.length).toBe(1);

    // identical re-ingest → skipped
    const again = writeTicketFromBetGroup(db, {
      outId: "out-SPEN-1",
      partnerId: "partner-spen",
      partnerCode: "SPEN",
      provider: "fantasy402",
      group: groups[0]!,
    });
    expect(again.action).toBe("skipped");

    // settlement markers → updated
    const settledWire = {
      ...betTicketWire,
      betGroups: [
        {
          ...betTicketWire.betGroups[0]!,
          state: 1,
          isWin: 1,
          result: 1,
        },
      ],
    };
    const { groups: settledGroups } = parseBetGroupsResponse(settledWire);
    const upd = writeTicketFromBetGroup(db, {
      outId: "out-SPEN-1",
      partnerId: "partner-spen",
      partnerCode: "SPEN",
      provider: "fantasy402",
      group: settledGroups[0]!,
    });
    expect(upd.action).toBe("updated");
    expect(JSON.parse(upd.row!.rawJson).status).toBe("settled");

    const totals = sumTicketTotalsForDay(db, { partnerCode: "SPEN" });
    expect(totals.ticketCount).toBe(1);
    expect(totals.totalRisk).toBe(68);
    expect(totals.settledCount).toBe(1);
    expect(totals.openCount).toBe(0);
    expect(totals.totalToWin).toBeCloseTo(60.71, 2);
  });

  test("finance-cron report includes open/settled ticket totals", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedRegistryFromPartnersToml(db, parsePartnersToml(REGISTRY));
    const { groups } = parseBetGroupsResponse(betTicketWire);
    writeTicketFromBetGroup(db, {
      outId: "out-SPEN-1",
      partnerId: "partner-spen",
      partnerCode: "SPEN",
      provider: "fantasy402",
      group: groups[0]!,
    });

    const report = await runFinanceCron(db, {
      probeInventory: false,
      probeLogin: false,
      notify: false,
      envMap: {
        FANTASY402_SPEN_1_BEARER_TOKEN: "t",
        FANTASY402_SPEN_1_CUSTOMER_ID: "c",
        FANTASY402_SPEN_1_AGENT_ID: "a",
        FANTASY402_SPEN_1_PASSWORD: "p",
      },
    });
    expect(report.tickets?.ticketCount).toBe(1);
    expect(report.tickets?.openCount).toBe(1);
    expect(report.tickets?.totalRisk).toBe(68);
    const text = formatFinanceCronReportText(report);
    expect(text).toMatch(/tickets today/i);
    expect(text).toMatch(/risk=\$68/);
    expect(text).toMatch(/open=1/);
  });

  test("risk health flags tickets without secrets + open exposure", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedRegistryFromPartnersToml(db, parsePartnersToml(REGISTRY));
    const { groups } = parseBetGroupsResponse(betTicketWire);
    writeTicketFromBetGroup(db, {
      outId: "out-SPEN-1",
      partnerId: "partner-spen",
      partnerCode: "SPEN",
      provider: "fantasy402",
      group: groups[0]!,
    });
    const accounts = listActiveBettingAccounts(db);
    const risk = evaluateRiskHealth(db, accounts, { envMap: {} });
    const codes = risk.findings.map((f) => f.code);
    expect(codes).toContain("tickets_without_secrets");
    expect(codes).toContain("open_ticket_exposure");
  });
});
