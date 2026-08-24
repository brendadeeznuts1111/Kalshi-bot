#!/usr/bin/env bun
/**
 * admin.ts — Regulatory admin CLI with colorized output.
 *
 * Usage:
 *   bun src/regulatory/scripts/admin.ts self-exclusion add --user user-1 --node partner-alpha --reason "problem-gambling"
 *   bun src/regulatory/scripts/admin.ts self-exclusion remove --user user-1 --node partner-alpha
 *   bun src/regulatory/scripts/admin.ts self-exclusion list
 *   bun src/regulatory/scripts/admin.ts limits list
 *   bun src/regulatory/scripts/admin.ts limits set --state MA --sport soccer --market match_winner --max-wager 5000 --min-wager 1 --bet-types '["straight"]'
 */

import { Database } from "bun:sqlite";
import { TABLE, SQL_UNIXEPOCH } from "../constants";
import { databasePath } from "../config";

// ── ANSI color helpers via Bun.color ──
const RESET = "\x1b[0m";

function colorize(text: string, color: string): string {
  const code = Bun.color(color, "ansi") || Bun.color(color, "ansi-256") || "";
  return code ? `${code}${text}${RESET}` : text;
}

const c = {
  ok: (t: string) => colorize(t, "green"),
  err: (t: string) => colorize(t, "red"),
  warn: (t: string) => colorize(t, "orange"),
  info: (t: string) => colorize(t, "cyan"),
  bold: (t: string) => `\x1b[1m${t}${RESET}`,
  dim: (t: string) => colorize(t, "gray"),
  accent: (t: string) => colorize(t, "purple"),
};

// ── Table rendering ──

// NATIVE box-drawing table (§44): Bun.inspect.table is ANSI-aware
// (probe: colored cells align by visible width) and replaces the hand-rolled
// renderTable. Options as 2nd arg (colors:true) — 3rd-arg form not honored.
function renderTable(headers: string[], rows: string[][]): void {
  const objects = rows.map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])),
  );
  console.log(Bun.inspect.table(objects, { colors: true }));
}

// ── CLI ──

type Command = "self-exclusion" | "limits";
type SubCommand = "add" | "remove" | "list" | "set";

function printUsage(): void {
  console.log(`
${c.bold("Regulatory Admin CLI")}

${c.info("Commands:")}
  ${c.accent("self-exclusion add")}    --user <id> --node <id> --reason <text> [--expires <ISO-date>]
  ${c.accent("self-exclusion remove")} --user <id> --node <id>
  ${c.accent("self-exclusion list")}   [--user <id>] [--node <id>]
  ${c.accent("limits list")}           [--state <code>] [--sport <id>]
  ${c.accent("limits set")}            --state <code> --sport <id> --market <id>
                        --max-wager <amount> --min-wager <amount>
                        --bet-types <json-array>
                        [--special-rules <json-object>]
`);
}

function getDb(): Database {
  if (databasePath !== ":memory:" && !Bun.file(databasePath).exists()) {
    console.error(c.err(`✖ Database not found: ${databasePath}`));
    process.exit(1);
  }
  return new Database(databasePath, { create: true });
}

// ── Self-exclusion commands ──

function seAdd(argv: string[]): number {
  const userIdx = argv.indexOf("--user");
  const nodeIdx = argv.indexOf("--node");
  const reasonIdx = argv.indexOf("--reason");
  const expiresIdx = argv.indexOf("--expires");

  if (userIdx < 0 || nodeIdx < 0 || reasonIdx < 0) {
    console.error(c.err("✖ Missing required flags: --user, --node, --reason"));
    return 1;
  }

  const userId = argv[userIdx + 1];
  const nodeId = argv[nodeIdx + 1];
  const reason = argv[reasonIdx + 1];
  const expiresAt = expiresIdx >= 0 ? Math.floor(new Date(argv[expiresIdx + 1]).getTime() / 1000) : null;

  const db = getDb();
  db.run(
    `INSERT INTO ${TABLE.SELF_EXCLUSIONS} (user_id, node_id, reason, excluded_at, expires_at)
     VALUES (?, ?, ?, ${SQL_UNIXEPOCH}, ?)
     ON CONFLICT(user_id, node_id) DO UPDATE SET
       reason = excluded.reason,
       excluded_at = ${SQL_UNIXEPOCH},
       expires_at = excluded.expires_at`,
    [userId, nodeId, reason, expiresAt],
  );
  console.log(c.ok(`✓ Self-exclusion added:`) + ` user=${c.bold(userId)} node=${c.bold(nodeId)} reason=${c.warn(reason)}${expiresAt ? ` expires=${new Date(expiresAt * 1000).toISOString()}` : ""}`);
  db.close();
  return 0;
}

function seRemove(argv: string[]): number {
  const userIdx = argv.indexOf("--user");
  const nodeIdx = argv.indexOf("--node");

  if (userIdx < 0 || nodeIdx < 0) {
    console.error(c.err("✖ Missing required flags: --user, --node"));
    return 1;
  }

  const userId = argv[userIdx + 1];
  const nodeId = argv[nodeIdx + 1];

  const db = getDb();
  const result = db.run(
    `DELETE FROM ${TABLE.SELF_EXCLUSIONS} WHERE user_id = ? AND node_id = ?`,
    [userId, nodeId],
  );
  console.log(c.ok(`✓ Removed ${result.changes} self-exclusion(s):`) + ` user=${c.bold(userId)} node=${c.bold(nodeId)}`);
  db.close();
  return 0;
}

function seList(argv: string[]): number {
  const userIdx = argv.indexOf("--user");
  const nodeIdx = argv.indexOf("--node");

  const userId = userIdx >= 0 ? argv[userIdx + 1] : null;
  const nodeId = nodeIdx >= 0 ? argv[nodeIdx + 1] : null;

  const db = getDb();
  let sql = `SELECT user_id, node_id, reason, excluded_at, expires_at FROM ${TABLE.SELF_EXCLUSIONS} WHERE 1=1`;
  const params: (string | null)[] = [];

  if (userId) { sql += " AND user_id = ?"; params.push(userId); }
  if (nodeId) { sql += " AND node_id = ?"; params.push(nodeId); }
  sql += ` ORDER BY excluded_at DESC`;

  const rows = db.query<{ user_id: string; node_id: string; reason: string; excluded_at: number; expires_at: number | null }, any>(sql).all(...params);

  if (rows.length === 0) {
    console.log(c.dim("No self-exclusions found."));
    db.close();
    return 0;
  }

  const headers = ["User", "Node", "Reason", "Excluded", "Expires"];
  const data = rows.map((r) => [
    r.user_id,
    r.node_id,
    r.reason,
    new Date(r.excluded_at * 1000).toISOString(),
    r.expires_at ? new Date(r.expires_at * 1000).toISOString() : c.dim("never"),
  ]);

  console.log(c.info(`Self-exclusions (${rows.length}):`));
  renderTable(headers, data);
  db.close();
  return 0;
}

// ── Limits commands ──

function limitsList(argv: string[]): number {
  const stateIdx = argv.indexOf("--state");
  const sportIdx = argv.indexOf("--sport");

  const stateCode = stateIdx >= 0 ? argv[stateIdx + 1] : null;
  const sportId = sportIdx >= 0 ? argv[sportIdx + 1] : null;

  const db = getDb();
  let sql = `SELECT state_code, sport_id, market_id, max_wager, min_wager, allowed_bet_types, special_rules, effective_from, effective_to FROM ${TABLE.REGULATORY_LIMITS} WHERE 1=1`;
  const params: (string | null)[] = [];

  if (stateCode) { sql += " AND state_code = ?"; params.push(stateCode); }
  if (sportId) { sql += " AND sport_id = ?"; params.push(sportId); }
  sql += ` ORDER BY state_code, sport_id, market_id, effective_from DESC`;

  const rows = db.query<
    { state_code: string; sport_id: string; market_id: string; max_wager: number | null; min_wager: number; allowed_bet_types: string; special_rules: string | null; effective_from: number; effective_to: number | null },
    any
  >(sql).all(...params);

  if (rows.length === 0) {
    console.log(c.dim("No regulatory limits found."));
    db.close();
    return 0;
  }

  const headers = ["State", "Sport", "Market", "Max", "Min", "Bet Types", "Special"];
  const data = rows.map((r) => [
    r.state_code,
    r.sport_id,
    r.market_id,
    r.max_wager !== null ? `$${r.max_wager}` : c.dim("∞"),
    `$${r.min_wager}`,
    r.allowed_bet_types,
    r.special_rules ?? c.dim("—"),
  ]);

  console.log(c.info(`Regulatory limits (${rows.length}):`));
  renderTable(headers, data);
  db.close();
  return 0;
}

function limitsSet(argv: string[]): number {
  const stateIdx = argv.indexOf("--state");
  const sportIdx = argv.indexOf("--sport");
  const marketIdx = argv.indexOf("--market");
  const maxIdx = argv.indexOf("--max-wager");
  const minIdx = argv.indexOf("--min-wager");
  const typesIdx = argv.indexOf("--bet-types");
  const specialIdx = argv.indexOf("--special-rules");

  if (stateIdx < 0 || sportIdx < 0 || marketIdx < 0 || maxIdx < 0 || minIdx < 0 || typesIdx < 0) {
    console.error(c.err("✖ Missing required flags: --state, --sport, --market, --max-wager, --min-wager, --bet-types"));
    return 1;
  }

  const stateCode = argv[stateIdx + 1];
  const sportId = argv[sportIdx + 1];
  const marketId = argv[marketIdx + 1];
  const maxWager = parseFloat(argv[maxIdx + 1]);
  const minWager = parseFloat(argv[minIdx + 1]);
  const betTypes = argv[typesIdx + 1];
  const specialRules = specialIdx >= 0 ? argv[specialIdx + 1] : null;

  try {
    JSON.parse(betTypes);
    if (specialRules) JSON.parse(specialRules);
  } catch {
    console.error(c.err("✖ Invalid JSON in --bet-types or --special-rules"));
    return 1;
  }

  const db = getDb();
  db.run(
    `INSERT INTO ${TABLE.REGULATORY_LIMITS} (state_code, sport_id, market_id, max_wager, min_wager, allowed_bet_types, special_rules, effective_from, effective_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${SQL_UNIXEPOCH}, NULL)`,
    [stateCode, sportId, marketId, maxWager, minWager, betTypes, specialRules],
  );
  console.log(c.ok(`✓ Limit set:`) + ` ${c.bold(stateCode)} / ${c.bold(sportId)} / ${c.bold(marketId)} — max=${c.warn(`$${maxWager}`)} min=${c.warn(`$${minWager}`)}`);
  db.close();
  return 0;
}

// ── Main dispatch ──

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.length < 2) {
    printUsage();
    return 1;
  }

  const [cmd, sub] = argv as [Command, SubCommand];

  if (cmd === "self-exclusion") {
    if (sub === "add") return seAdd(argv);
    if (sub === "remove") return seRemove(argv);
    if (sub === "list") return seList(argv);
    console.error(c.err(`✖ Unknown subcommand: ${sub}`));
    return 1;
  }

  if (cmd === "limits") {
    if (sub === "list") return limitsList(argv);
    if (sub === "set") return limitsSet(argv);
    console.error(c.err(`✖ Unknown subcommand: ${sub}`));
    return 1;
  }

  console.error(c.err(`✖ Unknown command: ${cmd}`));
  return 1;
}

if (import.meta.main) {
  process.exit(main());
}
