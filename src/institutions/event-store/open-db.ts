// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
import { mkdirSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { ensureCacheDir } from "../../research/cache.ts";
import { DEFAULT_EVENT_STORE_DB, SCHEMA_SQL_PATH } from "./paths.ts";

let defaultDb: Database | null = null;

export type OpenEventStoreOptions = {
  dbPath?: string;
  readonly?: boolean;
};

export async function ensureEventStoreDir(): Promise<void> {
  await ensureCacheDir();
}

export function openEventStore(options: OpenEventStoreOptions = {}): Database {
  const dbPath = options.dbPath ?? DEFAULT_EVENT_STORE_DB;
  if (!options.readonly && dbPath === DEFAULT_EVENT_STORE_DB && defaultDb) {
    return defaultDb;
  }
  if (dbPath !== ":memory:" && !options.readonly) {
    mkdirSync(dbPath.replace(/\/[^/]+$/, ""), { recursive: true });
  }
  const db = new Database(dbPath, {
    create: !options.readonly,
    readonly: options.readonly,
  });
  if (!options.readonly && dbPath !== ":memory:") {
    db.run("PRAGMA journal_mode = WAL;");
  }
  if (!options.readonly) {
    applyEventStoreSchema(db);
  }
  if (!options.readonly && dbPath === DEFAULT_EVENT_STORE_DB) {
    defaultDb = db;
  }
  return db;
}

export function applyEventStoreSchema(db: Database): void {
  const sql = readFileSync(SCHEMA_SQL_PATH, "utf8");
  db.exec(sql);
}

export function resetDefaultEventStoreForTests(): void {
  defaultDb = null;
}
