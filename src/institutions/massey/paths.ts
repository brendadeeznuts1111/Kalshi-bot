// @see https://bun.com/docs/module-resolution#import-meta
import { CACHE_DIR, joinPath } from "../../research/paths.ts";

/** Massey institution module root. */
export const MASSEY_DIR = joinPath(import.meta.dir, ".");

/** Dedicated Massey ratings cache DB (gitignored, alongside event-store.db / cache.db). */
export const DEFAULT_MASSEY_DB = joinPath(CACHE_DIR, "massey.db");

/** Massey ratings site origin. */
export const MASSEY_ORIGIN = "https://masseyratings.com";
