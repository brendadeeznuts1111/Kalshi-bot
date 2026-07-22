// @see https://bun.com/docs/runtime/sqlite#load-via-es-module-import
/**
 * Ephemeral on-disk sqlite paths under `tests/.tmp-*` (gitignored).
 * Prefer this over `:memory:<name>` — Bun treats only exact `:memory:` as RAM;
 * named `:memory:…` paths create files in the process cwd.
 */
import { unlinkSync } from "node:fs";
import { joinPath } from "../src/research/paths.ts";

export function tempSqlitePath(prefix: string): string {
  return joinPath(import.meta.dir, `.tmp-${prefix}-${Bun.randomUUIDv7()}.db`);
}

/** Best-effort remove db + WAL sidecars. */
export function unlinkSqlite(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(path + suffix);
    } catch {
      /* ok */
    }
  }
}
