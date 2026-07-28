#!/usr/bin/env bun
/**
 * admin.ts — Regulatory admin CLI for managing self-exclusions and limits.
 *
 * Usage:
 *   bun src/regulatory/scripts/admin.ts self-exclusion add --user user-1 --node partner-alpha --reason "problem-gambling"
 *   bun src/regulatory/scripts/admin.ts self-exclusion remove --user user-1 --node partner-alpha
 *   bun src/regulatory/scripts/admin.ts self-exclusion list
 *   bun src/regulatory/scripts/admin.ts limits list
 *   bun src/regulatory/scripts/admin.ts limits set --state MA --sport soccer --market match_winner --max-wager 5000 --min-wager 1 --bet-types '["straight"]'
 */

import { Database } from "bun:sqlite";
import { TABLE, SQL_UNIXEPOCH, LICENSE_STATUS, PLAY_STATUS } from "../constants";

const DB_PATH = process.env.REGULATORY_DB ?? ":memory:";

type Command = "self-exclusion" | "limits";
type SubCommand = "add" | "remove" | "list" | "set";

function printUsage(): void {
  console.log(`
Regulatory Admin CLI

Commands:
  self-exclusion add    --user <id> --node <id> --reason <text> [--expires <ISO-date>]
  self-exclusion remove --user <id> --node <id>
  self-exclusion list   [--user <id>] [--node <id>]
  limits list           [--state <code>] [--sport <id>]
  limits set            --state <code> --sport <id> --market <id>
                        --max-wager <amount> --min-wager <amount>
                        --bet-types <json-array>
                        [--special-rules <json-object>]
`);
}

function getDb(): Database {
  if (DB_PATH !== ":memory:" && !Bun.file(DB_PATH).exists()) {
    console.error(`Database not found: ${DB_PATH}`);
    process.exit(1);
  }
  return new Database(DB_PATH, { create: true });
}

// ── Self-exclusion commands ──

function seAdd(argv: string[]): number {
  const userIdx = argv.indexOf("--user");
  const nodeIdx = argv.indexOf("--node");
  const reasonIdx = argv.indexOf("--reason");
  const expiresIdx = argv.indexOf("--expires");

  if (userIdx < 0 || nodeIdx < 0 || reasonIdx < 0) {
    console.error("Missing required flags: --user, --node, --reason");
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
  console.log(`Self-exclusion added: user=${userId} node=${nodeId} reason=${reason}${expiresAt ? ` expires=${new Date(expiresAt * 1000).toISOString()}` : ""}`);
  db.close();
  return 0;
}

function seRemove(argv: string[]): number {
  const userIdx = argv.indexOf("--user");
  const nodeIdx = argv.indexOf("--node");

  if (userIdx < 0 || nodeIdx < 0) {
    console.error("Missing required flags: --user, --node");
    return 1;
  }

  const userId = argv[userIdx + 1];
  const nodeId = argv[nodeIdx + 1];

  const db = getDb();
  const result = db.run(
    `DELETE FROM ${TABLE.SELF_EXCLUSIONS} WHERE user_id = ? AND node_id = ?`,
    [userId, nodeId],
  );
  console.log(`Removed ${result.changes} self-exclusion(s): user=${userId} node=${nodeId}`);
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

  if (userId) {
    sql += " AND user_id = ?";
    params.push(userId);
  }
  if (nodeId) {
    sql += " AND node_id = ?";
    params.push(nodeId);
  }
  sql += ` ORDER BY excluded_at DESC`;

  const rows = db.query<{ user_id: string; node_id: string; reason: string; excluded_at: number; expires_at: number | null }, any>(sql).all(...params);

  if (rows.length === 0) {
    console.log("No self-exclusions found.");
    db.close();
    return 0;
  }

  console.log("User\t\tNode\t\tReason\t\t\tExcluded\t\tExpires");
  console.log("─".repeat(100));
  for (const r of rows) {
    const excluded = new Date(r.excluded_at * 1000).toISOString();
    const expires = r.expires_at ? new Date(r.expires_at * 1000).toISOString() : "never";
    console.log(`${r.user_id}\t${r.node_id}\t${r.reason}\t${excluded}\t${expires}`);
  }
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
  let sql = `SELECT state_code, sport_id, market_id, max_wager, min_wager, allowed_bet_types, special_rules, effective_from, effective_to
             FROM ${TABLE.REGULATORY_LIMITS} WHERE 1=1`;
  const params: (string | null)[] = [];

  if (stateCode) {
    sql += " AND state_code = ?";
    params.push(stateCode);
  }
  if (sportId) {
    sql += " AND sport_id = ?";
    params.push(sportId);
  }
  sql += ` ORDER BY state_code, sport_id, market_id, effective_from DESC`;

  const rows = db.query<
    {
      state_code: string;
      sport_id: string;
      market_id: string;
      max_wager: number | null;
      min_wager: number;
      allowed_bet_types: string;
      special_rules: string | null;
      effective_from: number;
      effective_to: number | null;
    },
    any
  >(sql).all(...params);

  if (rows.length === 0) {
    console.log("No regulatory limits found.");
    db.close();
    return 0;
  }

  console.log("State\tSport\t\tMarket\t\tMax\tMin\tBet Types\t\t\tSpecial Rules");
  console.log("─".repeat(120));
  for (const r of rows) {
    const types = r.allowed_bet_types;
    const special = r.special_rules ?? "—";
    console.log(`${r.state_code}\t${r.sport_id}\t${r.market_id}\t\t${r.max_wager ?? "∞"}\t${r.min_wager}\t${types}\t${special}`);
  }
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
    console.error("Missing required flags: --state, --sport, --market, --max-wager, --min-wager, --bet-types");
    return 1;
  }

  const stateCode = argv[stateIdx + 1];
  const sportId = argv[sportIdx + 1];
  const marketId = argv[marketIdx + 1];
  const maxWager = parseFloat(argv[maxIdx + 1]);
  const minWager = parseFloat(argv[minIdx + 1]);
  const betTypes = argv[typesIdx + 1];
  const specialRules = specialIdx >= 0 ? argv[specialIdx + 1] : null;

  // Validate JSON
  try {
    JSON.parse(betTypes);
    if (specialRules) JSON.parse(specialRules);
  } catch {
    console.error("Invalid JSON in --bet-types or --special-rules");
    return 1;
  }

  const db = getDb();
  db.run(
    `INSERT INTO ${TABLE.REGULATORY_LIMITS} (state_code, sport_id, market_id, max_wager, min_wager, allowed_bet_types, special_rules, effective_from, effective_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${SQL_UNIXEPOCH}, NULL)`,
    [stateCode, sportId, marketId, maxWager, minWager, betTypes, specialRules],
  );
  console.log(`Limit set: ${stateCode} / ${sportId} / ${marketId} — max=$${maxWager} min=$${minWager}`);
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
    console.error(`Unknown subcommand: ${sub}`);
    return 1;
  }

  if (cmd === "limits") {
    if (sub === "list") return limitsList(argv);
    if (sub === "set") return limitsSet(argv);
    console.error(`Unknown subcommand: ${sub}`);
    return 1;
  }

  console.error(`Unknown command: ${cmd}`);
  return 1;
}

if (import.meta.main) {
  process.exit(main());
}
