// @see https://bun.com/docs/runtime/sqlite
/**
 * ETL shadow log resolved trades → experiment_metrics.
 * Partner key must match experiment_assignments (e.g. assign with --partner=<eventId>).
 */
import { resolveProgramShadow } from "../calibration/shadow-maintenance.ts";
import {
  materializeShadowLines,
  readShadowLogEntries,
  type ShadowPredictionLine,
} from "../institutions/shadow-line.ts";
import { ExperimentRunner } from "./experiment-runner.ts";

export type ShadowBridgePartnerKey = "eventId" | "ticker" | "program";

export type ShadowBridgeConfig = {
  experimentId: string;
  programName: string;
  /** How to derive partner_id from each shadow line. */
  partnerKey?: ShadowBridgePartnerKey;
  /** Only trade decisions with resolved outcome. */
  tradesOnly?: boolean;
  dryRun?: boolean;
  alphaRoot?: string;
  /** Override experiments DB (tests). */
  dbPath?: string;
  /** Override shadow log path (tests; skips manifest resolve). */
  logPath?: string;
};

export function resolveShadowPartnerId(
  line: ShadowPredictionLine,
  partnerKey: ShadowBridgePartnerKey,
  programName: string,
): string | null {
  switch (partnerKey) {
    case "eventId":
      return line.eventId?.trim() || null;
    case "ticker":
      return line.ticker?.trim() || null;
    case "program":
      return programName;
    default:
      return null;
  }
}

export async function ingestShadowMetrics(
  config: ShadowBridgeConfig,
): Promise<{ inserted: number; skipped: number; errors: number }> {
  const partnerKey = config.partnerKey ?? "eventId";
  const tradesOnly = config.tradesOnly !== false;
  const logPath = config.logPath
    ? config.logPath
    : (await resolveProgramShadow(config.programName, config.alphaRoot)).logPath;
  const entries = await readShadowLogEntries(logPath);
  const lines = materializeShadowLines(entries);

  const runner = ExperimentRunner.open(config.dbPath);
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const line of lines) {
    if (tradesOnly && line.decision.action !== "trade") {
      skipped++;
      continue;
    }
    if (line.outcome !== 0 && line.outcome !== 1) {
      skipped++;
      continue;
    }
    const partnerId = resolveShadowPartnerId(line, partnerKey, config.programName);
    if (!partnerId) {
      skipped++;
      continue;
    }
    if (config.dryRun) {
      inserted++;
      continue;
    }
    try {
      const ok = runner.recordMetric(
        config.experimentId,
        partnerId,
        line.outcome,
        line.lineHash,
      );
      if (ok) inserted++;
      else skipped++;
    } catch {
      errors++;
    }
  }

  return { inserted, skipped, errors };
}
