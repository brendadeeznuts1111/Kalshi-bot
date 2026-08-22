#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { buildDemoProofArtifact, demoProofJson, demoProofMarkdown } from "../src/partner/execution/demo-proof.ts";
import { collectDemoEvidence } from "../src/partner/execution/demo-evidence-collector.ts";
import { migrateDemoEvidenceSchema, recordDemoBalanceCheckpoint } from "../src/partner/execution/demo-evidence-checkpoint.ts";
import { runDeterministicDemoScenarios } from "../src/partner/execution/demo-scenario-runner.ts";
import { createKalshiDemoEvidenceSource } from "../src/partner/execution/kalshi-demo-evidence-source.ts";
import { createKalshiAccountClientResolver } from "../src/partner/execution/kalshi-live.ts";
import { executionIdempotencyKeyToUuid } from "../src/partner/execution/kalshi.ts";
import { migrateExecutionSchema } from "../src/partner/execution/sql.ts";
import { getBettingAccountById } from "../src/partner/registry.ts";

const value = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const usage = "Usage: bun tools/partner-execution-demo-collect.ts --partner=<code> --out=<id> --day=YYYY-MM-DD [--unknown-sla-ms=900000] [--output-dir=<dir>] [--record-checkpoint]";
const outId = required("out");
const partnerCode = required("partner");
const day = required("day");
if (Bun.env.KALSHI_ENV === "prod" || Bun.env.KALSHI_PROD_ARMED === "1") throw new Error("Demo collector refuses production state");
await main();

async function main(): Promise<void> {
  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  try {
  migrateExecutionSchema(db);
  migrateDemoEvidenceSchema(db);
  const account = getBettingAccountById(db, outId);
  if (!account || account.provider.toLowerCase() !== "kalshi") throw new Error("Requested out is not a registered Kalshi account");
  const client = createKalshiAccountClientResolver()(account);
  if (client.environment !== "demo") throw new Error("Demo collector resolved a non-demo client");
  if (process.argv.includes("--record-checkpoint")) {
    const capturedAtMs = Date.now();
    const balance = await client.getBalance();
    if (balance.balanceCents === null) throw new Error("Kalshi demo balance is unavailable");
    const effectiveAtMs = capturedAtMs;
    const proofStartMs = Date.parse(`${day}T00:00:00.000Z`);
    if (effectiveAtMs > proofStartMs) throw new Error("Checkpoint capture must occur no later than the requested proof-day start; seed the next demo day instead of backdating evidence");
    const sourceSha256 = new Bun.CryptoHasher("sha256").update(JSON.stringify({ environment: client.environment, outId, balanceCents: balance.balanceCents, effectiveAtMs })).digest("hex");
    const checkpoint = recordDemoBalanceCheckpoint(db, { partnerCode, outId, skin: "*", balanceCents: balance.balanceCents, effectiveAtMs, sourceSha256, createdAtMs: Date.now() });
    console.log(JSON.stringify({ checkpointId: checkpoint.id, effectiveAtMs, sourceSha256 }, null, 2));
    return;
  }
  const reservations = db.query(`SELECT id, idempotency_key FROM exposure_reservations WHERE partner_code = $partner AND out_id = $outId`).all({ $partner: partnerCode, $outId: outId }) as Array<{ id: number; idempotency_key: string }>;
  const reservationByClientId = new Map(reservations.map((row) => [executionIdempotencyKeyToUuid(row.idempotency_key), row.id]));
  const source = createKalshiDemoEvidenceSource(client, {
    outId,
    reservationForClientOrderId: (clientOrderId) => (reservationByClientId.get(clientOrderId) ?? null) as never,
  });
  const scenarioRun = await runDeterministicDemoScenarios();
  const input = await collectDemoEvidence({
    db, provider: source, partnerCode, outId, day, generatedAtMs: Date.now(),
    unknownResolutionSlaMs: Number(value("unknown-sla-ms") ?? 900_000),
    scenarios: scenarioRun.scenarios,
    environment: Bun.env as Record<string, string | undefined>,
  });
  const artifact = buildDemoProofArtifact(input);
  const outputDir = resolve(value("output-dir") ?? "artifacts/execution-demo-proof");
  await mkdir(outputDir, { recursive: true });
  const stem = `execution-demo-proof-${artifact.day}`;
  await Promise.all([
    Bun.write(join(outputDir, `${stem}.json`), demoProofJson(artifact)),
    Bun.write(join(outputDir, `${stem}.md`), demoProofMarkdown(artifact)),
  ]);
  console.log(JSON.stringify({ artifact: join(outputDir, `${stem}.json`), passed: artifact.passed, scenarioRunner: scenarioRun.runner }, null, 2));
  if (!artifact.passed) process.exitCode = 2;
  } finally {
    db.close();
  }
}

function required(name: string): string {
  const result = value(name)?.trim();
  if (!result) throw new Error(usage);
  return result;
}
