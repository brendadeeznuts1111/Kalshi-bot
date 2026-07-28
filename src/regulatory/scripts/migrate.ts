#!/usr/bin/env bun
/**
 * migrate.ts — Idempotent regulatory migration runner with colorized output.
 *
 * Reads all `.sql` files from src/regulatory/db/migrations/ in lexical order,
 * skips already-applied migrations (tracked in `_regulatory_migrations`),
 * and runs each in a transaction.
 *
 * Exit codes:
 *   0 — all migrations applied (or nothing to do)
 *   1 — error (missing DB, bad SQL, etc.)
 *
 * Usage:
 *   bun src/regulatory/scripts/migrate.ts
 *   bun src/regulatory/scripts/migrate.ts --db ./data/regulatory.db
 */

import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "fs";
import { join, basename } from "path";
import { databasePath, migration } from "../config";

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

const MIGRATIONS_DIR = join(import.meta.dir, "..", migration.migrationsDir);

function parseArgs(argv: string[]): { dbPath: string } {
  const idx = argv.indexOf("--db");
  return { dbPath: idx >= 0 ? argv[idx + 1] : databasePath };
}

function ensureMigrationsTable(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS _regulatory_migrations (
    filename TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch()),
    checksum TEXT
  )`);
}

function listPendingMigrations(db: Database): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    db.query<{ filename: string }, []>(`SELECT filename FROM _regulatory_migrations`).all().map((r) => r.filename),
  );

  return files.filter((f) => !applied.has(f));
}

function sha256(text: string): string {
  const buffer = new TextEncoder().encode(text);
  return Bun.SHA256.hash(buffer, "hex");
}

function runMigration(db: Database, filename: string): void {
  const path = join(MIGRATIONS_DIR, filename);
  const sql = readFileSync(path, "utf-8");
  const checksum = sha256(sql);

  db.run("BEGIN IMMEDIATE");
  try {
    db.exec(sql);
    db.run(
      `INSERT INTO _regulatory_migrations (filename, checksum) VALUES (?, ?)`,
      [filename, checksum],
    );
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }
}

function main(): number {
  const { dbPath } = parseArgs(process.argv.slice(2));

  if (dbPath !== ":memory:" && !Bun.file(dbPath).exists()) {
    console.error(c.err(`✖ Database not found: ${dbPath}`));
    return 1;
  }

  const db = new Database(dbPath, { create: true });
  try {
    ensureMigrationsTable(db);
    const pending = listPendingMigrations(db);

    if (pending.length === 0) {
      console.log(c.dim("✓ No pending migrations."));
      return 0;
    }

    console.log(c.info(`Applying ${pending.length} migration(s):`));
    for (const filename of pending) {
      process.stdout.write(`  ${c.dim("→")} ${filename} … `);
      runMigration(db, filename);
      console.log(c.ok("✓"));
    }

    console.log(c.ok(`\n✓ Applied ${pending.length} migration(s).`));
    return 0;
  } catch (err) {
    console.error(c.err(`\n✖ Migration failed: ${err instanceof Error ? err.message : String(err)}`));
    return 1;
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  process.exit(main());
}
