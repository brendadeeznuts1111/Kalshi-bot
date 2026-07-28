#!/usr/bin/env bun
/**
 * sweep-violations.ts — Delete old regulatory_violations rows by retention policy.
 *
 * Default retention: 90 days. Configurable via --retention-days or REG_VIOLATION_RETENTION_DAYS.
 *
 * Exit codes:
 *   0 — sweep completed (even if 0 rows deleted)
 *   1 — error (missing DB, etc.)
 *
 * Usage:
 *   bun src/regulatory/scripts/sweep-violations.ts
 *   bun src/regulatory/scripts/sweep-violations.ts --db ./data/regulatory.db --retention-days 30
 */

import { Database } from "bun:sqlite";

const RESET = "\x1b[0m";
function colorize(text: string, color: string): string {
  const code = Bun.color(color, "ansi") || Bun.color(color, "ansi-256") || "";
  return code ? `${code}${text}${RESET}` : text;
}
const c = {
  ok: (t: string) => colorize(t, "green"),
  err: (t: string) => colorize(t, "red"),
  info: (t: string) => colorize(t, "cyan"),
  warn: (t: string) => colorize(t, "orange"),
  dim: (t: string) => colorize(t, "gray"),
  bold: (t: string) => `\x1b[1m${t}${RESET}`,
};

function parseArgs(argv: string[]): { dbPath: string; retentionDays: number } {
  const dbIdx = argv.indexOf("--db");
  const retentionIdx = argv.indexOf("--retention-days");
  return {
    dbPath: dbIdx >= 0 ? argv[dbIdx + 1] : (process.env.REGULATORY_DB ?? ":memory:"),
    retentionDays: retentionIdx >= 0
      ? parseInt(argv[retentionIdx + 1], 10)
      : parseInt(process.env.REG_VIOLATION_RETENTION_DAYS ?? "90", 10),
  };
}

function main(): number {
  const { dbPath, retentionDays } = parseArgs(process.argv.slice(2));

  if (dbPath !== ":memory:" && !Bun.file(dbPath).exists()) {
    console.error(c.err(`✖ Database not found: ${dbPath}`));
    return 1;
  }

  const db = new Database(dbPath, { create: true });
  try {
    const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;

    // Check if table exists (migration may not have run yet)
    const tableExists = db
      .query<{ c: number }, []>(
        `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='regulatory_violations'`
      )
      .get()!.c;

    if (!tableExists) {
      console.log(c.dim("regulatory_violations table does not exist yet. Nothing to sweep."));
      return 0;
    }

    const beforeCount = db
      .query<{ c: number }, []>(`SELECT COUNT(*) as c FROM regulatory_violations`)
      .get()!.c;

    db.run(`DELETE FROM regulatory_violations WHERE blocked_at < ?`, [cutoff]);

    const afterCount = db
      .query<{ c: number }, []>(`SELECT COUNT(*) as c FROM regulatory_violations`)
      .get()!.c;

    const deleted = beforeCount - afterCount;
    if (deleted > 0) {
      console.log(c.ok(`✓ Sweep complete:`) + ` ${c.warn(String(deleted))} violation(s) deleted (retention: ${retentionDays} days)`);
    } else {
      console.log(c.dim(`✓ Sweep complete: 0 violations deleted (retention: ${retentionDays} days)`));
    }
    return 0;
  } catch (err) {
    console.error(c.err(`✖ Sweep failed: ${err instanceof Error ? err.message : String(err)}`));
    return 1;
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  process.exit(main());
}
