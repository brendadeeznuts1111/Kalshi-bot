import { describe, expect, test } from "bun:test";
import {
  buildDemoProofArtifact,
  demoProofJson,
  demoProofMarkdown,
  type DemoProofInput,
} from "../../../src/partner/execution/demo-proof.ts";

function input(): DemoProofInput {
  return {
    environment: "demo",
    day: "2026-08-06",
    generatedAtMs: Date.UTC(2026, 7, 7),
    reservations: [{
      id: 1,
      status: "confirmed",
      clientOrderId: "client-1",
      ticketId: "order-1",
      effectiveStake: 100,
      createdAtMs: 1000,
      reconciledAtMs: 1500,
    }],
    providerOrders: [{
      orderId: "order-1",
      clientOrderId: "client-1",
      ticker: "DEMO-MARKET",
      status: "partially_filled",
      count: 2,
      filledCount: 1,
    }],
    providerFills: [{ fillId: "fill-1", orderId: "order-1", count: 1, priceCents: 50 }],
    providerPositions: [{ ticker: "DEMO-MARKET", position: 1 }],
    localPositions: [{ ticker: "DEMO-MARKET", position: 1 }],
    journal: {
      reservationEntries: 1,
      orderEntries: 1,
      fillEntries: 1,
      cancellationEntries: 1,
      receiptEntries: 1,
    },
    receipts: [{
      dedupeKey: "execution:1:confirmed",
      status: "delivered",
      createdAtMs: 1600,
      deliveredAtMs: 1800,
    }],
    balances: { providerBalanceCents: 10_000, localBalanceCents: 10_000 },
    limits: { unknownResolutionSlaMs: 60_000 },
    productionBreakers: {
      productionExecutionEnabled: false,
      productionArmed: false,
    },
    provenance: {
      localEvidenceSha256: "a".repeat(64),
      providerEvidenceSha256: "b".repeat(64),
      scenarioEvidenceSha256: "c".repeat(64),
    },
    scenarios: {
      duplicate_requests: { exercised: true, passed: true, evidence: "one reservation and order" },
      crash_after_dispatch: { exercised: true, passed: true, evidence: "lease recovery confirmed order" },
      timeout_unknown: { exercised: true, passed: true, evidence: "exposure held until lookup" },
      partial_fill: { exercised: true, passed: true, evidence: "one of two contracts filled" },
      cancellation: { exercised: true, passed: true, evidence: "cancel receipt journaled" },
      telegram_outage: { exercised: true, passed: true, evidence: "outbox delivered after retry" },
    },
  };
}

describe("demo execution proof artifact", () => {
  test("emits deterministic redacted JSON and Markdown for a passing demo day", () => {
    const artifact = buildDemoProofArtifact(input());
    expect(artifact.passed).toBeTrue();
    expect(artifact.integrity).toEqual({
      orphanProviderOrders: 0,
      orphanConfirmedReservations: 0,
      balanceDriftCents: 0,
      maxReconciliationLagMs: 500,
      maxReceiptLagMs: 200,
      maxUnknownAgeMs: 0,
      unknownSlaBreaches: 0,
      positionDriftContracts: 0,
      productionBreakersClosed: true,
    });
    expect(demoProofJson(artifact)).toBe(demoProofJson(buildDemoProofArtifact(input())));
    expect(demoProofMarkdown(artifact)).toContain("Environment: **demo**");
    expect(demoProofMarkdown(artifact)).toContain("does not arm or authorize production");
    expect(demoProofJson(artifact)).not.toContain("apiKey");
  });

  test("refuses production evidence", () => {
    const value = input();
    value.environment = "prod";
    expect(() => buildDemoProofArtifact(value)).toThrow(/refuses production/);
  });

  test("fails proof for orphans, drift, or an unexercised scenario", () => {
    const value = input();
    value.providerOrders.push({
      orderId: "orphan",
      clientOrderId: "unknown-client",
      ticker: "DEMO-MARKET",
      status: "resting",
      count: 1,
      filledCount: 0,
    });
    value.balances.localBalanceCents = 9_999;
    value.scenarios.telegram_outage.exercised = false;
    const artifact = buildDemoProofArtifact(value);
    expect(artifact.passed).toBeFalse();
    expect(artifact.integrity).toMatchObject({
      orphanProviderOrders: 1,
      balanceDriftCents: 1,
    });
  });

  test("fails for position drift, overdue unknowns, or open production breakers", () => {
    const value = input();
    value.localPositions[0]!.position = 0;
    value.reservations[0]!.status = "unknown";
    value.reservations[0]!.createdAtMs = value.generatedAtMs - 60_001;
    value.productionBreakers.productionArmed = true;
    const artifact = buildDemoProofArtifact(value);
    expect(artifact.passed).toBeFalse();
    expect(artifact.integrity).toMatchObject({
      positionDriftContracts: 1,
      unknownSlaBreaches: 1,
      productionBreakersClosed: false,
    });
  });

  test("sorts unordered inputs before serialization", () => {
    const value = input();
    value.providerPositions.unshift({ ticker: "AAA", position: 0 });
    value.providerOrders.unshift({
      orderId: "aaa-order",
      clientOrderId: "client-1",
      ticker: "AAA",
      status: "cancelled",
      count: 0,
      filledCount: 0,
    });
    const artifact = buildDemoProofArtifact(value);
    expect(artifact.providerOrders.map((row) => row.orderId)).toEqual(["aaa-order", "order-1"]);
    expect(artifact.providerPositions.map((row) => row.ticker)).toEqual(["AAA", "DEMO-MARKET"]);
  });
});
