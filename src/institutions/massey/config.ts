// @see https://bun.com/docs/runtime/json5
/**
 * Massey pipeline config — JSON5 (Bun.JSON5.parse, no deps).
 * Defaults are the built-ins; massey.config.json5 overrides; env wins.
 */
import { existsSync, readFileSync } from "node:fs";

export type MasseySyncConfig = {
  /** Sport buckets to sync (massey:sync --sport list). */
  sports: string[];
  /** Skip targets with a snapshot fresher than this (hours). */
  maxAgeHours: number;
  /** Cron schedule (5-field) for the sync job. */
  schedule: string;
};

export type MasseyCrossrefConfig = {
  /** Sport buckets to cross-reference after sync. */
  sports: string[];
  /** Rows shown in the printed report. */
  reportRows: number;
};

export type MasseyConfig = {
  sync: MasseySyncConfig;
  crossref: MasseyCrossrefConfig;
};

export const DEFAULT_MASSEY_CONFIG: MasseyConfig = {
  sync: {
    sports: ["volleyball", "basketball", "tennis"],
    maxAgeHours: 24,
    schedule: "0 3 * * *",
  },
  crossref: {
    sports: ["tennis", "volleyball", "basketball"],
    reportRows: 10,
  },
};

export const DEFAULT_MASSEY_CONFIG_PATH = "massey.config.json5";

/** Deep-merge a partial config onto defaults. */
export function mergeMasseyConfig(
  base: MasseyConfig,
  patch: { sync?: Partial<MasseySyncConfig>; crossref?: Partial<MasseyCrossrefConfig> },
): MasseyConfig {
  return {
    sync: { ...base.sync, ...(patch.sync ?? {}) },
    crossref: { ...base.crossref, ...(patch.crossref ?? {}) },
  };
}

/**
 * Load massey.config.json5 (Bun.JSON5.parse), falling back to defaults.
 * Throws on a file that does not parse.
 */
export function loadMasseyConfig(
  path: string = DEFAULT_MASSEY_CONFIG_PATH,
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): MasseyConfig {
  let cfg = DEFAULT_MASSEY_CONFIG;
  if (existsSync(path)) {
    const parsed = Bun.JSON5.parse(readFileSync(path, "utf8")) as {
      sync?: Partial<MasseySyncConfig>;
      crossref?: Partial<MasseyCrossrefConfig>;
    };
    cfg = mergeMasseyConfig(cfg, parsed);
  }
  // Env overrides
  const sportsEnv = env.MASSEY_SYNC_SPORT?.trim();
  if (sportsEnv) cfg = { ...cfg, sync: { ...cfg.sync, sports: sportsEnv.split(",").map((s) => s.trim()).filter(Boolean) } };
  const maxAge = Number(env.MASSEY_SYNC_MAX_AGE_HOURS ?? "");
  if (Number.isFinite(maxAge) && maxAge > 0) cfg = { ...cfg, sync: { ...cfg.sync, maxAgeHours: maxAge } };
  const sched = env.MASSEY_SYNC_CRON_SCHEDULE?.trim();
  if (sched) cfg = { ...cfg, sync: { ...cfg.sync, schedule: sched } };
  return cfg;
}
