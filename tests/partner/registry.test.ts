// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  computeProviderCapacity,
  concentrationByOut,
  ensurePartnerRegistrySchema,
  listActiveBettingAccounts,
  listEligibleOutSkinPairs,
  pickBestSkinForOut,
  seedFantasy402FromEnv,
  upsertBettingAccount,
  upsertPartner,
} from "../../src/partner/registry.ts";
import {
  buildSkinsMeta,
  liquidityKey,
  parseSkinWire,
} from "../../src/partner/skins.ts";

describe("partner registry", () => {
  test("seed Fantasy402 + capacity sum across accounts (single-skin fallback)", () => {
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
    expect(f402?.skinPairCount).toBe(2);
    expect(kalshi?.totalMaxStake).toBe(500);
  });

  test("multi-skin out capacity sums perBetMax across skins", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    ensurePartnerRegistrySchema(db);

    const seeded = seedFantasy402FromEnv(db, {
      FANTASY402_CUSTOMER_ID: "BB55113",
      FANTASY402_AGENT_ID: "BILLY667",
      FANTASY402_PARTNER_CODE: "SPEN",
      FANTASY402_ACCOUNT_ID: "out-SPEN-1",
      FANTASY402_WORKING_BALANCE: "5000",
      FANTASY402_SKINS_JSON: JSON.stringify([
        { name: "ezlive", perBetMax: 500, maxWin: 2500 },
        { name: "dark", perBetMax: 1000, maxWin: 5000 },
      ]),
    });
    expect(seeded?.id).toBe("out-SPEN-1");
    expect(seeded?.maxStake).toBe(1000); // max of skins
    expect(seeded?.metaJson).toContain("ezlive");
    expect(seeded?.metaJson).toContain("dark");

    upsertPartner(db, {
      id: "partner-ash",
      name: "ASH",
      active: true,
      profitSplit: null,
      commissionRate: null,
      notes: null,
    });
    upsertBettingAccount(db, {
      id: "out-ASH-1",
      partnerId: "partner-ash",
      provider: "fantasy402",
      url: "https://fantasy402.com",
      status: "active",
      envPrefix: "FANTASY402_ASH_",
      maxStake: 300,
      maxWin: 1500,
      currency: "USD",
      skin: null,
      metaJson: buildSkinsMeta({
        skins: [
          { name: "ezlive", perBetMax: 300, maxWin: 1500, active: true },
        ],
        workingBalance: 2000,
        partnerCode: "ASH",
      }),
    });

    const accounts = listActiveBettingAccounts(db);
    const cap = computeProviderCapacity(accounts);
    const f402 = cap.find((c) => c.provider === "fantasy402");
    // SPEN 500+1000 + ASH 300 = 1800
    expect(f402?.totalMaxStake).toBe(1800);
    expect(f402?.skinPairCount).toBe(3);
    expect(f402?.accountCount).toBe(2);

    const spen = f402?.outs.find((o) => o.outId === "out-SPEN-1");
    expect(spen?.totalPerBetMax).toBe(1500);
    expect(spen?.workingBalance).toBe(5000);
    expect(spen?.skins.map((s) => s.name).sort()).toEqual(["dark", "ezlive"]);
  });

  test("eligible pairs + pickBestSkin + concentration by out", () => {
    const accounts = [
      {
        id: "out-SPEN-1",
        partnerId: "partner-spen",
        provider: "fantasy402" as const,
        maxStake: 1000,
        maxWin: 5000,
        skin: null as number | null,
        status: "active" as const,
        metaJson: buildSkinsMeta({
          skins: [
            { name: "ezlive", perBetMax: 500, maxWin: 2500, active: true },
            { name: "dark", perBetMax: 1000, maxWin: 5000, active: true },
          ],
          workingBalance: 5000,
        }),
      },
      {
        id: "out-ASH-1",
        partnerId: "partner-ash",
        provider: "fantasy402" as const,
        maxStake: 300,
        maxWin: 1500,
        skin: null as number | null,
        status: "active" as const,
        metaJson: buildSkinsMeta({
          skins: [
            { name: "ezlive", perBetMax: 300, maxWin: 1500, active: true },
          ],
          workingBalance: 2000,
        }),
      },
    ];

    const for800 = listEligibleOutSkinPairs(accounts, 800);
    expect(for800.map((p) => p.key)).toEqual(["out-SPEN-1@dark"]);
    expect(liquidityKey("out-SPEN-1", "dark")).toBe("out-SPEN-1@dark");

    const for200 = listEligibleOutSkinPairs(accounts, 200);
    expect(for200.length).toBe(3);

    const best = pickBestSkinForOut(
      [
        { name: "ezlive", perBetMax: 500, maxWin: 2500, active: true },
        { name: "dark", perBetMax: 1000, maxWin: 5000, active: true },
      ],
      400,
    );
    expect(best?.name).toBe("dark");

    const conc = concentrationByOut([
      { outId: "out-SPEN-1", amount: 300 },
      { outId: "out-SPEN-1", amount: 200 }, // same out, second skin
      { outId: "out-ASH-1", amount: 100 },
    ]);
    expect(conc[0]?.outId).toBe("out-SPEN-1");
    expect(conc[0]?.exposure).toBe(500);
    expect(conc[0]?.share).toBeCloseTo(500 / 600, 5);
  });

  test("parseSkinWire keeps named skins as strings", () => {
    expect(parseSkinWire("ezlive")).toBe("ezlive");
    expect(parseSkinWire("2")).toBe(2);
    expect(parseSkinWire(2)).toBe(2);
    expect(parseSkinWire(undefined)).toBe(2);
  });
});
