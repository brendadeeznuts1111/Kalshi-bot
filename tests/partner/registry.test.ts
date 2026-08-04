// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  computeProviderCapacity,
  ensurePartnerRegistrySchema,
  listActiveBettingAccounts,
  seedFantasy402FromEnv,
  upsertBettingAccount,
  upsertPartner,
} from "../../src/partner/registry.ts";

describe("partner registry", () => {
  test("seed Fantasy402 + capacity sum across accounts", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    ensurePartnerRegistrySchema(db);

    const seeded = seedFantasy402FromEnv(db, {
      FANTASY402_CUSTOMER_ID: "BB55113",
      FANTASY402_AGENT_ID: "BILLY667",
      FANTASY402_MAX_STAKE: "1000",
      FANTASY402_MAX_WIN: "5000",
      FANTASY402_PARTNER_ID: "partner-john",
      FANTASY402_PARTNER_NAME: "John Doe",
    });
    expect(seeded?.id).toBe("BB55113");
    expect(seeded?.maxStake).toBe(1000);
    // no password in meta_json
    expect(seeded?.metaJson).not.toContain("password");
    expect(seeded?.metaJson).not.toContain("token");

    upsertPartner(db, {
      id: "partner-jane",
      name: "Jane",
      active: true,
      profitSplit: 0.5,
      commissionRate: null,
      notes: null,
    });
    upsertBettingAccount(db, {
      id: "BB55114",
      partnerId: "partner-jane",
      provider: "fantasy402",
      url: "https://fantasy402.com",
      status: "active",
      envPrefix: "FANTASY402_B_",
      maxStake: 2000,
      maxWin: 8000,
      currency: "USD",
      skin: 2,
      metaJson: "{}",
    });
    upsertBettingAccount(db, {
      id: "kalshi-1",
      partnerId: "partner-john",
      provider: "kalshi",
      url: "",
      status: "active",
      envPrefix: "KALSHI_",
      maxStake: 500,
      maxWin: 2500,
      currency: "USD",
      skin: null,
      metaJson: "{}",
    });

    const accounts = listActiveBettingAccounts(db);
    expect(accounts.length).toBe(3);
    const cap = computeProviderCapacity(accounts);
    const f402 = cap.find((c) => c.provider === "fantasy402");
    const kalshi = cap.find((c) => c.provider === "kalshi");
    expect(f402?.totalMaxStake).toBe(3000);
    expect(f402?.accountCount).toBe(2);
    expect(kalshi?.totalMaxStake).toBe(500);
  });
});
