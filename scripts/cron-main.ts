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
 *   - Inventory: every 1 minute when PARTNER_SYNC=1 (stream-list → skin_events)
 *   - Seat finance: when PARTNER_FINANCE_CRON=1 (registry → capacity → optional Telegram)
 *   - Audit overlay:  weekly Sunday 00:00 UTC (opt-in AUDIT_OVERLAY_UPDATE=1, §99)
 *
 * TZ NOTE (Bun 1.4): in-process Bun.cron interprets schedules in the SYSTEM
 * LOCAL time zone (1.3.x used UTC). The UTC labels above describe intent;
 * only the massey job pins { tz: "UTC" } explicitly.
 */
import { $ } from "bun";
import { ensureEventStoreDir, openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { existsSync } from "node:fs";
import { runSnapshotCycle } from "./price-logger.ts";
import { syncSportsSourceMetadata } from "./sync-sports-source-metadata.ts";
import { createSportsSourceRuntime } from "../src/institutions/market-registry/runtime.ts";
import { unbrand } from "../src/institutions/market-registry/brands.ts";
import { createFanout, RELEASE_FANOUT_CHANNEL } from "../src/lib/fanout.ts";
import { refreshAuditOverlay } from "../tools/audit-overlay-update.ts";
import { maybeSendComplianceAlert } from "../src/lib/compliance-alert.ts";

// ── Config ──────────────────────────────────────────────────────

const INTERVAL_LOGGER = "*/5 * * * *";
export const INTERVAL_SPORTS_METADATA = "*/15 * * * *";
const INTERVAL_ANALYSIS = "0 8 * * *";
const INTERVAL_GLOSSARY_URLS = "0 2 * * *";
/** Weekly Bun release-blog watch (opt-in BUN_RELEASE_WATCH=1). */
export const INTERVAL_BUN_RELEASE = "0 6 * * 1";
/** Weekly audit-overlay refresh (opt-in AUDIT_OVERLAY_UPDATE=1, §99). */
export const INTERVAL_AUDIT_OVERLAY = "0 0 * * 0";
const AUDIT_OVERLAY_ENABLED = Bun.env.AUDIT_OVERLAY_UPDATE === "1";
const INTERVAL_COLOR_ARTIFACTS = "0 3 * * *";
const INTERVAL_CONTRAST = "0 4 * * *";
/** Match liquidity recompute + HTML ground (volume backfill opt-in via env). */
const INTERVAL_LIQUIDITY =
  Bun.env.LIQUIDITY_PIPELINE_CRON_SCHEDULE?.trim() || "*/30 * * * *";
/**
 * Coverage inventory poll (plive/ezlive stream-list → skin_events).
 * Enable with PARTNER_SYNC=1 (legacy name) or INVENTORY_SYNC=1.
 * Public inventory works with dummy FANTASY402_* when PARTNER_SYNC_PUBLIC=1.
 */
const INTERVAL_INVENTORY_SYNC =
  Bun.env.INVENTORY_SYNC_CRON_SCHEDULE?.trim() ||
  Bun.env.PARTNER_SYNC_CRON_SCHEDULE?.trim() ||
  "*/1 * * * *";
const INVENTORY_SYNC_ENABLED =
  Bun.env.INVENTORY_SYNC === "1" || Bun.env.PARTNER_SYNC === "1";
/**
 * After inventory tick: dry-run promote report (never applies COMPETITIONS).
 * Default on when candidates > 0 (summary line). Detail +C lines when =1.
 * Set INVENTORY_PROMOTE_REPORT=0 to silence.
 */
const INVENTORY_PROMOTE_REPORT =
  Bun.env.INVENTORY_PROMOTE_REPORT?.trim() !== "0";
const INVENTORY_PROMOTE_REPORT_DETAIL =
  Bun.env.INVENTORY_PROMOTE_REPORT === "1" ||
  Bun.env.INVENTORY_PROMOTE_REPORT_DETAIL === "1";
/** Telegram when promote candidate ids are new (needs TELEGRAM_* + this flag). */
const INVENTORY_PROMOTE_TELEGRAM = Bun.env.INVENTORY_PROMOTE_TELEGRAM === "1";
/** Registry desk report (capacity + env + inventory). Default daily 09:00 UTC. */
const INTERVAL_PARTNER_FINANCE =
  Bun.env.PARTNER_FINANCE_CRON_SCHEDULE?.trim() || "0 9 * * *";
const PARTNER_FINANCE_ENABLED = Bun.env.PARTNER_FINANCE_CRON === "1";
/**
 * Massey ratings sync + crossref. Enable with MASSEY_SYNC=1.
 * Sports/schedule/max-age come from massey.config.json5 (env overrides).
 */
const INTERVAL_MASSEY_SYNC =
  Bun.env.MASSEY_SYNC_CRON_SCHEDULE?.trim() || "0 3 * * *";
const MASSEY_SYNC_ENABLED = Bun.env.MASSEY_SYNC === "1";

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
  droppedTicks: () => number;
} {
  let active: Promise<T> | undefined;
  // §128: Bun.cron SKIP policy — a scheduled fire that collides with a
  // running job is LOST inside the runtime (not queued, not deferred).
  // Coalescing into the active run also drops the tick: expose the count
  // so the job can log catch-up pressure instead of failing silently.
  let dropped = 0;
  return {
    run() {
      if (active) {
        dropped += 1;
        return active;
      }
      const current = work().finally(() => {
        if (active === current) active = undefined;
      });
      active = current;
      return current;
    },
    droppedTicks: () => dropped,
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
  // §128 catch-up visibility: log when the SKIP policy (or coalescing)
  // dropped ticks — the 30m freshness deadline needs every 15m fire.
  const drops = sportsMetadataFlight.droppedTicks();
  if (drops > 0) {
    console.error(`[cron:sports-metadata] ${drops} tick(s) dropped since last run (Bun.cron SKIP policy, §128) — verify freshness`);
  }
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
    // Streaming idiom (docs/BUN_SHELL.md): no .quiet() -> live output + captured Buffers (approx stdout/stderr inherit)
    const { exitCode } = await $`bun ${script}`.cwd(import.meta.dir + "/..").nothrow();
    if (exitCode !== 0) throw new Error(`market-inefficiency exited ${exitCode}`);
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
 * Inventory sync — stream-list → skin_events (new inventory_id detection).
 * Opt-in: INVENTORY_SYNC=1 or PARTNER_SYNC=1. Sport: PARTNER_SYNC_SPORT / INVENTORY_SYNC_SPORT.
 * Enrich: PARTNER_SYNC_ENRICH_BOOKED=1 or INVENTORY_SYNC_ENRICH_BOOKED=1.
 */
async function jobInventorySync(): Promise<void> {
  if (!INVENTORY_SYNC_ENABLED) return;
  const start = Date.now();
  try {
    const { loadFantasy402ProfileFromEnv } = await import("../src/partner/account-profile.ts");
    const { getFantasySessionAdapter } = await import("../src/partner/index.ts");
    const { runInventorySync, formatSyncReport } = await import("../src/inventory/sync.ts");

    // Inventory is public; allow dummy credentials when PARTNER_SYNC_PUBLIC=1
    let profile = loadFantasy402ProfileFromEnv();
    if (
      !profile &&
      (Bun.env.INVENTORY_SYNC_PUBLIC === "1" || Bun.env.PARTNER_SYNC_PUBLIC === "1")
    ) {
      const { requireDefaultUrlForUltraMapper } = await import(
        "../src/domain/index.ts"
      );
      profile = {
        id: "fantasy402-public",
        partner: "fantasy402",
        url: requireDefaultUrlForUltraMapper(),
        status: "active",
        defaultLiveProduct: 2,
        meta: {
          customerID: "public",
          agentID: "public",
          password: "public",
          token: "public",
          currency: "USD",
        },
      };
    }
    if (!profile) {
      console.error(
        "[cron:inventory] skip — set FANTASY402_* env or INVENTORY_SYNC_PUBLIC=1",
      );
      return;
    }

    // Full-board default: sport=all (override with INVENTORY_SYNC_SPORT)
    const sport =
      Bun.env.INVENTORY_SYNC_SPORT?.trim() ||
      Bun.env.PARTNER_SYNC_SPORT?.trim() ||
      "all";
    const enrichBooked =
      Bun.env.INVENTORY_SYNC_ENRICH_BOOKED === "1" ||
      Bun.env.PARTNER_SYNC_ENRICH_BOOKED === "1";
    const { parseEnrichBookedScope } = await import("../src/inventory/sync.ts");
    const enrichBookedScope = parseEnrichBookedScope(
      Bun.env.INVENTORY_SYNC_ENRICH_SCOPE?.trim() ||
        Bun.env.PARTNER_SYNC_ENRICH_SCOPE?.trim(),
    );
    const adapter = getFantasySessionAdapter(profile, { warmSession: false });
    try {
      await adapter.login();
    } catch {
      /* stream-list does not require login */
    }
    const report = await runInventorySync(getDb(), adapter, {
      sport,
      enrichBooked,
      ...(enrichBooked ? { enrichBookedScope } : {}),
    });
    const head = formatSyncReport(report).split("\n");
    console.error(`[cron:inventory] ${head[0]} · ${Date.now() - start}ms`);
    for (const line of head) {
      const t = line.trim();
      if (
        t.startsWith("sports:") ||
        t.startsWith("newBySport:") ||
        t.startsWith("leagues:") ||
        t.startsWith("enrich:") ||
        t.startsWith("enrich-validate") ||
        t.startsWith("priced:") ||
        t.startsWith("odds-link")
      ) {
        console.error(`[cron:inventory] ${t}`);
      }
    }
    // Optional ops alert when enrich validation fails (TELEGRAM_* required)
    if (
      Bun.env.INVENTORY_ENRICH_TELEGRAM === "1" &&
      report.enrichValidation &&
      !report.enrichValidation.passed
    ) {
      try {
        const { maybeNotifyInventoryTelegram } = await import(
          "../src/inventory/notify.ts"
        );
        await maybeNotifyInventoryTelegram({
          title: `⚠️ Inventory enrich FAIL unlinked=${report.enrichValidation.unlinkedRemaining}`,
          lines: report.enrichValidation.errors.slice(0, 12),
        });
      } catch (tgErr) {
        console.error(`[cron:inventory] enrich-telegram: ${tgErr}`);
      }
    }
    if (report.leagues.inserted > 0) {
      const { formatLeagueLine } = await import("../src/inventory/leagues.ts");
      for (const L of report.leagues.newLeagues.slice(0, 8)) {
        console.error(`[cron:inventory] +L ${formatLeagueLine(L)}`);
      }
      if (report.leagues.inserted > 8) {
        console.error(
          `[cron:inventory] +L … ${report.leagues.inserted - 8} more new leagues`,
        );
      }
    }
    if (report.inserted > 0) {
      for (const line of report.newEvents.slice(0, 12)) {
        console.error(
          `[cron:inventory] + ${line.sport} · ${line.league} · ${line.home} vs ${line.away} · ${line.inventoryId}`,
        );
      }
      if (report.inserted > 12) {
        console.error(`[cron:inventory] + … ${report.inserted - 12} more new`);
      }
    }

    // Promote dry-report only — never writes competitions.ts from cron
    if (INVENTORY_PROMOTE_REPORT || INVENTORY_PROMOTE_TELEGRAM) {
      try {
        const { buildPromoteReport } = await import(
          "../src/inventory/promote-report.ts"
        );
        const minPeak = Number(Bun.env.INVENTORY_PROMOTE_MIN_PEAK ?? "1") || 1;
        const promo = buildPromoteReport(getDb(), { minPeak });
        if (
          INVENTORY_PROMOTE_REPORT &&
          (promo.plan.candidates.length > 0 || promo.unmappedInput > 0)
        ) {
          console.error(`[cron:inventory] ${promo.summaryLine}`);
          if (INVENTORY_PROMOTE_REPORT_DETAIL && promo.detailLines.length > 0) {
            for (const line of promo.detailLines) {
              console.error(`[cron:inventory]${line}`);
            }
          }
        }
        if (INVENTORY_PROMOTE_TELEGRAM && promo.plan.candidates.length > 0) {
          const { maybeNotifyPromoteReport } = await import(
            "../src/inventory/promote-notify.ts"
          );
          const n = await maybeNotifyPromoteReport(promo, { enabled: true });
          if (n.telegram === "sent") {
            console.error(
              `[cron:inventory] promote-telegram sent (${n.plan.reason}) new=${n.plan.newIds.length}`,
            );
          } else if (n.plan.shouldSend) {
            console.error(
              `[cron:inventory] promote-telegram ${n.telegram} (${n.plan.reason})`,
            );
          }
        }
      } catch (promoErr) {
        console.error(`[cron:inventory] promote-report: ${promoErr}`);
      }
    }
  } catch (err) {
    console.error(`[cron:inventory] Error: ${err}`);
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
    const partnerFilter = Bun.env.PARTNER_FINANCE_PARTNER?.trim();
    const report = await runFinanceCron(getDb(), {
      strictEnv: Bun.env.PARTNER_FINANCE_STRICT_ENV === "1",
      probeLogin: Bun.env.PARTNER_FINANCE_PROBE_LOGIN === "1",
      probeInventory: Bun.env.PARTNER_FINANCE_PROBE_INVENTORY !== "0",
      notify:
        Bun.env.PARTNER_FINANCE_NOTIFY === "1" ||
        Bun.env.PARTNER_TELEGRAM_NOTIFY === "true",
      ...(partnerFilter !== undefined ? { partnerFilter } : {}),
    });
    console.error(
      `[cron:partner-finance] ${formatFinanceCronReportText(report).split("\n")[0]} · notified=${report.notified} · ${Date.now() - start}ms`,
    );
  } catch (err) {
    console.error(`[cron:partner-finance] Error: ${err}`);
  }
}


/**
 * Massey ratings sync + crossref (Bun.cron, opt-in MASSEY_SYNC=1).
 * Syncs configured sports with a freshness gate, then crossrefs each
 * configured sport and logs coverage.
 */
/** Weekly Bun release-blog integration (Bun.cron, opt-in BUN_RELEASE_WATCH=1). */
async function jobBunReleaseWatch(): Promise<void> {
  if (Bun.env.BUN_RELEASE_WATCH !== "1") return;
  const start = Date.now();
  try {
    // Run the watch as a WORKER so the result arrives over BroadcastChannel
    // IN-PROCESS (verified: channels bridge worker threads + main, but NOT
    // separate processes). The worker stays REF'D deliberately: we wait for
    // its fan-out event (workers.mdx: message listeners also keep a worker
    // alive); worker.unref()/ref:false would detach it for fire-and-forget.
    const worker = new Worker(new URL("./release-watch-worker.ts", import.meta.url));
    const bus = createFanout(RELEASE_FANOUT_CHANNEL);
    // Wait for the fan-out event (the worker's real completion signal) or a
    // 2-minute timeout - Bun's Worker has no .exited property.
    const received = await Promise.race([
      new Promise<string | null>((resolve) => {
        const off = bus.onMessage((m) => {
          if (m.type !== "bun-release") return;
          off();
          console.error(`[cron:bun-release] fan-out received: ${m.title ?? m.version} (${m.present} present / ${m.absent} absent)`);
          resolve(String(m.title ?? m.version));
        });
      }),
      Bun.sleep(120_000).then(() => null),
    ]);
    bus.close();
    worker.terminate();
    if (!received) throw new Error("release worker finished without a fan-out event");
    console.error(`[cron:bun-release] ok (${received}) · ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`[cron:bun-release] Error: ${err}`);
  }
}

/** Weekly audit-overlay refresh (Bun.cron, opt-in AUDIT_OVERLAY_UPDATE=1, §99). */
async function jobAuditOverlay(): Promise<void> {
  if (!AUDIT_OVERLAY_ENABLED) return;
  const start = Date.now();
  try {
    const r = await refreshAuditOverlay();
    console.error("[cron:audit-overlay] " + r.found + " issue(s) found; overlay has " + r.total + " total entries \u00b7 " + (Date.now() - start) + "ms");
    // Release sign-off artifact (§103): regenerate the compliance report
    // on the same weekly cadence. Bun Shell spawn, like the massey job.
    const rep = await $`bun run licenses:report`.cwd(import.meta.dir + "/..").nothrow();
    console.error("[cron:audit-overlay] report: " + (rep.exitCode === 0 ? "written" : "FAILED (" + rep.exitCode + ")"));
    // Proactive compliance alert (§106): new advisories, gate FAIL, or
    // expiring exemptions -> one Telegram summary (opt-in COMPLIANCE_ALERTS=1;
    // deduped via .data/compliance-alert-state.json so a stable situation is
    // not re-sent weekly).
    const state = JSON.parse(await Bun.file(import.meta.dir + "/../.data/licenses-state.json").text().catch(() => "null"));
    const expiringSoon = state && typeof state === "object" ? Number((state as { expiringSoon?: unknown }).expiringSoon ?? 0) : 0;
    const alert = await maybeSendComplianceAlert(
      { found: r.found, reportOk: rep.exitCode === 0, expiringSoon, generatedAt: new Date().toISOString() },
      { enabled: Bun.env.COMPLIANCE_ALERTS === "1" },
    );
    if (alert !== "not-enabled" && alert !== "nothing-to-report") console.error("[cron:audit-overlay] compliance alert: " + alert);
  } catch (err) {
    console.error("[cron:audit-overlay] Error: " + err);
  }
}

async function jobMasseySync(): Promise<void> {
  if (!MASSEY_SYNC_ENABLED) return;
  const start = Date.now();
  try {
    const { loadMasseyConfig } = await import(
      "../src/institutions/massey/config.ts"
    );
    const cfg = loadMasseyConfig();
    const sportList = cfg.sync.sports.join(",");
    const { exitCode } = await $`bun run massey:sync -- --sport=${sportList} --write --max-age-hours=${cfg.sync.maxAgeHours} --rows=0`.cwd(import.meta.dir + "/..").nothrow();
    if (exitCode !== 0) throw new Error(`massey:sync exited ${exitCode}`);
    for (const sport of cfg.crossref.sports) {
      const cr = await $`bun run massey:crossref -- --sport=${sport} --rows=0`.cwd(import.meta.dir + "/..").nothrow();
      if (cr.exitCode !== 0) throw new Error(`massey:crossref ${sport} exited ${cr.exitCode}`);
    }
    // Automatic edge flags over the latest odds_ticks (live-capture contract).
    for (const sport of cfg.crossref.sports) {
      const fg = await $`bun run massey:edge-flags -- --sport=${sport} --report --rows=0`.cwd(import.meta.dir + "/..").nothrow();
      if (fg.exitCode !== 0) throw new Error(`massey:edge-flags ${sport} exited ${fg.exitCode}`);
    }
    console.error(`[cron:massey] sync+crossref+flags ok · ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`[cron:massey] Error: ${err}`);
  }
}

/** HEAD/GET check for OFFICIAL_URLS + glossary entry urls (hard via probe engine). */
async function jobGlossaryUrls(): Promise<void> {
  const start = Date.now();
  try {
    // Prefer hard check; soft only if GLOSSARY_URLS_SOFT=1 (flaky networks)
    const soft = Bun.env.GLOSSARY_URLS_SOFT === "1";
    const script = soft ? "glossary:urls:soft" : "glossary:urls";
    const { exitCode } = await $`bun run ${script}`.cwd(import.meta.dir + "/..").nothrow();
    if (exitCode !== 0) throw new Error(`${script} exited ${exitCode}`);
    console.error(`[cron:glossary-urls] ok (${script}) · ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`[cron:glossary-urls] Error: ${err}`);
  }
}

/** Regenerate color CSS / registry / docs from the kernel. */
async function jobColorArtifacts(): Promise<void> {
  const start = Date.now();
  try {
    const { exitCode } = await $`bun run colors:artifacts`.cwd(import.meta.dir + "/..").nothrow();
    if (exitCode !== 0) throw new Error(`colors:artifacts exited ${exitCode}`);
    console.error(`[cron:colors] artifacts ok · ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`[cron:colors] Error: ${err}`);
  }
}

/** Kernel WCAG on-color gate (+ optional WebView when CONTRAST_BASE_URL set). */
async function jobContrast(): Promise<void> {
  const start = Date.now();
  try {
    const { exitCode } = await $`bun run colors:contrast`.cwd(import.meta.dir + "/..").nothrow();
    if (exitCode !== 0) throw new Error(`colors:contrast exited ${exitCode}`);
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
    await jobInventorySync();
    await jobPartnerFinance();
    await jobMasseySync();
    await jobAuditOverlay();
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
  bun-rel:  ${Bun.env.BUN_RELEASE_WATCH === "1" ? INTERVAL_BUN_RELEASE : "off (BUN_RELEASE_WATCH=1)"}
  contrast: ${INTERVAL_CONTRAST}
  liquidity:${INTERVAL_LIQUIDITY}
  inventory: ${INVENTORY_SYNC_ENABLED ? INTERVAL_INVENTORY_SYNC : "off (INVENTORY_SYNC=1)"}
  finance:  ${PARTNER_FINANCE_ENABLED ? INTERVAL_PARTNER_FINANCE : "off (PARTNER_FINANCE_CRON=1)"}
  massey:   ${MASSEY_SYNC_ENABLED ? INTERVAL_MASSEY_SYNC : "off (MASSEY_SYNC=1)"}
  audit:    ${AUDIT_OVERLAY_ENABLED ? INTERVAL_AUDIT_OVERLAY : "off (AUDIT_OVERLAY_UPDATE=1)"}`);
  console.error("[cron] Process running — use SIGTERM to stop.");

  Bun.cron(INTERVAL_LOGGER, jobLogger);
  Bun.cron(INTERVAL_SPORTS_METADATA, jobSportsMetadata);
  Bun.cron(INTERVAL_ANALYSIS, jobAnalysis);
  Bun.cron(INTERVAL_GLOSSARY_URLS, jobGlossaryUrls);
  Bun.cron(INTERVAL_COLOR_ARTIFACTS, jobColorArtifacts);
  Bun.cron(INTERVAL_BUN_RELEASE, jobBunReleaseWatch);
  Bun.cron(INTERVAL_CONTRAST, jobContrast);
  Bun.cron(INTERVAL_LIQUIDITY, jobLiquidityPipeline);
  if (INVENTORY_SYNC_ENABLED) {
    Bun.cron(INTERVAL_INVENTORY_SYNC, jobInventorySync);
  }
  if (PARTNER_FINANCE_ENABLED) {
    Bun.cron(INTERVAL_PARTNER_FINANCE, jobPartnerFinance);
  }
  if (MASSEY_SYNC_ENABLED) {
    // Pin UTC: in-process Bun.cron defaults to system local time (1.4 change).
    Bun.cron(INTERVAL_MASSEY_SYNC, jobMasseySync, { tz: "UTC" });
  }
  if (AUDIT_OVERLAY_ENABLED) {
    // Pin UTC: in-process Bun.cron defaults to system local time (1.4 change).
    Bun.cron(INTERVAL_AUDIT_OVERLAY, jobAuditOverlay, { tz: "UTC" });
  }
  await new Promise(() => {});
}

if (import.meta.main) await main();