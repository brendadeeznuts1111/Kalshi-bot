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
 *   - Sports metadata:   every 15 minutes
 *   - Daily analysis:    daily at 08:00 UTC
 *   - Color artifacts:   daily at 03:00 UTC
 *   - Contrast gate:     daily at 04:00 UTC
 *   - Glossary URLs:     daily at 02:00 UTC
 *   - Match liquidity:   every 30 minutes (recompute + ground; volume via env)
 *   - Partner inventory: every 1 minute when PARTNER_SYNC=1 (stream-list → partner_events)
 *   - Partner desk/finance: when PARTNER_FINANCE_CRON=1 (registry → capacity → optional Telegram)
 */
import { ensureEventStoreDir, openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { existsSync } from "node:fs";
import { runSnapshotCycle } from "./price-logger.ts";
import { syncSportsSourceMetadata } from "./sync-sports-source-metadata.ts";
import { createSportsSourceRuntime } from "../src/institutions/market-registry/runtime.ts";
import { unbrand } from "../src/institutions/market-registry/brands.ts";

// ── Config ──────────────────────────────────────────────────────

const INTERVAL_LOGGER = "*/5 * * * *";
export const INTERVAL_SPORTS_METADATA = "*/15 * * * *";
const INTERVAL_ANALYSIS = "0 8 * * *";
const INTERVAL_GLOSSARY_URLS = "0 2 * * *";
const INTERVAL_COLOR_ARTIFACTS = "0 3 * * *";
const INTERVAL_CONTRAST = "0 4 * * *";
/** Match liquidity recompute + HTML ground (volume backfill opt-in via env). */
const INTERVAL_LIQUIDITY =
  Bun.env.LIQUIDITY_PIPELINE_CRON_SCHEDULE?.trim() || "*/30 * * * *";
/**
 * Partner stream inventory (Fantasy402 table tennis by default).
 * Enable with PARTNER_SYNC=1. Public inventory works with dummy FANTASY402_* env.
 */
const INTERVAL_PARTNER_SYNC =
  Bun.env.PARTNER_SYNC_CRON_SCHEDULE?.trim() || "*/1 * * * *";
const PARTNER_SYNC_ENABLED = Bun.env.PARTNER_SYNC === "1";
/** Registry desk report (capacity + env + inventory). Default daily 09:00 UTC. */
const INTERVAL_PARTNER_FINANCE =
  Bun.env.PARTNER_FINANCE_CRON_SCHEDULE?.trim() || "0 9 * * *";
const PARTNER_FINANCE_ENABLED = Bun.env.PARTNER_FINANCE_CRON === "1";

// ── Jobs ────────────────────────────────────────────────────────

let db: ReturnType<typeof openEventStore> | null = null;
const sportsSourceRuntime = createSportsSourceRuntime();

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

export function createSingleFlight<T>(work: () => Promise<T>): {
  run: () => Promise<T>;
  drain: () => Promise<void>;
} {
  let active: Promise<T> | undefined;
  return {
    run() {
      if (active) return active;
      const current = work().finally(() => {
        if (active === current) active = undefined;
      });
      active = current;
      return current;
    },
    async drain() {
      if (active) await active;
    },
  };
}

/** Refresh source-global Kalshi and Polymarket catalogs before their 30m freshness deadline. */
async function runSportsMetadata(): Promise<boolean> {
  const start = Date.now();
  try {
    const result = await syncSportsSourceMetadata({
      db: getDb(),
      adapters: sportsSourceRuntime.metadataAdapters,
    });
    const failures = result.runs
      .filter((run) => run.state === "failed")
      .map((run) => `${unbrand(run.source)}=${run.error}`)
      .join("; ");
    console.error(
      `[cron:sports-metadata] ${result.completed} complete · ${result.failed} failed · ${result.abandoned} abandoned · ${Date.now() - start}ms${failures ? ` · ${failures}` : ""}`,
    );
    return result.failed === 0;
  } catch (err) {
    console.error(`[cron:sports-metadata] Error: ${err}`);
    return false;
  }
}

const sportsMetadataFlight = createSingleFlight(runSportsMetadata);

export function jobSportsMetadata(): Promise<boolean> {
  return sportsMetadataFlight.run();
}

export function drainSportsMetadataJob(): Promise<void> {
  return sportsMetadataFlight.drain();
}

/** Daily market inefficiency analysis. */
async function jobAnalysis(): Promise<void> {
  const start = Date.now();
  try {
    const script = `${import.meta.dir}/market-inefficiency.ts`;
    if (!existsSync(script)) {
      console.error("[cron:analysis] Skipped · scripts/market-inefficiency.ts is not installed");
      return;
    }
    const proc = Bun.spawn(["bun", script], {
      cwd: import.meta.dir + "/..",
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) throw new Error(`market-inefficiency exited ${code}`);
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

/**
 * Partner inventory sync — stream-list → partner_events (new stream_id detection).
 * Opt-in: PARTNER_SYNC=1. Sport: PARTNER_SYNC_SPORT (default table_tennis).
 * Enrich: PARTNER_SYNC_ENRICH_BOOKED=1 (soft Statscore name match, no prices).
 */
async function jobPartnerSync(): Promise<void> {
  if (!PARTNER_SYNC_ENABLED) return;
  const start = Date.now();
  try {
    const { loadFantasy402ProfileFromEnv } = await import("../src/partner/account-profile.ts");
    const { getFantasySessionAdapter } = await import("../src/partner/index.ts");
    const { runPartnerInventorySync, formatSyncReport } = await import("../src/partner/sync.ts");

    // Inventory is public; allow dummy credentials when PARTNER_SYNC_PUBLIC=1
    let profile = loadFantasy402ProfileFromEnv();
    if (!profile && Bun.env.PARTNER_SYNC_PUBLIC === "1") {
      profile = {
        id: "fantasy402-public",
        partner: "fantasy402",
        url: "https://fantasy402.com",
        status: "active",
        meta: {
          customerID: "public",
          agentID: "public",
          password: "public",
          token: "public",
          skin: 2,
          currency: "USD",
        },
      };
    }
    if (!profile) {
      console.error(
        "[cron:partner] skip — set FANTASY402_* env or PARTNER_SYNC_PUBLIC=1",
      );
      return;
    }

    const sport = Bun.env.PARTNER_SYNC_SPORT?.trim() || "table_tennis";
    const enrichBooked = Bun.env.PARTNER_SYNC_ENRICH_BOOKED === "1";
    const adapter = getFantasySessionAdapter(profile, { warmSession: false });
    try {
      await adapter.login();
    } catch {
      /* stream-list does not require login */
    }
    const report = await runPartnerInventorySync(getDb(), adapter, {
      sport,
      enrichBooked,
    });
    console.error(
      `[cron:partner] ${formatSyncReport(report).split("\n")[0]} · ${Date.now() - start}ms`,
    );
    if (report.inserted > 0) {
      for (const line of report.newEvents.slice(0, 8)) {
        console.error(
          `[cron:partner] + ${line.sport} · ${line.league} · ${line.home} vs ${line.away} · ${line.streamId}`,
        );
      }
    }
  } catch (err) {
    console.error(`[cron:partner] Error: ${err}`);
  }
}

/**
 * Partner desk / finance report from SQLite registry.
 * Opt-in: PARTNER_FINANCE_CRON=1. Notify: PARTNER_FINANCE_NOTIFY=1.
 */
async function jobPartnerFinance(): Promise<void> {
  if (!PARTNER_FINANCE_ENABLED) return;
  const start = Date.now();
  try {
    const { runFinanceCron, formatFinanceCronReportText } = await import(
      "../src/partner/finance-cron.ts"
    );
    const report = await runFinanceCron(getDb(), {
      strictEnv: Bun.env.PARTNER_FINANCE_STRICT_ENV === "1",
      partnerFilter: Bun.env.PARTNER_FINANCE_PARTNER?.trim(),
      probeLogin: Bun.env.PARTNER_FINANCE_PROBE_LOGIN === "1",
      probeInventory: Bun.env.PARTNER_FINANCE_PROBE_INVENTORY !== "0",
      notify:
        Bun.env.PARTNER_FINANCE_NOTIFY === "1" ||
        Bun.env.PARTNER_TELEGRAM_NOTIFY === "true",
    });
    console.error(
      `[cron:partner-finance] ${formatFinanceCronReportText(report).split("\n")[0]} · notified=${report.notified} · ${Date.now() - start}ms`,
    );
  } catch (err) {
    console.error(`[cron:partner-finance] Error: ${err}`);
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

async function main(): Promise<void> {
  const once = process.argv.slice(2).includes("--once");
  let shuttingDown = false;
  const shutdown = async (signal: "SIGHUP" | "SIGTERM" | "SIGINT") => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`[cron] received ${signal}, draining sports metadata`);
    await drainSportsMetadataJob();
    if (db) {
      try {
        db.close();
      } catch {}
    }
    process.exit(0);
  };
  for (const signal of ["SIGHUP", "SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => void shutdown(signal));
  }

  if (once) {
    console.error("[cron] Once mode — running all jobs...");
    await jobLogger();
    const metadataOk = await jobSportsMetadata();
    await jobAnalysis();
    await jobGlossaryUrls();
    await jobColorArtifacts();
    await jobContrast();
    await jobLiquidityPipeline();
    await jobPartnerSync();
    await jobPartnerFinance();
    console.error(`[cron] All jobs complete · sports metadata ${metadataOk ? "ok" : "failed"}.`);
    process.exitCode = metadataOk ? 0 : 1;
    return;
  }

  console.error(`[cron] Registering jobs:
  logger:   ${INTERVAL_LOGGER}
  metadata: ${INTERVAL_SPORTS_METADATA}
  analysis: ${INTERVAL_ANALYSIS}
  urls:     ${INTERVAL_GLOSSARY_URLS}
  colors:   ${INTERVAL_COLOR_ARTIFACTS}
  contrast: ${INTERVAL_CONTRAST}
  liquidity:${INTERVAL_LIQUIDITY}
  partner:  ${PARTNER_SYNC_ENABLED ? INTERVAL_PARTNER_SYNC : "off (PARTNER_SYNC=1)"}
  finance:  ${PARTNER_FINANCE_ENABLED ? INTERVAL_PARTNER_FINANCE : "off (PARTNER_FINANCE_CRON=1)"}`);
  console.error("[cron] Process running — use SIGTERM to stop.");

  Bun.cron(INTERVAL_LOGGER, jobLogger);
  Bun.cron(INTERVAL_SPORTS_METADATA, jobSportsMetadata);
  Bun.cron(INTERVAL_ANALYSIS, jobAnalysis);
  Bun.cron(INTERVAL_GLOSSARY_URLS, jobGlossaryUrls);
  Bun.cron(INTERVAL_COLOR_ARTIFACTS, jobColorArtifacts);
  Bun.cron(INTERVAL_CONTRAST, jobContrast);
  Bun.cron(INTERVAL_LIQUIDITY, jobLiquidityPipeline);
  if (PARTNER_SYNC_ENABLED) {
    Bun.cron(INTERVAL_PARTNER_SYNC, jobPartnerSync);
  }
  if (PARTNER_FINANCE_ENABLED) {
    Bun.cron(INTERVAL_PARTNER_FINANCE, jobPartnerFinance);
  }
  await new Promise(() => {});
}

if (import.meta.main) await main();
