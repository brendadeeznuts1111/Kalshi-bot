// @see https://bun.com/docs/runtime/module-resolution#import-meta
import { CACHE_DIR, joinPath } from "../../research/paths.ts";

export const EVENT_STORE_DIR = joinPath(import.meta.dir, ".");
export const SCHEMA_SQL_PATH = joinPath(EVENT_STORE_DIR, "schema.sql");
export const DEFAULT_EVENT_STORE_DB = joinPath(CACHE_DIR, "event-store.db");
