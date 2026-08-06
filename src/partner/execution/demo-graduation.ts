import { createHash } from 'node:crypto';
import {
  DEMO_PROOF_SCHEMA_VERSION,
  DEMO_PROOF_SCENARIOS,
  type DemoProofArtifact,
} from './demo-proof.ts';

export const DEMO_GRADUATION_SCHEMA_VERSION = 1 as const;
export const REQUIRED_DEMO_DAYS = 7 as const;

export interface DemoGraduationDay {
  day: string;
  generatedAtMs: number;
  artifactSha256: string;
  previousChainSha256: string | null;
  chainSha256: string;
}

export interface DemoGraduationManifest {
  schemaVersion: typeof DEMO_GRADUATION_SCHEMA_VERSION;
  environment: 'demo';
  requiredDays: typeof REQUIRED_DEMO_DAYS;
  passed: boolean;
  firstDay: string | null;
  lastDay: string | null;
  days: DemoGraduationDay[];
  failures: string[];
  productionArmed: false;
}

/** Verify artifact content and continuity; source-observation provenance stays an operator review. */
export function verifyDemoGraduation(
  artifacts: readonly DemoProofArtifact[]
): DemoGraduationManifest {
  const failures: string[] = [];
  const ordered = [...artifacts].sort((a, b) => a.day.localeCompare(b.day));
  if (ordered.length !== REQUIRED_DEMO_DAYS) {
    failures.push(
      `expected exactly ${REQUIRED_DEMO_DAYS} daily artifacts; received ${ordered.length}`
    );
  }
  const seenDays = new Set<string>();
  const days: DemoGraduationDay[] = [];
  let previousChainSha256: string | null = null;
  for (let index = 0; index < ordered.length; index += 1) {
    const artifact = ordered[index]!;
    const prefix = `day ${artifact.day}`;
    if (seenDays.has(artifact.day)) failures.push(`${prefix}: duplicate proof day`);
    seenDays.add(artifact.day);
    validateArtifact(artifact, prefix, failures);
    if (index > 0 && nextUtcDay(ordered[index - 1]!.day) !== artifact.day) {
      failures.push(`${prefix}: proof days are not consecutive UTC calendar days`);
    }
    const artifactSha256 = sha256(JSON.stringify(artifact));
    const chainSha256 = sha256(
      `${previousChainSha256 ?? 'GENESIS'}\n${artifact.day}\n${artifactSha256}`
    );
    days.push({
      day: artifact.day,
      generatedAtMs: artifact.generatedAtMs,
      artifactSha256,
      previousChainSha256,
      chainSha256,
    });
    previousChainSha256 = chainSha256;
  }
  return {
    schemaVersion: DEMO_GRADUATION_SCHEMA_VERSION,
    environment: 'demo',
    requiredDays: REQUIRED_DEMO_DAYS,
    passed: failures.length === 0,
    firstDay: ordered[0]?.day ?? null,
    lastDay: ordered.at(-1)?.day ?? null,
    days,
    failures,
    productionArmed: false,
  };
}

export function demoGraduationJson(manifest: DemoGraduationManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function validateArtifact(artifact: DemoProofArtifact, prefix: string, failures: string[]): void {
  if (artifact.schemaVersion !== DEMO_PROOF_SCHEMA_VERSION)
    failures.push(`${prefix}: unsupported daily proof schema`);
  if (artifact.environment !== 'demo') failures.push(`${prefix}: evidence is not demo-only`);
  if (!artifact.passed) failures.push(`${prefix}: daily proof did not pass`);
  if (!validDay(artifact.day)) failures.push(`${prefix}: invalid proof day`);
  if (!Number.isSafeInteger(artifact.generatedAtMs) || artifact.generatedAtMs < 0) {
    failures.push(`${prefix}: invalid generation time`);
  } else if (validDay(artifact.day)) {
    const start = Date.parse(`${artifact.day}T00:00:00.000Z`);
    if (artifact.generatedAtMs < start || artifact.generatedAtMs >= start + 2 * 86_400_000) {
      failures.push(`${prefix}: generation time is outside the daily evidence window`);
    }
  }
  if (
    artifact.integrity.orphanProviderOrders !== 0 ||
    artifact.integrity.orphanConfirmedReservations !== 0 ||
    artifact.integrity.balanceDriftCents !== 0 ||
    artifact.integrity.positionDriftContracts !== 0 ||
    artifact.integrity.unknownSlaBreaches !== 0 ||
    !artifact.integrity.productionBreakersClosed
  ) {
    failures.push(`${prefix}: integrity counters do not satisfy graduation`);
  }
  const reservationClientIds = new Set(
    artifact.reservations.flatMap((row) =>
      row.clientOrderId === null ? [] : [row.clientOrderId]
    ),
  );
  const providerOrderIds = new Set(artifact.providerOrders.map((row) => row.orderId));
  const recomputedProviderOrphans = artifact.providerOrders.filter(
    (row) => row.clientOrderId === null || !reservationClientIds.has(row.clientOrderId),
  ).length;
  const recomputedReservationOrphans = artifact.reservations.filter(
    (row) => row.status === 'confirmed' &&
      (row.ticketId === null || !providerOrderIds.has(row.ticketId)),
  ).length;
  if (
    recomputedProviderOrphans !== artifact.integrity.orphanProviderOrders ||
    recomputedReservationOrphans !== artifact.integrity.orphanConfirmedReservations
  ) {
    failures.push(`${prefix}: orphan counters do not match artifact rows`);
  }
  const recomputedPositionDrift = positionDrift(
    artifact.providerPositions,
    artifact.localPositions,
  );
  const recomputedBalanceDrift = Math.abs(
    artifact.balances.providerBalanceCents - artifact.balances.localBalanceCents,
  );
  const unknownAges = artifact.reservations
    .filter((row) => row.status === 'unknown')
    .map((row) => Math.max(0, artifact.generatedAtMs - row.createdAtMs));
  const recomputedUnknownBreaches = unknownAges.filter(
    (age) => age > artifact.limits.unknownResolutionSlaMs,
  ).length;
  const recomputedBreakersClosed =
    !artifact.productionBreakers.productionExecutionEnabled &&
    !artifact.productionBreakers.productionArmed;
  if (
    recomputedBalanceDrift !== artifact.integrity.balanceDriftCents ||
    recomputedPositionDrift !== artifact.integrity.positionDriftContracts ||
    recomputedUnknownBreaches !== artifact.integrity.unknownSlaBreaches ||
    recomputedBreakersClosed !== artifact.integrity.productionBreakersClosed
  ) failures.push(`${prefix}: balance, position, SLA, or breaker counters do not match artifact rows`);
  const duplicateEvidence = [
    duplicate(artifact.reservations.map((row) => String(row.id)), 'reservation ID'),
    duplicate(artifact.providerOrders.map((row) => row.orderId), 'provider order ID'),
    duplicate(artifact.providerFills.map((row) => row.fillId), 'provider fill ID'),
    duplicate(artifact.providerPositions.map((row) => row.ticker), 'provider position ticker'),
    duplicate(artifact.localPositions.map((row) => row.ticker), 'local position ticker'),
    duplicate(artifact.receipts.map((row) => row.dedupeKey), 'receipt dedupe key'),
  ].filter((value): value is string => value !== null);
  if (duplicateEvidence.length > 0) {
    failures.push(`${prefix}: duplicate or empty evidence keys: ${duplicateEvidence.join(', ')}`);
  }
  const scenarios = new Map(artifact.scenarios.map(scenario => [scenario.id, scenario]));
  for (const id of DEMO_PROOF_SCENARIOS) {
    const scenario = scenarios.get(id);
    if (!scenario?.exercised || !scenario.passed || !scenario.evidence.trim()) {
      failures.push(`${prefix}: scenario ${id} lacks passing bounded evidence`);
    }
  }
  if (scenarios.size !== DEMO_PROOF_SCENARIOS.length ||
      artifact.scenarios.length !== DEMO_PROOF_SCENARIOS.length)
    failures.push(`${prefix}: scenario set is not canonical`);
}

function duplicate(values: string[], label: string): string | null {
  return values.some((value) => !value.trim()) || new Set(values).size !== values.length
    ? label
    : null;
}

function positionDrift(
  provider: DemoProofArtifact['providerPositions'],
  local: DemoProofArtifact['localPositions'],
): number {
  const positions = new Map<string, { provider: number; local: number }>();
  for (const row of provider) positions.set(row.ticker, { provider: row.position, local: 0 });
  for (const row of local) {
    const value = positions.get(row.ticker) ?? { provider: 0, local: 0 };
    value.local += row.position;
    positions.set(row.ticker, value);
  }
  return [...positions.values()].reduce(
    (sum, value) => sum + Math.abs(value.provider - value.local),
    0,
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function validDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

function nextUtcDay(day: string): string | null {
  return validDay(day)
    ? new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)
    : null;
}
