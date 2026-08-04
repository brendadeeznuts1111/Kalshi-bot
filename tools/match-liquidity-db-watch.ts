#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/file-io
// @see https://nodejs.org/api/fs.html#fswatchfilename-options-listener
/**
 * Rebuild match_liquidity HTML ground when event-store.db changes (fs.watch).
 * Debounced — SQLite WAL often emits several events per write.
 *
 *   bun run liquidity:ground:watch-db
 *   bun run liquidity:ground:watch-db -- --debounce=500 --recompute
 *
 * Complements time-based Bun.cron (PR #5): cron for volume backfill / snapshot;
 * this for immediate dashboard refresh after local ingest/backfill.
 */
import { watch } from "node:fs";
import { parseArgs } from "node:util";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  formatMatchLiquidityPipelineLines,
  runMatchLiquidityPipeline,
} from "../src/institutions/event-store/match-liquidity-pipeline.ts";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    db: { type: "string" },
    debounce: { type: "string", default: "750" },
    recompute: { type: "boolean", default: true },
    "fetch-volume": { type: "boolean", default: false },
    once: { type: "boolean", default: false },
  },
  strict: false,
});

const dbPath = typeof values.db === "string" ? values.db : DEFAULT_EVENT_STORE_DB;
const debounceMs = Math.max(100, Number(values.debounce) || 750);
const doRecompute = values.recompute !== false;
const fetchVolume = values["fetch-volume"] === true;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let pending = false;

async function rebuild(reason: string): Promise<void> {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  const t0 = Date.now();
  try {
    console.error(`[liquidity:watch-db] ${reason}`);
    // Pipeline always recomputes then writes HTML ground (cheap offline path).
    const result = await runMatchLiquidityPipeline({
      dbPath,
      fetchVolume: fetchVolume && doRecompute,
      groundHtml: true,
      snapshot: false,
    });
    console.error(formatMatchLiquidityPipelineLines(result).join("\n"));
    console.error(`[liquidity:watch-db] done ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[liquidity:watch-db] error:`, err);
  } finally {
    running = false;
    if (pending) {
      pending = false;
      void rebuild("coalesced");
    }
  }
}

function schedule(reason: string): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void rebuild(reason);
  }, debounceMs);
}

const exists = await Bun.file(dbPath).exists();
if (!exists) {
  console.error(`[liquidity:watch-db] missing db: ${dbPath}`);
  process.exit(1);
}

// Initial build
await rebuild("initial");

if (values.once === true) {
  process.exit(0);
}

// SQLite may write to db, db-wal, db-shm — watch the directory basename
const watchTarget = dbPath;
console.error(`[liquidity:watch-db] watching ${watchTarget} (debounce ${debounceMs}ms)`);
console.error(`[liquidity:watch-db] Ctrl+C to stop · fetchVolume=${fetchVolume}`);

const watcher = watch(watchTarget, { persistent: true }, (eventType, filename) => {
  schedule(`${eventType}${filename ? ` ${filename}` : ""}`);
});

// Also watch WAL if present (common companion)
for (const side of [`${dbPath}-wal`, `${dbPath}-shm`]) {
  if (await Bun.file(side).exists()) {
    watch(side, { persistent: true }, (eventType) => schedule(`wal ${eventType}`));
  }
}

process.on("SIGINT", () => {
  watcher.close();
  process.exit(0);
});

await new Promise(() => {});
