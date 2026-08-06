import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ComplianceRepository } from "../../src/regulatory/lib/compliance-repo.ts";
import { syncRegulatoryExecutionPlays } from "../../src/regulatory/lib/execution-play-sync.ts";
import { migrateExecutionSchema } from "../../src/partner/execution/sql.ts";

describe("regulatory execution evidence sync", () => {
  test("promotes only provider-backed terminal execution evidence idempotently", () => {
    const reg = new Database(":memory:");
    reg.exec(readFileSync(join(import.meta.dir, "../../src/regulatory/db/migrations/011_state_regulation.sql"), "utf8"));
    reg.exec(readFileSync(join(import.meta.dir, "../../src/regulatory/db/migrations/013_execution_play_lifecycle.sql"), "utf8"));
    reg.run("INSERT INTO partner_state_licenses (node_id,state_code,status) VALUES ('SPORTS','MA','active')");
    const repo = new ComplianceRepository(reg);
    for (const key of ["confirmed-key", "unknown-key"]) {
      repo.proposeExecutionBetAtomic({
        nodeId: "SPORTS", userId: "operator", stateCode: "MA", sportId: "politics",
        marketId: key, wagerAmount: 1, betType: "straight", playId: `play-${key}`,
        idempotencyKey: key,
      });
      repo.transitionExecutionPlay({ idempotencyKey: key, status: "unknown" });
    }
    const execution = new Database(":memory:");
    migrateExecutionSchema(execution, 1);
    execution.run("PRAGMA foreign_keys=OFF");
    execution.query(
      `INSERT INTO exposure_reservations
       (idempotency_key,partner_code,out_id,skin,provider,authorization_id,
        requested_stake,effective_stake,market_id,selection,decimal_odds,status,
        reservation_expires_at_ms,ticket_id,created_at_ms,updated_at_ms)
       VALUES ('confirmed-key','SPORTS','out-SPORTS-1','main','kalshi',99,
        100,100,'KX','yes',2,'confirmed',1000,'ticket-1',1,1)`,
    ).run();
    expect(syncRegulatoryExecutionPlays(reg, execution)).toEqual({
      scanned: 2, confirmed: 1, rejected: 0, unresolved: 1,
    });
    expect(syncRegulatoryExecutionPlays(reg, execution)).toEqual({
      scanned: 1, confirmed: 0, rejected: 0, unresolved: 1,
    });
    reg.close();
    execution.close();
  });
});
