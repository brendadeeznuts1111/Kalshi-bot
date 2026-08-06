import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { collectDemoEvidence, type DemoProviderEvidenceCapture } from "../../../src/partner/execution/demo-evidence-collector.ts";
import { migrateDemoEvidenceSchema, recordDemoBalanceCheckpoint } from "../../../src/partner/execution/demo-evidence-checkpoint.ts";
import { buildDemoProofArtifact } from "../../../src/partner/execution/demo-proof.ts";
import { runDeterministicDemoScenarios } from "../../../src/partner/execution/demo-scenario-runner.ts";
import { executionIdempotencyKeyToUuid } from "../../../src/partner/execution/kalshi.ts";

const START = Date.parse("2026-08-06T00:00:00.000Z");

function database(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE exposure_reservations (
      id INTEGER PRIMARY KEY, idempotency_key TEXT, partner_code TEXT, out_id TEXT,
      skin TEXT, status TEXT, ticket_id TEXT, effective_stake INTEGER,
      created_at_ms INTEGER, last_reconciliation_at_ms INTEGER
    );
    CREATE TABLE execution_journal_entries (
      id INTEGER PRIMARY KEY, partner_code TEXT, out_id TEXT, skin TEXT,
      kind TEXT, cash_delta_minor INTEGER, created_at_ms INTEGER
    );
    CREATE TABLE account_authorization_receipt_outbox (
      id INTEGER PRIMARY KEY, dedupe_key TEXT, status TEXT, lease_owner TEXT,
      created_at_ms INTEGER, sent_at_ms INTEGER
    );
    CREATE TABLE provider_order_lifecycle (
      id INTEGER PRIMARY KEY, reservation_id INTEGER, ticker TEXT,
      side TEXT, action TEXT, filled_quantity INTEGER, settled_quantity INTEGER,
      last_observed_at_ms INTEGER
    );
  `);
  db.query(`INSERT INTO exposure_reservations VALUES (1, 'request-1', 'SPORTS', 'out-SPORTS-1', 'main', 'confirmed', 'order-1', 50, $created, $reconciled)`).run({ $created: START + 1_000, $reconciled: START + 2_000 });
  db.query(`INSERT INTO exposure_reservations VALUES (2, 'request-2', 'SPORTS', 'out-SPORTS-1', 'alternate', 'confirmed', 'order-2', 50, $created, $reconciled)`).run({ $created: START + 1_100, $reconciled: START + 2_100 });
  for (const [id, kind, cash] of [[1, "reservation", 0], [2, "order", 0], [3, "fill", -50], [4, "cancel", 0]] as const) {
    db.query(`INSERT INTO execution_journal_entries VALUES ($id, 'SPORTS', 'out-SPORTS-1', 'main', $kind, $cash, $created)`).run({ $id: id, $kind: kind, $cash: cash, $created: START + 3_000 + id });
  }
  db.query(`INSERT INTO account_authorization_receipt_outbox VALUES (1, 'execution:1:confirmed', 'sent', NULL, $created, $sent)`).run({ $created: START + 4_000, $sent: START + 5_000 });
  db.query(`INSERT INTO account_authorization_receipt_outbox VALUES (2, 'execution:999:confirmed', 'sent', NULL, $created, $sent)`).run({ $created: START + 4_000, $sent: START + 5_000 });
  db.query(`INSERT INTO provider_order_lifecycle VALUES (1, 1, 'DEMO-MARKET', 'yes', 'buy', 1, 0, $observed)`).run({ $observed: START + 8_000 });
  db.query(`INSERT INTO provider_order_lifecycle VALUES (2, 2, 'DEMO-MARKET', 'yes', 'buy', 1, 0, $observed)`).run({ $observed: START + 8_100 });
  db.query(`INSERT INTO provider_order_lifecycle VALUES (3, 1, 'SETTLED-MARKET', 'yes', 'buy', 1, 1, $observed)`).run({ $observed: START + 8_200 });
  migrateDemoEvidenceSchema(db);
  db.query(`INSERT INTO demo_balance_checkpoints (partner_code, out_id, skin, balance_cents, effective_at_ms, source_sha256, created_at_ms) VALUES ('SPORTS', 'out-SPORTS-1', '*', 10050, $effective, $hash, $created)`).run({ $effective: START, $hash: "d".repeat(64), $created: START });
  return db;
}

function capture(environment: "demo" | "prod" = "demo"): DemoProviderEvidenceCapture {
  const clientOrderId = executionIdempotencyKeyToUuid("request-1");
  const secondClientOrderId = executionIdempotencyKeyToUuid("request-2");
  return {
    environment,
    capturedAtMs: START + 10_000,
    balanceCents: 10_000,
    positions: [{ ticker: "DEMO-MARKET", position: 2 }],
    lifecycle: {
      provider: "kalshi",
      outId: "out-SPORTS-1",
      environment,
      observedAtMs: START + 10_000,
      ordersCursorComplete: true,
      fillsCursorComplete: true,
      orders: [{
        providerOrderId: "order-1", clientOrderId, reservationId: 1 as never,
        ticker: "DEMO-MARKET", side: "yes", action: "buy", unitPriceMinor: 50,
        orderedQuantity: 2, filledQuantity: 1, remainingQuantity: 1,
        status: "working", providerUpdatedAtMs: START + 9_000,
      }, {
        providerOrderId: "order-2", clientOrderId: secondClientOrderId, reservationId: 2 as never,
        ticker: "DEMO-MARKET", side: "yes", action: "buy", unitPriceMinor: 50,
        orderedQuantity: 2, filledQuantity: 1, remainingQuantity: 1,
        status: "working", providerUpdatedAtMs: START + 9_100,
      }],
      fills: [{
        sourceKey: "fill:1", providerOrderId: "order-1", ticker: "DEMO-MARKET",
        side: "yes", action: "buy", quantity: 1, unitPriceMinor: 50,
        feeMinor: 0, providerCreatedAtMs: START + 8_000,
      }, {
        sourceKey: "fill:2", providerOrderId: "order-2", ticker: "DEMO-MARKET",
        side: "yes", action: "buy", quantity: 1, unitPriceMinor: 50,
        feeMinor: 0, providerCreatedAtMs: START + 8_100,
      }],
    },
  };
}

describe("authoritative demo evidence collector", () => {
  test("joins normalized provider capture to scoped SQLite evidence with provenance hashes", async () => {
    const db = database();
    try {
      const scenarios = await runDeterministicDemoScenarios(async () => ({ exitCode: 0, outputSha256: "a".repeat(64) }));
      const input = await collectDemoEvidence({
        db,
        provider: { capture: async () => capture() },
        partnerCode: "SPORTS", outId: "out-SPORTS-1",
        day: "2026-08-06", generatedAtMs: START + 86_400_000,
        unknownResolutionSlaMs: 60_000,
        scenarios: scenarios.scenarios,
        environment: {},
      });
      expect(input.balances).toEqual({ providerBalanceCents: 10_000, localBalanceCents: 10_000 });
      expect(input.reservations.map((row) => row.id)).toEqual([1, 2]);
      expect(input.localPositions).toEqual([{ ticker: "DEMO-MARKET", position: 2 }]);
      expect(input.receipts.map((row) => row.dedupeKey)).toEqual(["execution:1:confirmed"]);
      expect(Object.values(input.provenance).every((value) => /^[a-f0-9]{64}$/.test(value))).toBeTrue();
      expect(input.provenance.scenarioEvidenceSha256).toBe(scenarios.evidenceSha256);
      expect(buildDemoProofArtifact(input).passed).toBeTrue();
    } finally {
      db.close();
    }
  });

  test("refuses production or incomplete provider captures", async () => {
    const db = database();
    const base = {
      db, partnerCode: "SPORTS", outId: "out-SPORTS-1",
      day: "2026-08-06", generatedAtMs: START + 86_400_000,
      unknownResolutionSlaMs: 60_000,
      scenarios: (await runDeterministicDemoScenarios(async () => ({ exitCode: 0, outputSha256: "a".repeat(64) }))).scenarios, environment: {},
    };
    try {
      await expect(collectDemoEvidence({ ...base, provider: { capture: async () => capture("prod") } })).rejects.toThrow(/refuses production/);
      const incomplete = capture();
      incomplete.lifecycle.fillsCursorComplete = false;
      await expect(collectDemoEvidence({ ...base, provider: { capture: async () => incomplete } })).rejects.toThrow(/cursor-complete/);
    } finally {
      db.close();
    }
  });

  test("keeps the signed balance checkpoint immutable", () => {
    const db = database();
    try {
      const same = recordDemoBalanceCheckpoint(db, {
        partnerCode: "SPORTS", outId: "out-SPORTS-1", skin: "*",
        balanceCents: 10_050, effectiveAtMs: START,
        sourceSha256: "d".repeat(64), createdAtMs: START + 1,
      });
      expect(same.balanceCents).toBe(10_050);
      expect(() => recordDemoBalanceCheckpoint(db, {
        partnerCode: "SPORTS", outId: "out-SPORTS-1", skin: "*",
        balanceCents: 9_999, effectiveAtMs: START,
        sourceSha256: "e".repeat(64), createdAtMs: START + 2,
      })).toThrow(/conflicts with immutable/);
    } finally {
      db.close();
    }
  });
});
