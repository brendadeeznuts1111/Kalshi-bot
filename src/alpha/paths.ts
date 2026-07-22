// @see https://bun.com/docs/runtime/module-resolution#import-meta
import { CACHE_DIR, joinPath } from "../research/paths.ts";

export const ALPHA_ROOT = joinPath(import.meta.dir, "..");
export const ODDS_CACHE_DB = joinPath(CACHE_DIR, "odds-cache.db");
export const TICKER_MAP_DB = joinPath(CACHE_DIR, "ticker-map.db");
export const SHADOW_LOG_PATH = joinPath(CACHE_DIR, "shadow-log.jsonl");
export const TICKER_OVERRIDES_PATH = joinPath(joinPath(import.meta.dir, "../../research"), "ticker-overrides.json");
