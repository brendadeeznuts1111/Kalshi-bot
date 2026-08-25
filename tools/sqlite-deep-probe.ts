#!/usr/bin/env bun
/**
 * `bun run sqlite-deep:probe` — bun:sqlite beyond the base 9 claims (§153):
 * strict mode, query.as(), multi-query run, readonly/create, serialize/
 * deserialize, statement introspection, transaction(), BLOB round-trip,
 * and the createFunction ABSENCE (better-sqlite3 parity gap). Bun 1.4.0.
 */
import { Database } from "bun:sqlite";
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// P1 strict mode: missing param THROWS; prefix-less binding allowed.
const strict = new Database(":memory:", { strict: true });
let missingErr = "no-throw";
try { strict.query("SELECT $x AS v").all({ wrong: 1 }); } catch { missingErr = "throws"; }
check("P1 strict throws on missing param", missingErr === "throws", missingErr);
const sv = strict.query("SELECT $x AS v").get({ x: 7 });
check("P2 strict prefix-less binding", (sv as any).v === 7, JSON.stringify(sv));
strict.close();

// P3 query.as(Class) maps rows (doc: map without an ORM).
class Row { declare a: number; }
const db = new Database(":memory:");
const asInst = db.query("SELECT 42 AS a").as(Row).get();
check("P3 query.as(Class)", asInst instanceof Row && asInst.a === 42, JSON.stringify(asInst));

// P4 multi-query run: "SELECT 1; SELECT 2;" in one run call (doc claim).
let multiOk = "no-throw";
try { db.run("CREATE TABLE t(a INTEGER); INSERT INTO t VALUES (1), (2);"); multiOk = "ok"; } catch (e) { multiOk = "throws:" + String((e as Error).message).slice(0, 40); }
check("P4 multi-query run", multiOk === "ok", multiOk);

// P5 run() returns changes + lastInsertRowid.
const r1 = db.run("INSERT INTO t VALUES (3)");
check("P5 run changes/lastInsertRowid", r1.changes === 1 && Number(r1.lastInsertRowid) === 3, JSON.stringify(r1));

// P6 readonly mode: writes throw.
const fp = "scratch/sqlite-deep.db";
await Bun.write(fp, "");
const ro = new Database(fp, { readonly: true });
let roErr = "no-throw";
try { ro.run("CREATE TABLE x(a)"); } catch { roErr = "throws"; }
check("P6 readonly rejects writes", roErr === "throws", roErr);
ro.close();

// P7 serialize/deserialize round-trip (types: serialize -> Buffer,
// Database.deserialize(input) -> Database).
db.run("INSERT INTO t VALUES (9)");
const buf = db.serialize();
const db2 = Database.deserialize(buf);
const v = db2.query("SELECT COUNT(*) AS n FROM t").get() as { n: number };
check("P7 serialize/deserialize round-trip", Buffer.isBuffer(buf) && v.n === 4, "n=" + v.n);
db2.close();

// P8 transaction() helper + inTransaction.
const tx = db.transaction(() => { db.run("INSERT INTO t VALUES (4)"); return "done"; });
const txRes = tx();
check("P8 transaction() helper", txRes === "done" && (db.query("SELECT COUNT(*) AS n FROM t").get() as any).n === 5, "n=" + (db.query("SELECT COUNT(*) AS n FROM t").get() as any).n);
let inTxObserved = "not-run";
let rethrown = "no-throw";
try { db.transaction(() => { inTxObserved = db.inTransaction ? "inside" : "outside"; throw new Error("rollback"); })(); } catch { rethrown = "rethrows"; }
check("P8a inTransaction + rollback + rethrow", inTxObserved === "inside" && !db.inTransaction && rethrown === "rethrows" && (db.query("SELECT COUNT(*) AS n FROM t").get() as any).n === 5, "in=" + inTxObserved + " after=" + db.inTransaction + " re=" + rethrown + " n=" + (db.query("SELECT COUNT(*) AS n FROM t").get() as any).n);

// P9 statement introspection: columns + params.
// better-sqlite3 has stmt.columns/params — bun:sqlite exposes
// columnNames/columnTypes/declaredTypes/paramsCount instead (§153).
const stmt = db.prepare("SELECT a AS val FROM t WHERE a = $w");
check("P9 stmt.columnNames/columnTypes/paramsCount", (stmt as any).columnNames.includes("val") && Array.isArray((stmt as any).columnTypes) && (stmt as any).paramsCount === 1, "cols=" + JSON.stringify((stmt as any).columnNames) + " types=" + JSON.stringify((stmt as any).columnTypes) + " params=" + (stmt as any).paramsCount);

// P10 BLOB round-trip: Uint8Array in, Uint8Array out.
db.run("CREATE TABLE b(d BLOB)");
db.run("INSERT INTO b VALUES (?)", [new Uint8Array([1, 2, 3])]);
const blob = (db.query("SELECT d FROM b").get() as any).d;
check("P10 BLOB round-trip", blob instanceof Uint8Array && blob.length === 3 && blob[2] === 3, blob instanceof Uint8Array ? "len=" + blob.length : typeof blob);

// P11 CORRECTION: createFunction/createAggregate ABSENT on 1.4.0
// (better-sqlite3 parity gap; the docs never claim them — no drift).
check("P11 no createFunction/createAggregate (pinned)", typeof (db as any).createFunction === "undefined" && typeof (db as any).createAggregate === "undefined", "fn=" + typeof (db as any).createFunction + " agg=" + typeof (db as any).createAggregate);

db.close();
const failed = results.filter((r) => !r.pass);
console.log("sqlite-deep:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
