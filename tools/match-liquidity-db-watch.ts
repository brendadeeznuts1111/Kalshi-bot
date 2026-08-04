#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/file-io
// @see https://nodejs.org/api/fs.html#fswatchfilename-options-listener
// @see https://bun.com/docs/runtime/utils#bun-env — Bun.env
/**
 * Rebuild match_liquidity HTML ground when event-store.db changes (fs.watch).
 * Debounced — SQLite WAL often emits several events per write.
 *
 *   bun run liquidity:ground:watch-db
 *   bun run liquidity:ground:watch-db -- --debounce=500
 *   bun run liquidity:ground:watch-db -- --once          # one rebuild, exit
 *   bun run liquidity:ground:watch-db -- --fetch-volume  # optional network
 *
 * Complements time-based Bun.cron (`liquidity:pipeline:register`): cron for
 * volume backfill / snapshot; this for immediate dashboard refresh after local
 * ingest/backfill.
 *
 * Watches the **cache directory** so late-created `-wal`/`-shm` sidecars still fire.
 */
import { dirname, basename } from "node:path";
import { watch, type FSWatcher } from "node:fs";
import { parseArgs } from "node:util";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  createDebounceScheduler,
  isEventStoreWatchFilename,
} from "../src/institutions/event-store/match-liquidity-db-watch.ts";
import {
  formatMatchLiquidityPipelineLines,
  runMatchLiquidityPipeline,
} from "../src/institutions/event-store/match-liquidity-pipeline.ts";

export type MatchLiquidityDbWatchCliOptions = {
  dbPath: string;
  debounceMs: number;
  fetchVolume: boolean;
  once: boolean;
  /** Skip initial rebuild (watch-only). */
  noInitial: boolean;
};

export function parseMatchLiquidityDbWatchCli(argv: string[]): MatchLiquidityDbWatchCliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      db: { type: "string" },
      debounce: { type: "string", default: "750" },
      "fetch-volume": { type: "boolean", default: false },
      once: { type: "boolean", default: false },
      "no-initial": { type: "boolean", default: false },
    },
    strict: false,
  });

  const debounceRaw = values.debounce ? Number(values.debounce) : 750;
  return {
    dbPath: typeof values.db === "string" ? values.db : DEFAULT_EVENT_STORE_DB,
    debounceMs: Math.max(100, Number.isFinite(debounceRaw) ? debounceRaw : 750),
    fetchVolume: values["fetch-volume"] === true,
    once: values.once === true,
    noInitial: values["no-initial"] === true,
  };
}

export async function rebuildMatchLiquidityFromDbWatch(
  opts: Pick<MatchLiquidityDbWatchCliOptions, "dbPath" | "fetchVolume">,
  reason: string,
): Promise<void> {
  console.error(`[liquidity:watch-db] ${reason}`);
  const t0 = Date.now();
  const result = await runMatchLiquidityPipeline({
    dbPath: opts.dbPath,
    fetchVolume: opts.fetchVolume,
    groundHtml: true,
    snapshot: false,
  });
  console.error(formatMatchLiquidityPipelineLines(result).join("\n"));
  console.error(`[liquidity:watch-db] done ${Date.now() - t0}ms`);
}

export async function runMatchLiquidityDbWatchMain(
  argv: string[] = Bun.argv.slice(2),
): Promise<number> {
  const opts = parseMatchLiquidityDbWatchCli(argv);
  const exists = await Bun.file(opts.dbPath).exists();
  if (!exists) {
    console.error(`[liquidity:watch-db] missing db: ${opts.dbPath}`);
    return 1;
  }

  if (!opts.noInitial) {
    try {
      await rebuildMatchLiquidityFromDbWatch(opts, "initial");
    } catch (err) {
      console.error(`[liquidity:watch-db] error:`, err);
      if (opts.once) return 1;
    }
  }

  if (opts.once) return 0;

  const dbBase = basename(opts.dbPath);
  const watchDir = dirname(opts.dbPath);
  const scheduler = createDebounceScheduler(async (reason) => {
    try {
      await rebuildMatchLiquidityFromDbWatch(opts, reason);
    } catch (err) {
      console.error(`[liquidity:watch-db] error:`, err);
    }
  }, opts.debounceMs);

  console.error(
    `[liquidity:watch-db] watching dir ${watchDir} for ${dbBase}(+-wal|-shm) · debounce ${opts.debounceMs}ms`,
  );
  console.error(`[liquidity:watch-db] Ctrl+C to stop · fetchVolume=${opts.fetchVolume}`);

  const watchers: FSWatcher[] = [];
  try {
    watchers.push(
      watch(watchDir, { persistent: true }, (eventType, filename) => {
        const name = typeof filename === "string" ? filename : null;
        if (!isEventStoreWatchFilename(name, dbBase)) return;
        scheduler.schedule(`${eventType}${name ? ` ${name}` : ""}`);
      }),
    );
  } catch (err) {
    console.error(`[liquidity:watch-db] dir watch failed, falling back to file:`, err);
    watchers.push(
      watch(opts.dbPath, { persistent: true }, (eventType, filename) => {
        const name = typeof filename === "string" ? filename : null;
        scheduler.schedule(`${eventType}${name ? ` ${name}` : ""}`);
      }),
    );
  }

  // Direct sidecars (when already present) — extra signal on platforms that
  // under-notify directory watches for WAL growth.
  for (const side of [`${opts.dbPath}-wal`, `${opts.dbPath}-shm`]) {
    if (await Bun.file(side).exists()) {
      try {
        watchers.push(
          watch(side, { persistent: true }, (eventType) => {
            scheduler.schedule(`sidecar ${basename(side)} ${eventType}`);
          }),
        );
      } catch {
        /* ignore */
      }
    }
  }

  const shutdown = () => {
    scheduler.cancel();
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise(() => {});
  return 0;
}

if (import.meta.main) {
  const code = await runMatchLiquidityDbWatchMain();
  if (code !== 0) process.exit(code);
}
