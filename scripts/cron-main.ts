#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/cron
/**
 * Cron master — consolidates all periodic jobs into a single process using Bun.cron().
 *
 * Usage:
 *   bun run cron:start           # Start all cron jobs (keeps process alive)
 *   bun run cron:start -- --once # Run each job once, then exit
 *
 * Registered jobs:
 *   - Price logger:      every 5 minutes
 *   - Daily analysis:    daily at 08:00 UTC
 *   - Color artifacts:   daily at 03:00 UTC
 *   - Contrast gate:     daily at 04:00 UTC
 *   - Glossary URLs:     daily at 02:00 UTC
 *   - Match liquidity:   every 30 minutes (recompute + ground; volume via env)
 */
import { ensureEventStoreDir, openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { runSnapshotCycle } from "../scripts/price-logger.ts";
import { runAnalysis } from "../scripts/market-inefficiency.ts";

// ── Config ──────────────────────────────────────────────────────

const INTERVAL_LOGGER = "*/5 * * * *";
const INTERVAL_ANALYSIS = "0 8 * * *";
const INTERVAL_GLOSSARY_URLS = "0 2 * * *";
const INTERVAL_COLOR_ARTIFACTS = "0 3 * * *";
const INTERVAL_CONTRAST = "0 4 * * *";
/** Match liquidity recompute + HTML ground (volume backfill opt-in via env). */
const INTERVAL_LIQUIDITY =
  Bun.env.LIQUIDITY_PIPELINE_CRON_SCHEDULE?.trim() || "*/30 * * * *";

// ── Jobs ────────────────────────────────────────────────────────

let db: ReturnType<typeof openEventStore> | null = null;

function getDb() {
  if (!db) {
    ensureEventStoreDir();
    db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  }
  return db;
}

/** Price snapshot capture — every 5 minutes. */
async function jobLogger(): Promise<void> {
  const start = Date.now();
  try {
    const count = await runSnapshotCycle(getDb());
    const total = getDb().query("SELECT COUNT(*) AS n FROM price_snapshots").get() as { n: number };
    console.error(`[cron:logger] ${count} new snapshots · ${total.n} total · ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`[cron:logger] Error: ${err}`);
  }
}

/** Daily market inefficiency analysis. */
async function jobAnalysis(): Promise<void> {
  const start = Date.now();
  try {
    await runAnalysis(getDb());
    console.error(`[cron:analysis] Complete · ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`[cron:analysis] Error: ${err}`);
  }
}

/**
 * Match liquidity desk loop — recompute + optional volume backfill + ground HTML.
 * Network backfill: LIQUIDITY_PIPELINE_FETCH_VOLUME=1 (default off in long-running cron).
 * Snapshot write: LIQUIDITY_PIPELINE_SNAPSHOT=1 (default off — use OS cron worker for full loop).
 */
async function jobLiquidityPipeline(): Promise<void> {
  const start = Date.now();
  try {
    const { runMatchLiquidityPipeline, formatMatchLiquidityPipelineLines } = await import(
      "../src/institutions/event-store/match-liquidity-pipeline.ts"
    );
    const fetchVolume = Bun.env.LIQUIDITY_PIPELINE_FETCH_VOLUME === "1";
    const snapshot = Bun.env.LIQUIDITY_PIPELINE_SNAPSHOT === "1";
    const volumeLimit = Number(Bun.env.LIQUIDITY_PIPELINE_VOLUME_LIMIT ?? "40");
    const result = await runMatchLiquidityPipeline({
      fetchVolume,
      volumeLimit: Number.isFinite(volumeLimit) && volumeLimit > 0 ? volumeLimit : 40,
      groundHtml: true,
      snapshot,
      dryRunSnapshot: false,
    });
    console.error(
      `[cron:liquidity] ${formatMatchLiquidityPipelineLines(result).join(" · ")} · ${Date.now() - start}ms`,
    );
  } catch (err) {
    console.error(`[cron:liquidity] Error: ${err}`);
  }
}

/** HEAD/GET check for OFFICIAL_URLS + glossary entry urls (hard via probe engine). */
async function jobGlossaryUrls(): Promise<void> {
  const start = Date.now();
  try {
    // Prefer hard check; soft only if GLOSSARY_URLS_SOFT=1 (flaky networks)
    const soft = Bun.env.GLOSSARY_URLS_SOFT === "1";
    const script = soft ? "glossary:urls:soft" : "glossary:urls";
    const proc = Bun.spawn(["bun", "run", script], {
      cwd: import.meta.dir + "/..",
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) throw new Error(`${script} exited ${code}`);
    console.error(`[cron:glossary-urls] ok (${script}) · ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`[cron:glossary-urls] Error: ${err}`);
  }
}

/** Regenerate color CSS / registry / docs from the kernel. */
async function jobColorArtifacts(): Promise<void> {
  const start = Date.now();
  try {
    const proc = Bun.spawn(["bun", "run", "colors:artifacts"], {
      cwd: import.meta.dir + "/..",
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) throw new Error(`colors:artifacts exited ${code}`);
    console.error(`[cron:colors] artifacts ok · ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`[cron:colors] Error: ${err}`);
  }
}

/** Kernel WCAG on-color gate (+ optional WebView when CONTRAST_BASE_URL set). */
async function jobContrast(): Promise<void> {
  const start = Date.now();
  try {
    const proc = Bun.spawn(["bun", "run", "colors:contrast"], {
      cwd: import.meta.dir + "/..",
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) throw new Error(`colors:contrast exited ${code}`);
    console.error(`[cron:contrast] ok · ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`[cron:contrast] Error: ${err}`);
  }
}

// ── CLI ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const once = args.includes("--once");

// Graceful shutdown — close DB and exit on SIGTERM/SIGHUP/SIGINT.
let shuttingDown = false;
for (const sig of ["SIGHUP", "SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`[cron] received ${sig}, shutting down`);
    if (db) {
      try { db.close(); } catch {}
    }
    process.exit(0);
  });
}

if (once) {
  // Run each job once for testing
  console.error("[cron] Once mode — running all jobs...");
  await jobLogger();
  await jobAnalysis();
  await jobGlossaryUrls();
  await jobColorArtifacts();
  await jobContrast();
  await jobLiquidityPipeline();
  console.error("[cron] All jobs complete.");
  process.exit(0);
}

// Register cron jobs
console.error(`[cron] Registering jobs:
  logger:   ${INTERVAL_LOGGER}
  analysis: ${INTERVAL_ANALYSIS}
  urls:     ${INTERVAL_GLOSSARY_URLS}
  colors:   ${INTERVAL_COLOR_ARTIFACTS}
  contrast: ${INTERVAL_CONTRAST}
  liquidity:${INTERVAL_LIQUIDITY}`);
console.error("[cron] Process running — use SIGTERM to stop.");

Bun.cron(INTERVAL_LOGGER, jobLogger);
Bun.cron(INTERVAL_ANALYSIS, jobAnalysis);
Bun.cron(INTERVAL_GLOSSARY_URLS, jobGlossaryUrls);
Bun.cron(INTERVAL_COLOR_ARTIFACTS, jobColorArtifacts);
Bun.cron(INTERVAL_CONTRAST, jobContrast);
Bun.cron(INTERVAL_LIQUIDITY, jobLiquidityPipeline);

// Keep process alive
await new Promise(() => {});
