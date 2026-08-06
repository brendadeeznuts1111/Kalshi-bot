import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ComplianceRepository } from "../../src/regulatory/lib/compliance-repo";

const migration = (name: string) => readFileSync(
  join(import.meta.dir, `../../src/regulatory/db/migrations/${name}`),
  "utf8",
);

describe("regulatory execution play lifecycle", () => {
  let db: Database;
  let repo: ComplianceRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(migration("011_state_regulation.sql"));
    db.exec(migration("013_execution_play_lifecycle.sql"));
    db.run(
      "INSERT INTO partner_state_licenses (node_id, state_code, status) VALUES (?, ?, 'active')",
      ["partner-a", "MA"],
    );
    repo = new ComplianceRepository(db);
  });

  afterEach(() => db.close());

  const proposal = (overrides: Record<string, unknown> = {}) => ({
    nodeId: "partner-a",
    userId: "operator-a",
    stateCode: "MA",
    sportId: "politics",
    marketId: "market-1",
    wagerAmount: 25,
    betType: "straight",
    playId: "play-1",
    idempotencyKey: "idem-1",
    ...overrides,
  });

  test("proposal is not counted as an accepted wager", () => {
    expect(repo.proposeExecutionBetAtomic(proposal()).status).toBe("proposed");
    const row = db.query("SELECT status FROM plays WHERE play_id = 'play-1'").get() as { status: string };
    expect(row.status).toBe("proposed");
  });

  test("provider evidence advances proposed through unknown to confirmed", () => {
    repo.proposeExecutionBetAtomic(proposal());
    expect(repo.transitionExecutionPlay({
      idempotencyKey: "idem-1", status: "unknown", reservationId: 41, reason: "timeout",
    }).status).toBe("unknown");
    expect(repo.transitionExecutionPlay({
      idempotencyKey: "idem-1", status: "confirmed", reservationId: 41,
    }).status).toBe("confirmed");
    const row = db.query(
      "SELECT status, execution_reservation_id FROM plays WHERE play_id = 'play-1'",
    ).get() as { status: string; execution_reservation_id: number };
    expect(row).toEqual({ status: "confirmed", execution_reservation_id: 41 });
  });

  test("same transition is idempotent and terminal states cannot change", () => {
    repo.proposeExecutionBetAtomic(proposal());
    repo.transitionExecutionPlay({ idempotencyKey: "idem-1", status: "rejected", reason: "gate" });
    expect(repo.transitionExecutionPlay({ idempotencyKey: "idem-1", status: "rejected" }).status).toBe("rejected");
    expect(() => repo.transitionExecutionPlay({
      idempotencyKey: "idem-1", status: "confirmed",
    })).toThrow("terminal");
  });

  test("idempotency keys cannot bind different plays", () => {
    repo.proposeExecutionBetAtomic(proposal());
    expect(() => repo.proposeExecutionBetAtomic(proposal({ playId: "play-2" }))).toThrow("another play");
  });

  test("proposed and unknown exposure consume regulatory daily limits", () => {
    db.query(
      `INSERT INTO regulatory_limits
       (state_code, sport_id, market_id, allowed_bet_types, special_rules)
       VALUES ('MA', 'politics', 'daily-market', '["straight"]',
         '{"max_daily_total":1}')`,
    ).run();
    repo.proposeExecutionBetAtomic(proposal({
      marketId: "daily-market", wagerAmount: 0.75,
    }));
    repo.transitionExecutionPlay({ idempotencyKey: "idem-1", status: "unknown" });
    expect(() => repo.proposeExecutionBetAtomic(proposal({
      playId: "play-2", idempotencyKey: "idem-2", marketId: "daily-market", wagerAmount: 0.75,
    }))).toThrow(/Daily wager limit/);
  });
});
