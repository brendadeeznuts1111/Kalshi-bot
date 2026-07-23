#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
/**
 * Ops factorial experiment CLI — launch, assign, status, daily check.
 *
 *   bun run tennis:experiment -- launch --name=phase1 --routing=static,dynamic
 *   bun run tennis:experiment -- assign --experiment=<id> --partner=p1
 *   bun run tennis:experiment -- status --experiment=<id>
 *   bun run tennis:experiment -- check --experiment=<id>
 *   bun run tennis:experiment -- check-all
 *   bun run tennis:experiment -- ingest --experiment=<id> --program=tennis-game-model
 */
import { parseArgs } from "node:util";
import { ExperimentRunner } from "../../src/operations/experiment-runner.ts";
import {
  ingestShadowMetrics,
  type ShadowBridgePartnerKey,
} from "../../src/operations/experiment-shadow-bridge.ts";
import {
  loadLatestExperimentSession,
  TENNIS_EXPERIMENTS_LATEST,
} from "../../src/operations/experiment-store.ts";
import type { Factor } from "../../src/operations/factorial.ts";

function argFactors(values: Record<string, unknown>): Factor[] {
  const factors: Factor[] = [];
  const routing = values.routing;
  if (typeof routing === "string" && routing.trim()) {
    factors.push({
      name: "routing",
      levels: routing.split(",").map((s) => s.trim()).filter(Boolean),
    });
  }
  const cut = values.cut;
  if (typeof cut === "string" && cut.trim()) {
    factors.push({
      name: "cut",
      levels: cut.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)),
    });
  }
  return factors;
}

export async function runExperimentCli(argv: string[]): Promise<number> {
  const positional = argv.filter((a) => !a.startsWith("-"));
  const command = positional[0];
  if (!command) {
    console.error(
      "Usage: experiment-cli.ts <launch|assign|record|status|check|check-all|ingest|latest> [--json] ...",
    );
    return 1;
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      json: { type: "boolean", default: false },
      name: { type: "string" },
      experiment: { type: "string" },
      partner: { type: "string" },
      routing: { type: "string" },
      cut: { type: "string" },
      fraction: { type: "string" },
      outcome: { type: "string" },
      "min-days": { type: "string" },
      program: { type: "string" },
      "partner-key": { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
    strict: false,
  });

  const json = values.json === true;
  const runner = ExperimentRunner.open();

  if (command === "latest") {
    const artifact = await loadLatestExperimentSession();
    if (json) {
      console.log(JSON.stringify(artifact, null, 2));
    } else if (!artifact) {
      console.log(`No artifact at ${TENNIS_EXPERIMENTS_LATEST}`);
    } else {
      console.log(
        `experiment=${artifact.experimentId} status=${artifact.status} n=${artifact.totalObservations} grandMean=${artifact.grandMean.toFixed(3)} fp=${artifact.fingerprint}`,
      );
    }
    return 0;
  }

  if (command === "launch") {
    const factors = argFactors(values);
    if (factors.length === 0) {
      console.error("launch requires --routing=static,dynamic (optional --cut=0.1,0.15)");
      return 1;
    }
    const fraction =
      typeof values.fraction === "string" ? Number(values.fraction) : undefined;
    const minDays =
      typeof values["min-days"] === "string" ? Number(values["min-days"]) : undefined;
    const id = runner.launch({
      name: (values.name as string) ?? "unnamed",
      factors,
      fraction: Number.isFinite(fraction) ? fraction : undefined,
      minDurationDays: Number.isFinite(minDays) ? minDays : undefined,
    });
    const design = runner.getDesign(id);
    const payload = { experimentId: id, variants: design.variants.length, factors };
    if (json) console.log(JSON.stringify(payload, null, 2));
    else console.log(`Launched ${id} — ${design.variants.length} variants`);
    return 0;
  }

  if (command === "check-all") {
    const results = await runner.dailyCheckAll();
    if (json) console.log(JSON.stringify(results, null, 2));
    else {
      if (results.length === 0) console.log("no active experiments");
      for (const { experimentId: id, result } of results) {
        console.log(
          `${id} status=${result.status} days=${result.daysRunning.toFixed(1)}` +
            (result.reason ? ` (${result.reason})` : ""),
        );
      }
    }
    return 0;
  }

  const experimentId = values.experiment as string | undefined;
  if (command === "ingest") {
    if (!experimentId) {
      console.error("--experiment=<id> required");
      return 1;
    }
    const programName = values.program as string | undefined;
    if (!programName) {
      console.error("--program=<alpha-dir-name> required (e.g. tennis-game-model)");
      return 1;
    }
    const partnerKey = (values["partner-key"] as string | undefined)?.trim() as
      | ShadowBridgePartnerKey
      | undefined;
    const summary = await ingestShadowMetrics({
      experimentId,
      programName,
      partnerKey: partnerKey ?? "eventId",
      dryRun: values["dry-run"] === true,
    });
    if (json) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(
        `ingest inserted=${summary.inserted} skipped=${summary.skipped} errors=${summary.errors}`,
      );
    }
    return summary.errors > 0 ? 1 : 0;
  }

  if (!experimentId) {
    console.error("--experiment=<id> required");
    return 1;
  }

  if (command === "assign") {
    const partnerId = values.partner as string | undefined;
    if (!partnerId) {
      console.error("--partner=<id> required");
      return 1;
    }
    const assignment = runner.assignPartner(experimentId, partnerId);
    const payload = { partnerId, variant: assignment.variant, variantId: assignment.variantId };
    if (json) console.log(JSON.stringify(payload, null, 2));
    else console.log(`${partnerId} → ${assignment.variantId}`);
    return 0;
  }

  if (command === "record") {
    const partnerId = values.partner as string | undefined;
    const outcomeRaw = values.outcome as string | undefined;
    if (!partnerId || outcomeRaw == null) {
      console.error("record requires --partner and --outcome=0|1");
      return 1;
    }
    const outcome = Number(outcomeRaw);
    if (outcome !== 0 && outcome !== 1) {
      console.error("--outcome must be 0 or 1");
      return 1;
    }
    runner.recordMetric(experimentId, partnerId, outcome);
    if (json) console.log(JSON.stringify({ ok: true }));
    else console.log(`recorded outcome=${outcome} for ${partnerId}`);
    return 0;
  }

  if (command === "status") {
    const results = runner.getResults(experimentId);
    if (json) console.log(JSON.stringify(results, null, 2));
    else {
      console.log(
        `n=${results.totalObservations} mean=${results.grandMean.toFixed(3)} r²=${results.rSquared.toFixed(3)}`,
      );
      for (const me of results.mainEffects) {
        console.log(`  ${me.factor}=${me.level} effect=${me.effect.toFixed(3)} n=${me.n}`);
      }
    }
    return 0;
  }

  if (command === "check") {
    const check = await runner.dailyCheck(experimentId);
    if (json) console.log(JSON.stringify(check, null, 2));
    else {
      console.log(`status=${check.status} days=${check.daysRunning.toFixed(1)}`);
      if (check.reason) console.log(`reason: ${check.reason}`);
    }
    return 0;
  }

  console.error(`Unknown command: ${command}`);
  return 1;
}

if (import.meta.main) {
  const code = await runExperimentCli(Bun.argv.slice(2));
  process.exit(code);
}
