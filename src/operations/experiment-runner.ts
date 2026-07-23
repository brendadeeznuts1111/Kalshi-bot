// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/runtime/hashing#bun-hash
import type { Database } from "bun:sqlite";
import {
  analyzeFactorial,
  assignBalanced,
  generateDesign,
  variantId,
  type Factor,
  type FactorialDesign,
  type FactorialResult,
} from "./factorial.ts";
import { openExperimentsDb } from "./experiment-schema.ts";
import { persistExperimentSession } from "./experiment-store.ts";

export type ExperimentStatus = "active" | "early_stop" | "completed" | "cancelled";

export type LaunchExperimentConfig = {
  name: string;
  factors: Factor[];
  /** Fraction denominator (1 = full factorial). */
  fraction?: number;
  targetMetric?: string;
  minDurationDays?: number;
  minDetectableEffect?: number;
};

export type DailyCheckResult = {
  status: "running" | "early_stop" | "completed";
  daysRunning: number;
  results?: FactorialResult;
  reason?: string;
};

export class ExperimentRunner {
  constructor(private readonly db: Database) {}

  static open(dbPath?: string): ExperimentRunner {
    return new ExperimentRunner(openExperimentsDb(dbPath ? { dbPath } : {}));
  }

  launch(config: LaunchExperimentConfig): string {
    const design = generateDesign(config.factors, config.fraction ?? 1);
    const id = crypto.randomUUID();
    const startDate = new Date().toISOString();
    const weight = design.variants.length > 0 ? 1 / design.variants.length : 1;

    this.db.query(
      `INSERT INTO experiments (
         id, name, status, factors_json, design_json, start_date,
         min_duration_days, target_metric, min_detectable_effect
       ) VALUES ($id, $name, 'active', $factors, $design, $start, $minDays, $metric, $mde)`,
    ).run({
      $id: id,
      $name: config.name,
      $factors: JSON.stringify(config.factors),
      $design: JSON.stringify(design),
      $start: startDate,
      $minDays: config.minDurationDays ?? 14,
      $metric: config.targetMetric ?? "win_rate",
      $mde: config.minDetectableEffect ?? 0.02,
    });

    for (const v of design.variants) {
      const vid = variantId(v);
      this.db.query(
        `INSERT INTO experiment_variants (id, experiment_id, variant_id, config_json, weight)
         VALUES ($id, $exp, $vid, $cfg, $w)`,
      ).run({
        $id: crypto.randomUUID(),
        $exp: id,
        $vid: vid,
        $cfg: JSON.stringify(v),
        $w: weight,
      });
    }

    return id;
  }

  getDesign(experimentId: string): FactorialDesign {
    const row = this.db
      .query("SELECT design_json FROM experiments WHERE id = $id")
      .get({ $id: experimentId }) as { design_json: string } | null;
    if (!row) throw new Error(`experiment not found: ${experimentId}`);
    return JSON.parse(row.design_json) as FactorialDesign;
  }

  getFactors(experimentId: string): Factor[] {
    const row = this.db
      .query("SELECT factors_json FROM experiments WHERE id = $id")
      .get({ $id: experimentId }) as { factors_json: string } | null;
    if (!row) throw new Error(`experiment not found: ${experimentId}`);
    return JSON.parse(row.factors_json) as Factor[];
  }

  assignPartner(experimentId: string, partnerId: string) {
    const design = this.getDesign(experimentId);
    return assignBalanced(this.db, experimentId, partnerId, design.factors, design);
  }

  recordMetric(
    experimentId: string,
    partnerId: string,
    outcome: number,
    metricId?: string,
  ): boolean {
    const assignment = this.db
      .query(
        "SELECT variant_id FROM experiment_assignments WHERE experiment_id=$e AND partner_id=$p",
      )
      .get({ $e: experimentId, $p: partnerId }) as { variant_id: string } | null;
    if (!assignment) {
      throw new Error(`partner ${partnerId} not assigned to experiment ${experimentId}`);
    }
    const id = metricId ?? crypto.randomUUID();
    const existing = this.db
      .query("SELECT id FROM experiment_metrics WHERE id = $id")
      .get({ $id: id }) as { id: string } | null;
    if (existing) return false;

    this.db.query(
      `INSERT INTO experiment_metrics (id, experiment_id, partner_id, variant_id, outcome, recorded_at)
       VALUES ($id, $e, $p, $v, $o, datetime('now'))`,
    ).run({
      $id: id,
      $e: experimentId,
      $p: partnerId,
      $v: assignment.variant_id,
      $o: outcome,
    });
    return true;
  }

  listActiveExperimentIds(): string[] {
    const rows = this.db
      .query("SELECT id FROM experiments WHERE status = 'active' ORDER BY start_date ASC")
      .all() as { id: string }[];
    return rows.map((r) => r.id);
  }

  async dailyCheckAll(): Promise<
    Array<{ experimentId: string; result: Awaited<ReturnType<ExperimentRunner["dailyCheck"]>> }>
  > {
    const out: Array<{
      experimentId: string;
      result: Awaited<ReturnType<ExperimentRunner["dailyCheck"]>>;
    }> = [];
    for (const id of this.listActiveExperimentIds()) {
      out.push({ experimentId: id, result: await this.dailyCheck(id) });
    }
    return out;
  }

  getResults(experimentId: string): FactorialResult {
    const factors = this.getFactors(experimentId);
    return analyzeFactorial(this.db, experimentId, factors);
  }

  /** Harm-only early stop: variant significantly worse than static baseline cell. */
  checkEarlyStopping(experimentId: string): { stop: boolean; reason?: string } {
    const factors = this.getFactors(experimentId);
    let results: FactorialResult;
    try {
      results = this.getResults(experimentId);
    } catch {
      return { stop: false };
    }

    const routingFactor = factors.find((f) => f.name === "routing");
    const controlLevel = routingFactor?.levels.find((l) => String(l) === "static") ?? null;

    for (const me of results.mainEffects) {
      if (routingFactor && me.factor === "routing" && controlLevel != null) continue;
      if (me.n < 50) continue;
      if (me.effect < -0.05) {
        return {
          stop: true,
          reason: `${me.factor}=${me.level} underperforming (effect=${me.effect.toFixed(3)}, n=${me.n})`,
        };
      }
    }
    return { stop: false };
  }

  async dailyCheck(experimentId: string): Promise<DailyCheckResult> {
    const row = this.db
      .query(
        `SELECT status, start_date, min_duration_days, min_detectable_effect
         FROM experiments WHERE id = $id`,
      )
      .get({ $id: experimentId }) as {
      status: ExperimentStatus;
      start_date: string;
      min_duration_days: number;
      min_detectable_effect: number;
    } | null;
    if (!row || row.status !== "active") {
      return { status: "completed", daysRunning: 0 };
    }

    const daysRunning =
      (Date.now() - new Date(row.start_date).getTime()) / 86_400_000;

    const early = this.checkEarlyStopping(experimentId);
    if (early.stop) {
      this.conclude(experimentId, "early_stop", early.reason ?? "early stop");
      const results = this.getResults(experimentId);
      await persistExperimentSession(experimentId, results, {
        status: "early_stop",
        reason: early.reason,
      });
      return { status: "early_stop", daysRunning, results, reason: early.reason };
    }

    if (daysRunning < row.min_duration_days) {
      return { status: "running", daysRunning };
    }

    let results: FactorialResult;
    try {
      results = this.getResults(experimentId);
    } catch {
      return { status: "running", daysRunning };
    }

    const bestMain = results.mainEffects.reduce(
      (best, me) => (me.effect > best ? me.effect : best),
      -Infinity,
    );
    if (bestMain >= row.min_detectable_effect) {
      this.conclude(experimentId, "completed", "Target effect observed");
      await persistExperimentSession(experimentId, results, {
        status: "completed",
        reason: "Target effect observed",
      });
      return { status: "completed", daysRunning, results, reason: "Target effect observed" };
    }

    return { status: "running", daysRunning, results };
  }

  conclude(experimentId: string, status: ExperimentStatus, notes: string): void {
    this.db.query("UPDATE experiments SET status = $s, notes = $n WHERE id = $id").run({
      $s: status,
      $n: notes,
      $id: experimentId,
    });
  }
}
