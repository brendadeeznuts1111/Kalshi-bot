// @see https://bun.com/docs/runtime/sqlite
import { mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import { CACHE_DIR, joinPath } from "../research/paths.ts";

export const OPS_EXPERIMENTS_DB = joinPath(CACHE_DIR, "ops-experiments.db");

export const EXPERIMENT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  factors_json TEXT NOT NULL,
  design_json TEXT NOT NULL,
  start_date TEXT NOT NULL,
  min_duration_days INTEGER NOT NULL DEFAULT 14,
  target_metric TEXT NOT NULL DEFAULT 'win_rate',
  min_detectable_effect REAL NOT NULL DEFAULT 0.02,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS experiment_variants (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  config_json TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS experiment_assignments (
  experiment_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (experiment_id, partner_id)
);

CREATE TABLE IF NOT EXISTS experiment_metrics (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  outcome REAL NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_experiment_metrics_exp ON experiment_metrics(experiment_id);
CREATE INDEX IF NOT EXISTS idx_experiment_assignments_exp ON experiment_assignments(experiment_id);
`;

export function ensureExperimentsSchema(db: Database): void {
  db.exec(EXPERIMENT_SCHEMA_SQL);
}

export type OpenExperimentsDbOptions = {
  dbPath?: string;
  readonly?: boolean;
};

export function openExperimentsDb(options: OpenExperimentsDbOptions = {}): Database {
  const dbPath = options.dbPath ?? OPS_EXPERIMENTS_DB;
  if (dbPath !== ":memory:" && !options.readonly) {
    mkdirSync(dbPath.replace(/\/[^/]+$/, ""), { recursive: true });
  }
  const db = new Database(dbPath, {
    create: !options.readonly,
    ...(options.readonly !== undefined ? { readonly: options.readonly } : {}),
  });
  db.run("PRAGMA foreign_keys = ON;");
  if (!options.readonly && dbPath !== ":memory:") {
    db.run("PRAGMA journal_mode = WAL;");
  }
  if (!options.readonly) {
    ensureExperimentsSchema(db);
  }
  return db;
}
