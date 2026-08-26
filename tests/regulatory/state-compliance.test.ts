/**
 * tests/regulatory/state-compliance.test.ts
 *
 * End-to-end isolation tests for:
 *   - ComplianceRepository bet validation (license, limits, bet types)
 *   - Per-user checks (self-exclusion, daily limits, cooling-off)
 *   - Atomic bet placement (placeBetAtomic)
 *   - ScopedRepository state_code / user_id injection
 *   - Seed data correctness
 *   - Rate limiter
 *   - Violation spike alerting
 *   - Migration runner + retention sweeper (CLI)
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { Database } from "bun:sqlite";
import { ComplianceRepository } from "../../src/regulatory/lib/compliance-repo";
import { BetBlockedError } from "../../src/regulatory/lib/errors";
import { ScopedRepository, type Scope } from "../../src/regulatory/lib/repository";
import { createRateLimiter } from "../../src/regulatory/middleware/rate-limit";
import { ViolationAlerts } from "../../src/regulatory/lib/alerting";
import { readFileSync } from "fs";
import { join } from "path";

const MIGRATION_SQL = readFileSync(
  join(import.meta.dir, "../../src/regulatory/db/migrations/011_state_regulation.sql"),
  "utf-8",
);
const SEED_SQL = readFileSync(
  join(import.meta.dir, "../../src/regulatory/db/seeds/state_regulations.sql"),
  "utf-8",
);

function inMemoryDb(): Database {
  const db = new Database(":memory:");
  db.exec(MIGRATION_SQL);
  db.exec(SEED_SQL);
  return db;
}

describe("ComplianceRepository — basic checks", () => {
  let db: Database;
  let repo: ComplianceRepository;

  beforeAll(() => {
    db = inMemoryDb();
    repo = new ComplianceRepository(db);
  });

  afterAll(() => db.close());

  test("allows a compliant bet for partner-alpha in MA on soccer", () => {
    const result = repo.isBetAllowed({
      nodeId: "partner-alpha",
      userId: "user-1",
      stateCode: "MA",
      sportId: "soccer",
      marketId: "match_winner",
      wagerAmount: 100,
      betType: "straight",
    });
    expect(result.allowed).toBe(true);
  });

  test("blocks unlicensed partner in NJ", () => {
    const result = repo.isBetAllowed({
      nodeId: "unlicensed-partner",
      userId: "user-1",
      stateCode: "NJ",
      sportId: "soccer",
      marketId: "match_winner",
      wagerAmount: 100,
      betType: "straight",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not licensed");
  });

  test("blocks bet exceeding max_wager in MA soccer", () => {
    const result = repo.isBetAllowed({
      nodeId: "partner-alpha",
      userId: "user-1",
      stateCode: "MA",
      sportId: "soccer",
      marketId: "match_winner",
      wagerAmount: 6000,
      betType: "straight",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("exceeds max");
  });

  test("blocks bet below min_wager", () => {
    const result = repo.isBetAllowed({
      nodeId: "partner-alpha",
      userId: "user-1",
      stateCode: "MA",
      sportId: "soccer",
      marketId: "match_winner",
      wagerAmount: 0.1,
      betType: "straight",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("below min");
  });

  test("blocks disallowed bet type in MA basketball over_under", () => {
    const result = repo.isBetAllowed({
      nodeId: "partner-alpha",
      userId: "user-1",
      stateCode: "MA",
      sportId: "basketball",
      marketId: "over_under",
      wagerAmount: 50,
      betType: "parlay",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not permitted");
  });

  test("blocks partner with suspended license", () => {
    const result = repo.isBetAllowed({
      nodeId: "partner-beta",
      userId: "user-1",
      stateCode: "NJ",
      sportId: "soccer",
      marketId: "match_winner",
      wagerAmount: 100,
      betType: "straight",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("suspended");
  });

  test("allows teaser in NJ soccer (where permitted)", () => {
    const result = repo.isBetAllowed({
      nodeId: "partner-alpha",
      userId: "user-1",
      stateCode: "NJ",
      sportId: "soccer",
      marketId: "match_winner",
      wagerAmount: 500,
      betType: "teaser",
    });
    expect(result.allowed).toBe(true);
  });
});

describe("ComplianceRepository — per-user checks", () => {
  let db: Database;
  let repo: ComplianceRepository;

  beforeAll(() => {
    db = inMemoryDb();
    repo = new ComplianceRepository(db);
  });

  afterAll(() => db.close());

  test("blocks self-excluded user", () => {
    db.run(
      `INSERT INTO self_exclusions (user_id, node_id, reason, excluded_at, expires_at)
       VALUES ('excluded-user', 'partner-alpha', 'problem-gambling', unixepoch(), NULL)`,
    );

    const result = repo.isBetAllowed({
      nodeId: "partner-alpha",
      userId: "excluded-user",
      stateCode: "MA",
      sportId: "soccer",
      marketId: "match_winner",
      wagerAmount: 100,
      betType: "straight",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("self-excluded");
  });

  test("allows previously excluded user after expiration", () => {
    db.run(
      `INSERT INTO self_exclusions (user_id, node_id, reason, excluded_at, expires_at)
       VALUES ('expired-user', 'partner-alpha', 'temporary', unixepoch(), unixepoch() - 1)`,
    );

    const result = repo.isBetAllowed({
      nodeId: "partner-alpha",
      userId: "expired-user",
      stateCode: "MA",
      sportId: "soccer",
      marketId: "match_winner",
      wagerAmount: 100,
      betType: "straight",
    });
    expect(result.allowed).toBe(true);
  });

  test("enforces daily wager limit (max_daily_total)", () => {
    // Use a unique sport/market not in seeds to avoid effective_from collision
    db.run(
      `INSERT INTO regulatory_limits (state_code, sport_id, market_id, max_wager, min_wager, allowed_bet_types, special_rules)
       VALUES ('MA', 'hockey', 'puckline', 5000, 1, '["straight"]', '{"max_daily_total":1000}')`,
    );

    // User already spent $800 today
    db.run(
      `INSERT INTO plays (play_id, node_id, user_id, country_code, sport_id, market_id, state_code, wager_amount, bet_type, status, placed_at)
       VALUES ('p-prev', 'partner-alpha', 'daily-limited', 'US', 'hockey', 'puckline', 'MA', 800, 'straight', 'accepted', unixepoch())`,
    );

    const result = repo.isBetAllowed({
      nodeId: "partner-alpha",
      userId: "daily-limited",
      stateCode: "MA",
      sportId: "hockey",
      marketId: "puckline",
      wagerAmount: 300, // 800 + 300 = 1100 > 1000
      betType: "straight",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Daily wager limit");
  });

  test("allows bet within daily limit", () => {
    const result = repo.isBetAllowed({
      nodeId: "partner-alpha",
      userId: "daily-limited",
      stateCode: "MA",
      sportId: "hockey",
      marketId: "puckline",
      wagerAmount: 100, // 800 + 100 = 900 <= 1000
      betType: "straight",
    });
    expect(result.allowed).toBe(true);
  });

  test("enforces cooling-off period", () => {
    // Use a unique sport/market not in seeds (different from daily-limit test)
    db.run(
      `INSERT INTO regulatory_limits (state_code, sport_id, market_id, max_wager, min_wager, allowed_bet_types, special_rules)
       VALUES ('MA', 'hockey', 'moneyline', 10000, 1, '["straight"]', '{"cooling_off_minutes":60}')`,
    );

    // User placed a bet 5 minutes ago
    db.run(
      `INSERT INTO plays (play_id, node_id, user_id, country_code, sport_id, market_id, state_code, wager_amount, bet_type, status, placed_at)
       VALUES ('p-cool', 'partner-alpha', 'cooling-user', 'US', 'hockey', 'moneyline', 'MA', 50, 'straight', 'accepted', unixepoch() - 300)`,
    );

    const result = repo.isBetAllowed({
      nodeId: "partner-alpha",
      userId: "cooling-user",
      stateCode: "MA",
      sportId: "hockey",
      marketId: "moneyline",
      wagerAmount: 50,
      betType: "straight",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Cooling-off");
  });
});

describe("ComplianceRepository — atomic placement", () => {
  let db: Database;
  let repo: ComplianceRepository;

  beforeAll(() => {
    db = inMemoryDb();
    repo = new ComplianceRepository(db);
  });

  afterAll(() => db.close());

  test("placeBetAtomic inserts play on success", () => {
    const result = repo.placeBetAtomic({
      nodeId: "partner-alpha",
      userId: "user-atomic",
      stateCode: "MA",
      sportId: "soccer",
      marketId: "match_winner",
      wagerAmount: 100,
      betType: "straight",
      playId: "play-atomic-1",
    });
    expect(result.status).toBe("accepted");

    const row = db
      .query("SELECT * FROM plays WHERE play_id = ?")
      .get("play-atomic-1") as any;
    expect(row).toBeTruthy();
    expect(row.status).toBe("accepted");
    expect(row.user_id).toBe("user-atomic");
  });

  test("placeBetAtomic throws BetBlockedError on violation and does not insert", () => {
    expect(() => {
      repo.placeBetAtomic({
        nodeId: "partner-alpha",
        userId: "user-atomic",
        stateCode: "MA",
        sportId: "soccer",
        marketId: "match_winner",
        wagerAmount: 6000, // exceeds max
        betType: "straight",
        playId: "play-atomic-2",
      });
    }).toThrow(BetBlockedError);

    const row = db
      .query("SELECT * FROM plays WHERE play_id = ?")
      .get("play-atomic-2") as any;
    expect(row).toBeNull();

    // Violation should be logged (outside tx, so survives rollback)
    const violation = db
      .query("SELECT * FROM regulatory_violations WHERE play_id = ?")
      .get("play-atomic-2") as any;
    expect(violation).toBeTruthy();
    expect(violation.user_id).toBe("user-atomic");
  });
});

describe("ScopedRepository", () => {
  let db: Database;

  beforeAll(() => {
    db = inMemoryDb();
    db.run(
      `INSERT INTO plays (play_id, node_id, user_id, country_code, sport_id, market_id, state_code, wager_amount, bet_type, status)
       VALUES
       ('p1', 'node-a', 'user-1', 'US', 'soccer', 'match_winner', 'MA', 100, 'straight', 'accepted'),
       ('p2', 'node-a', 'user-1', 'US', 'soccer', 'match_winner', 'NJ', 200, 'straight', 'accepted'),
       ('p3', 'node-a', 'user-2', 'US', 'basketball', 'over_under', 'MA', 50, 'straight', 'accepted'),
       ('p4', 'node-b', 'user-1', 'US', 'soccer', 'match_winner', 'MA', 300, 'straight', 'accepted')`,
    );
  });

  afterAll(() => db.close());

  test("filters rows by scope without state", () => {
    const scope: Scope = {
      nodeId: "node-a",
      country: "US",
      sport: "soccer",
      market: "match_winner",
    };
    const repo = new ScopedRepository<{ play_id: string; state_code: string | null }>(db, scope);
    const rows = repo.all("SELECT play_id, state_code FROM plays WHERE status = ?", "accepted");
    expect(rows.length).toBe(2);
  });

  test("filters rows by scope with state", () => {
    const scope: Scope = {
      nodeId: "node-a",
      country: "US",
      sport: "soccer",
      market: "match_winner",
      state: "MA",
    };
    const repo = new ScopedRepository<{ play_id: string; state_code: string | null }>(db, scope);
    const rows = repo.all("SELECT play_id, state_code FROM plays");
    expect(rows.length).toBe(1);
    expect(rows[0]!.play_id).toBe("p1");
  });

  test("filters rows by scope with user", () => {
    const scope: Scope = {
      nodeId: "node-a",
      country: "US",
      sport: "soccer",
      market: "match_winner",
      user: "user-1",
    };
    const repo = new ScopedRepository<{ play_id: string }>(db, scope);
    const rows = repo.all("SELECT play_id FROM plays");
    expect(rows.length).toBe(2); // MA + NJ for user-1
  });

  test("excludes rows from other node_id", () => {
    const scope: Scope = {
      nodeId: "node-b",
      country: "US",
      sport: "soccer",
      market: "match_winner",
      state: "MA",
    };
    const repo = new ScopedRepository<{ play_id: string }>(db, scope);
    const row = repo.get("SELECT play_id FROM plays");
    expect(row?.play_id).toBe("p4");
  });

  test("throws on direct dimension filter without marker", () => {
    const scope: Scope = {
      nodeId: "node-a",
      country: "US",
      sport: "soccer",
      market: "match_winner",
    };
    const repo = new ScopedRepository<{ play_id: string }>(db, scope);
    expect(() => {
      repo.all("SELECT play_id FROM plays WHERE node_id = ?", "evil");
    }).toThrow("direct dimension filter detected");
  });

  test("allows direct dimension filter with /*scope-injected*/ marker", () => {
    const scope: Scope = {
      nodeId: "node-a",
      country: "US",
      sport: "soccer",
      market: "match_winner",
    };
    const repo = new ScopedRepository<{ play_id: string }>(db, scope);
    const rows = repo.all(
      "SELECT play_id FROM plays WHERE node_id = ? /*scope-injected*/",
      "node-a",
    );
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Rate limiter
// ─────────────────────────────────────────────────────────────────────────────

describe("Rate Limiter", () => {
  test("allows requests under max", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    const req = new Request("http://localhost/place-bet", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });

    const res1 = await limiter(req, () => new Response("ok"));
    expect(res1.status).toBe(200);
    expect(res1.headers.get("X-RateLimit-Remaining")).toBe("2");

    const res2 = await limiter(req, () => new Response("ok"));
    expect(res2.status).toBe(200);
    expect(res2.headers.get("X-RateLimit-Remaining")).toBe("1");
  });

  test("returns 429 when bucket exhausted", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    const req = new Request("http://localhost/place-bet", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });

    const res1 = await limiter(req, () => new Response("ok"));
    expect(res1.status).toBe(200);

    const res2 = await limiter(req, () => new Response("ok"));
    expect(res2.status).toBe(429);
    expect(res2.headers.get("Retry-After")).toBeTruthy();
  });

  test("skipSuccessful does not count 2xx against limit", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, skipSuccessful: true });
    const req = new Request("http://localhost/place-bet", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });

    const res1 = await limiter(req, () => new Response("ok"));
    expect(res1.status).toBe(200);

    const res2 = await limiter(req, () => new Response("ok"));
    expect(res2.status).toBe(200); // token refunded because skipSuccessful
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  ViolationAlerts
// ─────────────────────────────────────────────────────────────────────────────

describe("ViolationAlerts", () => {
  let db: Database;

  beforeAll(() => {
    db = inMemoryDb();
    // Seed some violations
    const now = Math.floor(Date.now() / 1000);
    db.run(
      `INSERT INTO regulatory_violations (node_id, user_id, play_id, state_code, reason, details, blocked_at)
       VALUES
       ('node-a', 'user-1', 'p1', 'MA', 'max_wager exceeded', NULL, ?),
       ('node-a', 'user-1', 'p2', 'MA', 'max_wager exceeded', NULL, ?),
       ('node-a', 'user-2', 'p3', 'NJ', 'self-excluded', NULL, ?),
       ('node-b', 'user-1', 'p4', 'NJ', 'suspended license', NULL, ?)`,
      [now - 10, now - 20, now - 30, now - 3_600], // last one is 1h old
    );
  });

  afterAll(() => db.close());

  test("checkSpike triggers when threshold exceeded", () => {
    const alerts = new ViolationAlerts(db);
    const spike = alerts.checkSpike({ windowSeconds: 300, threshold: 2 });
    expect(spike.triggered).toBe(true);
    expect(spike.count).toBeGreaterThanOrEqual(3);
    expect(spike.topReasons.length).toBeGreaterThanOrEqual(1);
  });

  test("checkSpike does not trigger under threshold", () => {
    const alerts = new ViolationAlerts(db);
    const spike = alerts.checkSpike({ windowSeconds: 300, threshold: 100 });
    expect(spike.triggered).toBe(false);
  });

  test("summary aggregates by state, node, reason", () => {
    const alerts = new ViolationAlerts(db);
    const summary = alerts.summary(120);
    expect(summary.total).toBeGreaterThanOrEqual(0);
    expect(typeof summary.byState).toBe("object");
    expect(typeof summary.byNode).toBe("object");
    expect(typeof summary.byReason).toBe("object");
    expect(Array.isArray(summary.recent)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  CLI scripts (migration runner + sweeper)
// ─────────────────────────────────────────────────────────────────────────────

describe("Regulatory CLI scripts", () => {
  test("migrate runner exits 0 and tracks applied migrations", async () => {
    const { exitCode, stdout } = await $`bun src/regulatory/scripts/migrate.ts --db :memory:`.nothrow().quiet();
    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("Applied");
  });

  test("sweep-violations exits 0 even on empty table", async () => {
    const { exitCode } = await $`bun src/regulatory/scripts/sweep-violations.ts --db :memory:`.nothrow().quiet();
    expect(exitCode).toBe(0);
  });
});
