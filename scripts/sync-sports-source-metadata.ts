#!/usr/bin/env bun
import { parseArgs } from "node:util";
import type { Database } from "bun:sqlite";
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  abandonStaleRegisteredSourceMetadataRuns,
  planRegisteredSourceMetadata,
  runRegisteredSourceMetadata,
  type SourceMetadataRunResult,
} from "../src/institutions/event-store/source-metadata-runner.ts";
import {
  asSourceKey,
  asSportKey,
  unbrand,
  type SourceKey,
  type SportKey,
} from "../src/institutions/market-registry/brands.ts";
import { createSportsSourceRuntime } from "../src/institutions/market-registry/runtime.ts";
import { SPORTS_SOURCE_REGISTRY } from "../src/institutions/market-registry/registry.ts";
import type { RuntimeMetadataSourceAdapter } from "../src/institutions/market-registry/types.ts";
import {
  buildSportsSourceCatalogPayload,
  type SportsSourceCatalogPayload,
} from "../src/research/sports-source-catalog.ts";

export type SyncSportsSourceMetadataOptions = {
  db?: Database;
  dbPath?: string;
  adapters?: readonly RuntimeMetadataSourceAdapter[];
  sources?: readonly SourceKey[];
  sports?: readonly SportKey[];
  maxPagesPerSource?: number;
  now?: () => number;
};

export type SportsSourceMetadataSyncResult = {
  abandoned: number;
  completed: number;
  failed: number;
  runs: SourceMetadataRunResult[];
  catalog: SportsSourceCatalogPayload;
};

/** Migrate the event store, acquire every selected venue catalog, then publish the read model. */
export async function syncSportsSourceMetadata(
  options: SyncSportsSourceMetadataOptions = {},
): Promise<SportsSourceMetadataSyncResult> {
  const db = options.db ?? openEventStore({ dbPath: options.dbPath ?? DEFAULT_EVENT_STORE_DB });
  const adapters = options.adapters ?? createSportsSourceRuntime().metadataAdapters;
  const now = options.now ?? Date.now;
  const targets = planRegisteredSourceMetadata(
    SPORTS_SOURCE_REGISTRY,
    adapters,
    options.sources,
    options.sports,
  );
  const ownsCustomDb =
    options.db === undefined &&
    options.dbPath !== undefined &&
    options.dbPath !== DEFAULT_EVENT_STORE_DB;
  try {
    const abandoned = abandonStaleRegisteredSourceMetadataRuns(db, now(), targets);
    const runs = await runRegisteredSourceMetadata(db, {
      adapters,
      ...(options.sources ? { sources: options.sources } : {}),
      ...(options.sports ? { sports: options.sports } : {}),
      ...(options.maxPagesPerSource === undefined
        ? {}
        : { maxPagesPerSource: options.maxPagesPerSource }),
      now,
    });
    const completed = runs.filter((run) => run.state === "complete").length;
    const failed = runs.length - completed;
    return {
      abandoned,
      completed,
      failed,
      runs,
      catalog: buildSportsSourceCatalogPayload({ db, nowMs: now() }),
    };
  } finally {
    if (ownsCustomDb) db.close();
  }
}

type CliOptions = {
  dbPath?: string;
  sources?: SourceKey[];
  sports?: SportKey[];
  maxPagesPerSource?: number;
  json: boolean;
  help: boolean;
};

export function parseSportsSourceMetadataCli(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv.filter((arg) => arg !== "--"),
    options: {
      db: { type: "string" },
      source: { type: "string", multiple: true },
      sport: { type: "string", multiple: true },
      "max-pages": { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const maxPages = values["max-pages"] === undefined ? undefined : Number(values["max-pages"]);
  if (maxPages !== undefined && (!Number.isSafeInteger(maxPages) || maxPages < 1)) {
    throw new Error("--max-pages must be a positive integer");
  }
  return {
    ...(values.db ? { dbPath: values.db } : {}),
    ...(values.source ? { sources: splitFilters(values.source).map(asSourceKey) } : {}),
    ...(values.sport ? { sports: splitFilters(values.sport).map(asSportKey) } : {}),
    ...(maxPages === undefined ? {} : { maxPagesPerSource: maxPages }),
    json: values.json ?? false,
    help: values.help ?? false,
  };
}

function splitFilters(values: readonly string[]): string[] {
  const filters = values.flatMap((value) => value.split(",").map((part) => part.trim()));
  if (filters.some((filter) => !filter)) throw new Error("source/sport filters must be nonblank");
  return [...new Set(filters)];
}

function printSyncSummary(result: SportsSourceMetadataSyncResult): void {
  for (const run of result.runs) {
    const suffix = run.state === "failed" ? ` · ${run.error}` : "";
    console.log(
      `${unbrand(run.source)}: ${run.state} · ${run.observedMetadataCount} metadata · ${run.pageCount} page(s)${suffix}`,
    );
  }
  console.log(
    `sports/source metadata: ${result.completed} complete · ${result.failed} failed · ${result.abandoned} abandoned · catalog ${result.catalog.store.state}`,
  );
}

function printUsage(): void {
  console.log(`Usage: bun run sports:metadata:sync -- [options]

Options:
  --db <path>          Event-store SQLite path (default: research cache)
  --source <keys>      Repeatable/comma-separated source keys
  --sport <keys>       Repeatable/comma-separated sport keys
  --max-pages <n>      Per-source page safety bound (default: 100)
  --json               Emit the complete sync result and catalog
  --help               Show this help

Examples:
  bun run sports:metadata:sync
  bun run sports:metadata:sync -- --source=kalshi --sport=tennis,table_tennis
  bun run sports:metadata:sync -- --json`);
}

if (import.meta.main) {
  try {
    const cli = parseSportsSourceMetadataCli(Bun.argv.slice(2));
    if (cli.help) {
      printUsage();
      process.exit(0);
    }
    const result = await syncSportsSourceMetadata(cli);
    if (cli.json) console.log(JSON.stringify(result, null, 2));
    else printSyncSummary(result);
    process.exitCode = result.failed === 0 ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
