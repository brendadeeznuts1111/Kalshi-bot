export const DEMO_PROOF_SCHEMA_VERSION = 3 as const;

export const DEMO_PROOF_SCENARIOS = [
  "duplicate_requests",
  "crash_after_dispatch",
  "timeout_unknown",
  "partial_fill",
  "cancellation",
  "telegram_outage",
] as const;
export type DemoProofScenario = (typeof DEMO_PROOF_SCENARIOS)[number];

export interface DemoProofInput {
  environment: "demo" | "prod";
  day: string;
  generatedAtMs: number;
  reservations: Array<{
    id: number;
    status: string;
    clientOrderId: string | null;
    ticketId: string | null;
    effectiveStake: number;
    createdAtMs: number;
    reconciledAtMs: number | null;
  }>;
  providerOrders: Array<{
    orderId: string;
    clientOrderId: string | null;
    ticker: string;
    status: string;
    count: number;
    filledCount: number;
  }>;
  providerFills: Array<{
    fillId: string;
    orderId: string;
    count: number;
    priceCents: number;
  }>;
  providerPositions: Array<{
    ticker: string;
    position: number;
  }>;
  localPositions: Array<{
    ticker: string;
    position: number;
  }>;
  journal: {
    reservationEntries: number;
    orderEntries: number;
    fillEntries: number;
    cancellationEntries: number;
    receiptEntries: number;
  };
  receipts: Array<{
    dedupeKey: string;
    status: "pending" | "leased" | "delivered" | "dead_letter";
    createdAtMs: number;
    deliveredAtMs: number | null;
  }>;
  balances: {
    providerBalanceCents: number;
    localBalanceCents: number;
  };
  limits: {
    unknownResolutionSlaMs: number;
  };
  productionBreakers: {
    productionExecutionEnabled: boolean;
    productionArmed: boolean;
  };
  provenance: {
    localEvidenceSha256: string;
    providerEvidenceSha256: string;
    scenarioEvidenceSha256: string;
  };
  scenarios: Record<DemoProofScenario, {
    exercised: boolean;
    passed: boolean;
    evidence: string;
  }>;
}

export interface DemoProofArtifact {
  schemaVersion: typeof DEMO_PROOF_SCHEMA_VERSION;
  environment: "demo";
  day: string;
  generatedAtMs: number;
  passed: boolean;
  totals: {
    reservations: number;
    providerOrders: number;
    providerFills: number;
    providerPositions: number;
    localPositions: number;
    journal: DemoProofInput["journal"];
  };
  integrity: {
    orphanProviderOrders: number;
    orphanConfirmedReservations: number;
    balanceDriftCents: number;
    maxReconciliationLagMs: number;
    maxReceiptLagMs: number;
    maxUnknownAgeMs: number;
    unknownSlaBreaches: number;
    positionDriftContracts: number;
    productionBreakersClosed: boolean;
  };
  scenarios: Array<{
    id: DemoProofScenario;
    exercised: boolean;
    passed: boolean;
    evidence: string;
  }>;
  reservations: DemoProofInput["reservations"];
  providerOrders: DemoProofInput["providerOrders"];
  providerFills: DemoProofInput["providerFills"];
  providerPositions: DemoProofInput["providerPositions"];
  localPositions: DemoProofInput["localPositions"];
  receipts: DemoProofInput["receipts"];
  balances: DemoProofInput["balances"];
  limits: DemoProofInput["limits"];
  productionBreakers: DemoProofInput["productionBreakers"];
  provenance: DemoProofInput["provenance"];
}

/** Compile one sanitized day of demo evidence. This boundary can never bless prod. */
export function buildDemoProofArtifact(input: DemoProofInput): DemoProofArtifact {
  if (input.environment !== "demo") {
    throw new Error("Demo execution proof refuses production evidence and cannot arm production");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) throw new TypeError("proof day must be YYYY-MM-DD");
  assertNonNegativeInteger(input.generatedAtMs, "generatedAtMs");
  validateInput(input);

  const reservations = [...input.reservations].sort((a, b) => a.id - b.id);
  const providerOrders = [...input.providerOrders].sort(compareBy("orderId"));
  const providerFills = [...input.providerFills].sort(compareBy("fillId"));
  const providerPositions = [...input.providerPositions].sort(compareBy("ticker"));
  const localPositions = [...input.localPositions].sort(compareBy("ticker"));
  const receipts = [...input.receipts].sort(compareBy("dedupeKey"));
  const reservationClientIds = new Set(
    reservations.flatMap((row) => row.clientOrderId === null ? [] : [row.clientOrderId]),
  );
  const providerOrderIds = new Set(providerOrders.map((row) => row.orderId));
  const orphanProviderOrders = providerOrders.filter(
    (row) => row.clientOrderId === null || !reservationClientIds.has(row.clientOrderId),
  ).length;
  const orphanConfirmedReservations = reservations.filter(
    (row) => row.status === "confirmed" &&
      (row.ticketId === null || !providerOrderIds.has(row.ticketId)),
  ).length;
  const maxReconciliationLagMs = maximum(reservations.map((row) =>
    row.reconciledAtMs === null ? 0 : Math.max(0, row.reconciledAtMs - row.createdAtMs)
  ));
  const maxReceiptLagMs = maximum(receipts.map((row) =>
    Math.max(0, (row.deliveredAtMs ?? input.generatedAtMs) - row.createdAtMs)
  ));
  const scenarios = DEMO_PROOF_SCENARIOS.map((id) => ({
    id,
    exercised: input.scenarios[id].exercised,
    passed: input.scenarios[id].passed && structuralScenarioPass(id, {
      reservations,
      providerOrders,
      receipts,
      journal: input.journal,
    }),
    evidence: input.scenarios[id].evidence.trim().slice(0, 500),
  }));
  const balanceDriftCents = Math.abs(
    input.balances.providerBalanceCents - input.balances.localBalanceCents,
  );
  const positionDriftContracts = positionDrift(providerPositions, localPositions);
  const unknownAges = reservations
    .filter((row) => row.status === "unknown")
    .map((row) => Math.max(0, input.generatedAtMs - row.createdAtMs));
  const maxUnknownAgeMs = maximum(unknownAges);
  const unknownSlaBreaches = unknownAges.filter(
    (age) => age > input.limits.unknownResolutionSlaMs,
  ).length;
  const productionBreakersClosed =
    !input.productionBreakers.productionExecutionEnabled &&
    !input.productionBreakers.productionArmed;
  const passed =
    orphanProviderOrders === 0 &&
    orphanConfirmedReservations === 0 &&
    balanceDriftCents === 0 &&
    positionDriftContracts === 0 &&
    unknownSlaBreaches === 0 &&
    productionBreakersClosed &&
    scenarios.every((scenario) => scenario.exercised && scenario.passed);

  return {
    schemaVersion: DEMO_PROOF_SCHEMA_VERSION,
    environment: "demo",
    day: input.day,
    generatedAtMs: input.generatedAtMs,
    passed,
    totals: {
      reservations: reservations.length,
      providerOrders: providerOrders.length,
      providerFills: providerFills.length,
      providerPositions: providerPositions.length,
      localPositions: localPositions.length,
      journal: { ...input.journal },
    },
    integrity: {
      orphanProviderOrders,
      orphanConfirmedReservations,
      balanceDriftCents,
      maxReconciliationLagMs,
      maxReceiptLagMs,
      maxUnknownAgeMs,
      unknownSlaBreaches,
      positionDriftContracts,
      productionBreakersClosed,
    },
    scenarios,
    reservations,
    providerOrders,
    providerFills,
    providerPositions,
    localPositions,
    receipts,
    balances: { ...input.balances },
    limits: { ...input.limits },
    productionBreakers: { ...input.productionBreakers },
    provenance: { ...input.provenance },
  };
}

export function demoProofJson(artifact: DemoProofArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export function demoProofMarkdown(artifact: DemoProofArtifact): string {
  const scenarioRows = artifact.scenarios.map((scenario) =>
    `| ${scenario.id} | ${scenario.exercised ? "yes" : "no"} | ${scenario.passed ? "pass" : "fail"} | ${escapeCell(scenario.evidence)} |`
  ).join("\n");
  return `# Authorized Execution Demo Proof — ${artifact.day}

- Schema: ${artifact.schemaVersion}
- Environment: **demo**
- Result: **${artifact.passed ? "PASS" : "FAIL"}**
- Generated at: ${new Date(artifact.generatedAtMs).toISOString()}

## Integrity

| Metric | Value |
| --- | ---: |
| Reservations | ${artifact.totals.reservations} |
| Provider orders | ${artifact.totals.providerOrders} |
| Provider fills | ${artifact.totals.providerFills} |
| Provider positions | ${artifact.totals.providerPositions} |
| Local positions | ${artifact.totals.localPositions} |
| Orphan provider orders | ${artifact.integrity.orphanProviderOrders} |
| Orphan confirmed reservations | ${artifact.integrity.orphanConfirmedReservations} |
| Balance drift (cents) | ${artifact.integrity.balanceDriftCents} |
| Max reconciliation lag (ms) | ${artifact.integrity.maxReconciliationLagMs} |
| Max receipt lag (ms) | ${artifact.integrity.maxReceiptLagMs} |
| Max unknown age (ms) | ${artifact.integrity.maxUnknownAgeMs} |
| Unknown SLA breaches | ${artifact.integrity.unknownSlaBreaches} |
| Position drift (contracts) | ${artifact.integrity.positionDriftContracts} |
| Production breakers closed | ${artifact.integrity.productionBreakersClosed ? "yes" : "no"} |

## Required scenarios

| Scenario | Exercised | Result | Evidence |
| --- | --- | --- | --- |
${scenarioRows}

This artifact is demo-only evidence. It does not arm or authorize production execution.
`;
}

function validateInput(input: DemoProofInput): void {
  assertUnique(input.reservations.map((row) => String(row.id)), "reservation ID");
  assertUnique(input.providerOrders.map((row) => row.orderId), "provider order ID");
  assertUnique(input.providerFills.map((row) => row.fillId), "provider fill ID");
  assertUnique(input.providerPositions.map((row) => row.ticker), "provider position ticker");
  assertUnique(input.localPositions.map((row) => row.ticker), "local position ticker");
  assertUnique(input.receipts.map((row) => row.dedupeKey), "receipt dedupe key");
  for (const row of input.reservations) {
    assertPositiveInteger(row.id, "reservation id");
    assertNonNegativeInteger(row.effectiveStake, "effective stake");
    assertNonNegativeInteger(row.createdAtMs, "reservation createdAtMs");
    if (row.reconciledAtMs !== null) assertNonNegativeInteger(row.reconciledAtMs, "reconciledAtMs");
  }
  for (const row of input.providerOrders) {
    assertNonNegativeInteger(row.count, "provider order count");
    assertNonNegativeInteger(row.filledCount, "provider filled count");
  }
  for (const row of input.providerFills) {
    assertNonNegativeInteger(row.count, "provider fill count");
    assertNonNegativeInteger(row.priceCents, "provider fill price");
  }
  for (const row of [...input.providerPositions, ...input.localPositions]) {
    if (!Number.isSafeInteger(row.position)) throw new TypeError("position must be an integer");
  }
  for (const row of input.receipts) {
    assertNonNegativeInteger(row.createdAtMs, "receipt createdAtMs");
    if (row.deliveredAtMs !== null) assertNonNegativeInteger(row.deliveredAtMs, "receipt deliveredAtMs");
  }
  for (const [name, value] of Object.entries(input.journal)) assertNonNegativeInteger(value, name);
  assertNonNegativeInteger(input.balances.providerBalanceCents, "provider balance");
  assertNonNegativeInteger(input.balances.localBalanceCents, "local balance");
  assertNonNegativeInteger(input.limits.unknownResolutionSlaMs, "unknown resolution SLA");
  for (const [name, digest] of Object.entries(input.provenance)) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError(`${name} must be a SHA-256 digest`);
  }
  for (const id of DEMO_PROOF_SCENARIOS) {
    const scenario = input.scenarios[id];
    if (!scenario || typeof scenario.evidence !== "string" || !scenario.evidence.trim()) {
      throw new TypeError(`scenario ${id} requires bounded evidence`);
    }
  }
}

function assertUnique(values: string[], label: string): void {
  if (values.some((value) => !value.trim()) || new Set(values).size !== values.length) {
    throw new TypeError(`${label} values must be non-empty and unique`);
  }
}

function positionDrift(
  provider: DemoProofInput["providerPositions"],
  local: DemoProofInput["localPositions"],
): number {
  const byTicker = new Map<string, { provider: number; local: number }>();
  for (const row of provider) byTicker.set(row.ticker, { provider: row.position, local: 0 });
  for (const row of local) {
    const value = byTicker.get(row.ticker) ?? { provider: 0, local: 0 };
    value.local += row.position;
    byTicker.set(row.ticker, value);
  }
  let drift = 0;
  for (const value of byTicker.values()) drift += Math.abs(value.provider - value.local);
  return drift;
}

function compareBy<K extends string>(key: K) {
  return (a: Record<K, string>, b: Record<K, string>) => a[key].localeCompare(b[key]);
}

function maximum(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function structuralScenarioPass(
  id: DemoProofScenario,
  data: Pick<DemoProofInput, "reservations" | "providerOrders" | "receipts" | "journal">,
): boolean {
  switch (id) {
    case "duplicate_requests":
      return uniqueNonNull(data.reservations.map((row) => row.clientOrderId)) &&
        uniqueNonNull(data.providerOrders.map((row) => row.clientOrderId));
    case "crash_after_dispatch":
      return data.reservations.some((row) => row.reconciledAtMs !== null);
    case "timeout_unknown":
      return data.reservations.some((row) => row.status === "unknown" || row.reconciledAtMs !== null);
    case "partial_fill":
      return data.providerOrders.some((row) => row.filledCount > 0 && row.filledCount < row.count);
    case "cancellation":
      return data.journal.cancellationEntries > 0;
    case "telegram_outage":
      return data.journal.receiptEntries > 0 &&
        data.receipts.some((row) => row.status === "delivered" && row.deliveredAtMs !== null);
  }
}

function uniqueNonNull(values: Array<string | null>): boolean {
  const present = values.filter((value): value is string => value !== null);
  return new Set(present).size === present.length;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be positive`);
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be non-negative`);
}
