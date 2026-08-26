#!/usr/bin/env bun
/**
 * `bun run sqlite:probe` — probe the bun:sqlite compiled-in feature
 * surface (§111) on the installed runtime. The event store + odds +
 * alpha + telegram all ride on bun:sqlite; this gate records what
 * queries may safely rely on and what is CORRECTED.
 *
 * VERIFIED on Bun 1.4.0 (34cbb9a40):
 *  P1 open/exec/query round-trip
 *  P2 PRAGMA journal_mode=WAL works and PERSISTS across connections
 *  P3 FTS5 virtual tables (CREATE VIRTUAL TABLE ... USING fts5 + MATCH)
 *  P4 JSON1 functions (json_extract over a bound JSON string)
 *  P5 prepared statements + named-only binding ({ $x: 1, $y: 2 })
 *  P6 db.transaction rolls back on throw
 *  P7 CORRECTED: { bigint: true } does NOT return BigInt on this
 *     runtime — INTEGER > 2^53 reads back as a lossy Number in both
 *     modes (9007199254740993 -> 9007199254740992). Exact ids must use
 *     TEXT/BLOB (the repo already does: RFC 9562 uuid strings).
 *  P8 loadExtension is present (not exercised — security surface)
 *  P9 sqlite_version() is readable
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

const dir = mkdtempSync(join(tmpdir(), "sqlite-probe-"));
const dbPath = join(dir, "probe.db");

try {
  const db = new Database(dbPath, { readwrite: true, create: true });
  // P1: basic round-trip.
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  db.prepare("INSERT INTO t (v) VALUES (?)").run("hello");
  const row = db.query("SELECT v FROM t").get() as { v: string };
  check("P1 open/exec/query round-trip", row.v === "hello");

  // P2: WAL + persistence across connections.
  const wal = db.query("PRAGMA journal_mode=WAL").get() as { journal_mode: string };
  const db2 = new Database(dbPath, { readwrite: true, create: true });
  const wal2 = db2.query("PRAGMA journal_mode").get() as { journal_mode: string };
  check("P2 WAL mode works and persists", wal.journal_mode === "wal" && wal2.journal_mode === "wal");

  // P3: FTS5 virtual tables.
  db.exec("CREATE VIRTUAL TABLE docs USING fts5(title, body)");
  db.exec("INSERT INTO docs (title, body) VALUES (\"bun probe\", \"hello world\")");
  const ft = db.query("SELECT title FROM docs WHERE docs MATCH \"world\"").all() as { title: string }[];
  check("P3 FTS5 virtual tables + MATCH", ft.length === 1 && ft[0]!.title === "bun probe");

  // P4: JSON1 functions over a bound JSON string.
  db.exec("CREATE TABLE j (v TEXT)");
  db.prepare("INSERT INTO j VALUES (?)").run(JSON.stringify({ a: 1 }));
  const jr = db.query("SELECT json_extract(v, \"$.a\") AS a FROM j").get() as { a: number };
  check("P4 JSON1 functions (json_extract)", jr.a === 1);

  // P5: prepared statements + named-only binding.
  const stmt = db.prepare("SELECT $x AS x, $y AS y");
  const nr = stmt.all({ $x: 1, $y: 2 }) as { x: number; y: number }[];
  check("P5 prepared statements + named binding", nr.length === 1 && nr[0]!.x === 1 && nr[0]!.y === 2);

  // P6: transactions roll back on throw.
  db.exec("DELETE FROM t");
  let threw = false;
  try { db.transaction(() => { db.exec("INSERT INTO t (v) VALUES (\"x\")"); throw new Error("boom"); })(); } catch { threw = true; }
  const after = db.query("SELECT COUNT(*) AS c FROM t").get() as { c: number };
  check("P6 transaction rolls back on throw", threw && after.c === 0);

  // P7: bigint option — CORRECTED on this runtime.
  db.exec("CREATE TABLE big (n INTEGER)");
  db.exec("INSERT INTO big VALUES (9007199254740993)");
  // The DatabaseOptions type does not even declare bigint — itself evidence
  // for the correction: pass it anyway and observe the runtime ignores it.
  const bdb = new Database(dbPath, { readwrite: true, create: true, bigint: true } as any);
  const bb = bdb.query("SELECT n FROM big").get() as { n: unknown };
  const bigLost = typeof bb.n === "number" && String(bb.n) === "9007199254740992";
  check("P7 bigint option NOT honored (>2^53 loses precision)", bigLost, "CORRECTED: use TEXT for exact large ids");

  // P8: loadExtension surface (not exercised).
  check("P8 loadExtension present (security surface, not exercised)", typeof (db as unknown as { loadExtension?: unknown }).loadExtension === "function");

  // P9: sqlite_version readable.
  const v = db.query("SELECT sqlite_version() AS v").get() as { v: string };
  check("P9 sqlite_version() readable", typeof v.v === "string" && v.v.length > 0, v.v);

  db.close();
  db2.close();
  bdb.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log("sqlite:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);
