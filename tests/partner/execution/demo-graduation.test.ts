import { describe, expect, test } from 'bun:test';
import {
  buildDemoProofArtifact,
  type DemoProofInput,
} from '../../../src/partner/execution/demo-proof.ts';
import {
  demoGraduationJson,
  verifyDemoGraduation,
} from '../../../src/partner/execution/demo-graduation.ts';

function passingInput(day: string, offset: number): DemoProofInput {
  const start = Date.parse(`${day}T00:00:00.000Z`);
  return {
    environment: 'demo',
    day,
    generatedAtMs: start + 86_400_000,
    reservations: [
      {
        id: offset + 1,
        status: 'confirmed',
        clientOrderId: `client-${offset}`,
        ticketId: `order-${offset}`,
        effectiveStake: 100,
        createdAtMs: start + 1_000,
        reconciledAtMs: start + 1_500,
      },
    ],
    providerOrders: [
      {
        orderId: `order-${offset}`,
        clientOrderId: `client-${offset}`,
        ticker: 'DEMO-MARKET',
        status: 'partially_filled',
        count: 2,
        filledCount: 1,
      },
    ],
    providerFills: [
      { fillId: `fill-${offset}`, orderId: `order-${offset}`, count: 1, priceCents: 50 },
    ],
    providerPositions: [{ ticker: 'DEMO-MARKET', position: 1 }],
    localPositions: [{ ticker: 'DEMO-MARKET', position: 1 }],
    journal: {
      reservationEntries: 1,
      orderEntries: 1,
      fillEntries: 1,
      cancellationEntries: 1,
      receiptEntries: 1,
    },
    receipts: [
      {
        dedupeKey: `receipt-${offset}`,
        status: 'delivered',
        createdAtMs: start + 1_600,
        deliveredAtMs: start + 1_800,
      },
    ],
    balances: { providerBalanceCents: 10_000, localBalanceCents: 10_000 },
    limits: { unknownResolutionSlaMs: 60_000 },
    productionBreakers: {
      productionExecutionEnabled: false,
      productionArmed: false,
    },
    provenance: {
      localEvidenceSha256: 'a'.repeat(64),
      providerEvidenceSha256: 'b'.repeat(64),
      scenarioEvidenceSha256: 'c'.repeat(64),
    },
    scenarios: {
      duplicate_requests: { exercised: true, passed: true, evidence: 'one idempotent order' },
      crash_after_dispatch: { exercised: true, passed: true, evidence: 'reconciled' },
      timeout_unknown: { exercised: true, passed: true, evidence: 'unknown retained' },
      partial_fill: { exercised: true, passed: true, evidence: 'partial fill retained' },
      cancellation: { exercised: true, passed: true, evidence: 'cancel journaled' },
      telegram_outage: { exercised: true, passed: true, evidence: 'outbox recovered' },
    },
  };
}

function sevenDays() {
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(Date.UTC(2026, 7, 1 + index)).toISOString().slice(0, 10);
    return buildDemoProofArtifact(passingInput(day, index));
  });
}

describe('demo graduation verifier', () => {
  test('accepts exactly seven consecutive passing demo days and chains content', () => {
    const manifest = verifyDemoGraduation(sevenDays().reverse());
    expect(manifest.passed).toBeTrue();
    expect(manifest.firstDay).toBe('2026-08-01');
    expect(manifest.lastDay).toBe('2026-08-07');
    expect(manifest.productionArmed).toBeFalse();
    expect(manifest.days).toHaveLength(7);
    expect(manifest.days[1]!.previousChainSha256).toBe(manifest.days[0]!.chainSha256);
    expect(demoGraduationJson(manifest)).toBe(
      demoGraduationJson(verifyDemoGraduation(sevenDays()))
    );
  });

  test('fails closed for missing, duplicate, nonconsecutive, failed, or stale-day evidence', () => {
    expect(verifyDemoGraduation(sevenDays().slice(0, 6)).failures.join(' ')).toContain('exactly 7');
    const broken = sevenDays();
    broken[1] = { ...broken[0]! };
    broken[2] = { ...broken[2]!, passed: false };
    broken[3] = { ...broken[3]!, generatedAtMs: 0 };
    const result = verifyDemoGraduation(broken);
    expect(result.passed).toBeFalse();
    expect(result.failures.join(' ')).toContain('duplicate proof day');
    expect(result.failures.join(' ')).toContain('not consecutive');
    expect(result.failures.join(' ')).toContain('daily proof did not pass');
    expect(result.failures.join(' ')).toContain('outside the daily evidence window');
  });

  test('recomputes requirements instead of trusting passed=true', () => {
    const artifacts = sevenDays();
    artifacts[4] = {
      ...artifacts[4]!,
      passed: true,
      integrity: { ...artifacts[4]!.integrity, balanceDriftCents: 1 },
      providerOrders: [...artifacts[4]!.providerOrders, {
        orderId: 'forged-orphan',
        clientOrderId: 'missing-client',
        ticker: 'DEMO-MARKET',
        status: 'resting',
        count: 1,
        filledCount: 0,
      }],
      scenarios: artifacts[4]!.scenarios.filter(row => row.id !== 'cancellation'),
    };
    const result = verifyDemoGraduation(artifacts);
    expect(result.passed).toBeFalse();
    expect(result.failures.join(' ')).toContain('integrity counters');
    expect(result.failures.join(' ')).toContain('orphan counters do not match');
    expect(result.failures.join(' ')).toContain('scenario cancellation');
    expect(result.failures.join(' ')).toContain('scenario set is not canonical');
  });

  test('recomputes balance drift from preserved provider and local balances', () => {
    const artifacts = sevenDays();
    artifacts[5] = {
      ...artifacts[5]!,
      passed: true,
      balances: {
        ...artifacts[5]!.balances,
        providerBalanceCents: artifacts[5]!.balances.localBalanceCents + 7,
      },
      integrity: { ...artifacts[5]!.integrity, balanceDriftCents: 0 },
    };
    const result = verifyDemoGraduation(artifacts);
    expect(result.passed).toBeFalse();
    expect(result.failures.join(' ')).toContain('balance, position, SLA, or breaker');
  });

  test('rejects duplicated evidence keys and scenario rows in parsed artifacts', () => {
    const artifacts = sevenDays();
    artifacts[6] = {
      ...artifacts[6]!,
      providerFills: [
        ...artifacts[6]!.providerFills,
        { ...artifacts[6]!.providerFills[0]! },
      ],
      scenarios: [
        ...artifacts[6]!.scenarios,
        { ...artifacts[6]!.scenarios[0]! },
      ],
    };
    const result = verifyDemoGraduation(artifacts);
    expect(result.passed).toBeFalse();
    expect(result.failures.join(' ')).toContain('duplicate or empty evidence keys');
    expect(result.failures.join(' ')).toContain('scenario set is not canonical');
  });
});
