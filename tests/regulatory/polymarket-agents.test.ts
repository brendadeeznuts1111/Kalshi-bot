import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  fetchPolymarketMarkets,
  fetchPolymarketMarket,
  marketToTick,
  PolymarketLineTracker,
  type PolymarketFetchImpl,
} from "../../src/regulatory/integrations/polymarket";
import {
  AgentOrchestrator,
  ComplianceAgent,
  OpsAgent,
  MarketDataAgent,
  AdminAgent,
  type AgentContext,
} from "../../src/regulatory/agents";
import { ComplianceRepository, ViolationAlerts } from "../../src/regulatory";
import { TABLE, PLAY_STATUS, SQL_UNIXEPOCH } from "../../src/regulatory/constants";

// ── Helpers ──

function createRegDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE ${TABLE.PLAYS} (
      play_id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'anonymous',
      country_code TEXT NOT NULL DEFAULT 'US',
      sport_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      state_code TEXT DEFAULT NULL,
      wager_amount REAL NOT NULL,
      bet_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '${PLAY_STATUS.PENDING}',
      placed_at INTEGER NOT NULL DEFAULT (${SQL_UNIXEPOCH})
    );
    CREATE TABLE ${TABLE.REGULATORY_VIOLATIONS} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      user_id TEXT DEFAULT NULL,
      play_id TEXT,
      state_code TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT,
      blocked_at INTEGER NOT NULL DEFAULT (${SQL_UNIXEPOCH})
    );
    CREATE TABLE ${TABLE.SELF_EXCLUSIONS} (
      user_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'self-requested',
      excluded_at INTEGER NOT NULL DEFAULT (${SQL_UNIXEPOCH}),
      expires_at INTEGER,
      PRIMARY KEY (user_id, node_id)
    );
    CREATE TABLE ${TABLE.PARTNER_STATE_LICENSES} (
      node_id TEXT NOT NULL,
      state_code TEXT NOT NULL,
      license_number TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      granted_at INTEGER NOT NULL DEFAULT (${SQL_UNIXEPOCH}),
      PRIMARY KEY (node_id, state_code)
    );
    CREATE TABLE ${TABLE.REGULATORY_LIMITS} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state_code TEXT NOT NULL,
      sport_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      max_wager REAL,
      min_wager REAL NOT NULL DEFAULT 0,
      allowed_bet_types TEXT NOT NULL DEFAULT '[]',
      special_rules TEXT,
      effective_from INTEGER NOT NULL DEFAULT (${SQL_UNIXEPOCH}),
      effective_to INTEGER
    );
    CREATE TABLE ${TABLE.POLYMARKET_MARKETS} (
      slug TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      description TEXT,
      condition_id TEXT NOT NULL,
      resolution_source TEXT,
      outcomes TEXT NOT NULL DEFAULT '[]',
      outcome_prices TEXT NOT NULL DEFAULT '[]',
      volume REAL NOT NULL DEFAULT 0,
      volume_24hr REAL NOT NULL DEFAULT 0,
      liquidity REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      closed INTEGER NOT NULL DEFAULT 0,
      end_date TEXT,
      updated_at INTEGER NOT NULL DEFAULT (${SQL_UNIXEPOCH})
    );
    CREATE TABLE ${TABLE.POLYMARKET_TICKS} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      yes_price REAL NOT NULL,
      no_price REAL NOT NULL,
      best_bid REAL NOT NULL,
      best_ask REAL NOT NULL,
      spread REAL NOT NULL DEFAULT 0,
      volume_24hr REAL NOT NULL DEFAULT 0,
      volume_total REAL NOT NULL DEFAULT 0,
      liquidity REAL NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL DEFAULT (${SQL_UNIXEPOCH})
    );
    CREATE TABLE ${TABLE.POLYMARKET_LINE_MOVES} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('up','down','flat')),
      old_price REAL NOT NULL,
      new_price REAL NOT NULL,
      delta_bp INTEGER NOT NULL,
      delta_abs REAL NOT NULL,
      volume_at_move REAL NOT NULL DEFAULT 0,
      detected_at INTEGER NOT NULL DEFAULT (${SQL_UNIXEPOCH}),
      window_seconds INTEGER NOT NULL DEFAULT 300
    );
  `);
  return db;
}

function mockFetch(response: unknown): PolymarketFetchImpl {
  return async () =>
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

function makeAgentCtx(db: Database): AgentContext {
  return { db, now: Date.now(), traceId: `test-${Date.now()}` };
}

function seedLicenseAndLimits(db: Database): void {
  db.run(
    `INSERT INTO ${TABLE.PARTNER_STATE_LICENSES} (node_id, state_code, status) VALUES (?, ?, ?)`,
    ["n1", "MA", "active"],
  );
  db.run(
    `INSERT INTO ${TABLE.REGULATORY_LIMITS} (state_code, sport_id, market_id, max_wager, allowed_bet_types) VALUES (?, ?, ?, ?, ?)`,
    ["MA", "nba", "m1", 1000, '["straight"]'],
  );
}

// ── Polymarket client ──

describe("Polymarket client", () => {
  test("fetchPolymarketMarkets normalizes wire format", async () => {
    const raw = [
      {
        id: "123",
        slug: "will-it-rain",
        question: "Will it rain?",
        conditionId: "0xabc",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.6","0.4"]',
        volume: "1000.5",
        volume24hr: "100.25",
        liquidity: "5000",
        liquidityClob: 5500,
        lastTradePrice: 0.6,
        bestBid: 0.59,
        bestAsk: 0.61,
        spread: 0.02,
        active: true,
        closed: false,
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-02T00:00:00Z",
      },
    ];
    const markets = await fetchPolymarketMarkets({
      limit: 1,
      fetchImpl: mockFetch(raw),
    });
    expect(markets).toHaveLength(1);
    expect(markets[0].slug).toBe("will-it-rain");
    expect(markets[0].outcomes).toEqual(["Yes", "No"]);
    expect(markets[0].outcomePrices).toEqual([0.6, 0.4]);
    expect(markets[0].volume).toBe(1000.5);
    expect(markets[0].liquidityClob).toBe(5500);
  });

  test("fetchPolymarketMarket normalizes single market", async () => {
    const raw = {
      id: "456",
      slug: "market-two",
      question: "Q2",
      conditionId: "0xdef",
      outcomes: '["A","B"]',
      outcomePrices: '["0.5","0.5"]',
      volume: 2000,
      volume24hr: 200,
      liquidity: "8000",
      lastTradePrice: 0.5,
      active: true,
      closed: false,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-02T00:00:00Z",
    };
    const market = await fetchPolymarketMarket("456", {
      fetchImpl: mockFetch(raw),
    });
    expect(market.slug).toBe("market-two");
    expect(market.outcomePrices).toEqual([0.5, 0.5]);
  });

  test("marketToTick produces correct snapshot", () => {
    const market = {
      id: "1",
      slug: "test",
      question: "Q",
      conditionId: "0x0",
      outcomes: ["Yes", "No"],
      outcomePrices: [0.7, 0.3],
      volume: 10000,
      volume24hr: 2000,
      volume1wk: 5000,
      volume1mo: 8000,
      liquidity: 30000,
      liquidityClob: 32000,
      lastTradePrice: 0.7,
      bestBid: 0.69,
      bestAsk: 0.71,
      spread: 0.02,
      active: true,
      closed: false,
      createdAt: "",
      updatedAt: "",
    };
    const tick = marketToTick(market, 1_000_000);
    expect(tick.slug).toBe("test");
    expect(tick.yesPrice).toBe(0.7);
    expect(tick.noPrice).toBe(0.3);
    expect(tick.volume24hr).toBe(2000);
    expect(tick.liquidity).toBe(32000);
    expect(tick.timestamp).toBe(1000);
  });
});

// ── Line tracker ──

describe("PolymarketLineTracker", () => {
  test("flags move exceeding delta threshold", () => {
    const tracker = new PolymarketLineTracker({
      deltaBpThreshold: 500, // 5%
      minVolume24hr: 0,
      maxSpread: 1,
      windowSeconds: 300,
    });

    const t0 = 1000;
    tracker.ingest({
      slug: "m1",
      yesPrice: 0.5,
      noPrice: 0.5,
      bestBid: 0.49,
      bestAsk: 0.51,
      spread: 0.02,
      volume24hr: 5000,
      volumeTotal: 10000,
      liquidity: 20000,
      timestamp: t0,
    });

    // 6% move: 0.5 → 0.53 = 600 bp
    const moves = tracker.ingest({
      slug: "m1",
      yesPrice: 0.53,
      noPrice: 0.47,
      bestBid: 0.52,
      bestAsk: 0.54,
      spread: 0.02,
      volume24hr: 5000,
      volumeTotal: 10000,
      liquidity: 20000,
      timestamp: t0 + 60,
    });

    expect(moves).toHaveLength(1);
    expect(moves[0].deltaBp).toBe(600);
    expect(moves[0].direction).toBe("up");
  });

  test("ignores move below threshold", () => {
    const tracker = new PolymarketLineTracker({
      deltaBpThreshold: 500,
      minVolume24hr: 0,
      maxSpread: 1,
      windowSeconds: 300,
    });

    const t0 = 1000;
    tracker.ingest({ slug: "m2", yesPrice: 0.5, noPrice: 0.5, bestBid: 0.49, bestAsk: 0.51, spread: 0.02, volume24hr: 5000, volumeTotal: 0, liquidity: 0, timestamp: t0 });
    const moves = tracker.ingest({ slug: "m2", yesPrice: 0.51, noPrice: 0.49, bestBid: 0.5, bestAsk: 0.52, spread: 0.02, volume24hr: 5000, volumeTotal: 0, liquidity: 0, timestamp: t0 + 60 });

    expect(moves).toHaveLength(0);
  });

  test("ignores move when volume too low", () => {
    const tracker = new PolymarketLineTracker({
      deltaBpThreshold: 100,
      minVolume24hr: 10_000,
      maxSpread: 1,
      windowSeconds: 300,
    });

    const t0 = 1000;
    tracker.ingest({ slug: "m3", yesPrice: 0.5, noPrice: 0.5, bestBid: 0.49, bestAsk: 0.51, spread: 0.02, volume24hr: 100, volumeTotal: 0, liquidity: 0, timestamp: t0 });
    const moves = tracker.ingest({ slug: "m3", yesPrice: 0.6, noPrice: 0.4, bestBid: 0.59, bestAsk: 0.61, spread: 0.02, volume24hr: 100, volumeTotal: 0, liquidity: 0, timestamp: t0 + 60 });

    expect(moves).toHaveLength(0);
  });

  test("status returns tracked slugs", () => {
    const tracker = new PolymarketLineTracker();
    tracker.ingest({ slug: "a", yesPrice: 0.5, noPrice: 0.5, bestBid: 0.49, bestAsk: 0.51, spread: 0.02, volume24hr: 0, volumeTotal: 0, liquidity: 0, timestamp: 1000 });
    tracker.ingest({ slug: "b", yesPrice: 0.5, noPrice: 0.5, bestBid: 0.49, bestAsk: 0.51, spread: 0.02, volume24hr: 0, volumeTotal: 0, liquidity: 0, timestamp: 1000 });
    expect(tracker.status()).toEqual({ a: 1, b: 1 });
  });
});

// ── Agent orchestrator ──

describe("AgentOrchestrator", () => {
  test("dispatches to registered agent", async () => {
    const orch = new AgentOrchestrator();
    const db = createRegDb();
    seedLicenseAndLimits(db);

    const repo = new ComplianceRepository(db);
    orch.register(new ComplianceAgent(repo));

    const result = await orch.dispatch(
      { type: "COMPLIANCE_CHECK", payload: { nodeId: "n1", userId: "u1", stateCode: "MA", sportId: "nba", marketId: "m1", wagerAmount: 10, betType: "straight", playId: "p1" } },
      makeAgentCtx(db),
    );

    expect(result.role).toBe("compliance");
    expect(result.ok).toBe(true);
    expect(result.data?.playId).toBe("p1");
  });

  test("returns error for unregistered role", async () => {
    const orch = new AgentOrchestrator();
    const db = createRegDb();

    const result = await orch.dispatch(
      { type: "SPIKE_DETECT", payload: {} },
      makeAgentCtx(db),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("No agent registered");
  });

  test("dispatchAll runs tasks in parallel", async () => {
    const orch = new AgentOrchestrator();
    const db = createRegDb();
    seedLicenseAndLimits(db);

    const repo = new ComplianceRepository(db);
    orch.register(new ComplianceAgent(repo));
    orch.register(new OpsAgent(new ViolationAlerts(db)));

    const results = await orch.dispatchAll(
      [
        { type: "COMPLIANCE_CHECK", payload: { nodeId: "n1", userId: "u1", stateCode: "MA", sportId: "nba", marketId: "m1", wagerAmount: 10, betType: "straight", playId: "p2" } },
        { type: "SPIKE_DETECT", payload: {} },
      ],
      makeAgentCtx(db),
    );

    expect(results).toHaveLength(2);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(true);
  });
});

// ── Compliance agent ──

describe("ComplianceAgent", () => {
  test("LINE_MOVE_EVAL flags steam bets", async () => {
    const db = createRegDb();
    const repo = new ComplianceRepository(db);
    const agent = new ComplianceAgent(repo);
    const ctx = makeAgentCtx(db);

    // Seed a bet just before the line move
    const detectedAt = 2000;
    const placedAt = detectedAt - 30; // within lookback
    db.run(
      `INSERT INTO ${TABLE.PLAYS} (play_id, node_id, user_id, sport_id, market_id, state_code, wager_amount, bet_type, status, placed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '${PLAY_STATUS.ACCEPTED}', ?)`,
      ["steam1", "n1", "u1", "nba", "will-it-rain", "MA", 100, "straight", placedAt],
    );

    const result = await agent.run(
      { type: "LINE_MOVE_EVAL", payload: { slug: "will-it-rain", oldPrice: 0.5, newPrice: 0.58, deltaBp: 1600, detectedAt } },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(result.data?.violationsFound).toBe(1);

    // Verify violation was logged
    const v = db.query<{ reason: string }, []>(`SELECT reason FROM ${TABLE.REGULATORY_VIOLATIONS}`).all();
    expect(v).toHaveLength(1);
    expect(v[0].reason).toContain("Steam alert");
  });

  test("COMPLIANCE_CHECK blocks excluded user", async () => {
    const db = createRegDb();
    db.run(`INSERT INTO ${TABLE.SELF_EXCLUSIONS} (user_id, node_id, reason) VALUES (?, ?, ?)`, ["baduser", "n1", "problem"]);
    db.run(`INSERT INTO ${TABLE.PARTNER_STATE_LICENSES} (node_id, state_code, status) VALUES (?, ?, ?)`, ["n1", "MA", "active"]);
    db.run(`INSERT INTO ${TABLE.REGULATORY_LIMITS} (state_code, sport_id, market_id, max_wager, allowed_bet_types) VALUES (?, ?, ?, ?, ?)`, ["MA", "nba", "m1", 1000, '["straight"]']);

    const repo = new ComplianceRepository(db);
    const agent = new ComplianceAgent(repo);
    const ctx = makeAgentCtx(db);

    const result = await agent.run(
      { type: "COMPLIANCE_CHECK", payload: { nodeId: "n1", userId: "baduser", stateCode: "MA", sportId: "nba", marketId: "m1", wagerAmount: 10, betType: "straight", playId: "p3" } },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("self-excluded");
  });
});

// ── Ops agent ──

describe("OpsAgent", () => {
  test("SPIKE_DETECT returns breakdown", async () => {
    const db = createRegDb();
    db.run(`INSERT INTO ${TABLE.REGULATORY_VIOLATIONS} (node_id, user_id, state_code, reason, blocked_at) VALUES (?, ?, ?, ?, ?)`, ["n1", "u1", "MA", "limit", Math.floor(Date.now() / 1000)]);

    const agent = new OpsAgent(new ViolationAlerts(db));
    const result = await agent.run(
      { type: "SPIKE_DETECT", payload: { windowSeconds: 300, threshold: 1 } },
      makeAgentCtx(db),
    );

    expect(result.ok).toBe(true);
    expect(result.data?.triggered).toBe(true);
    expect(result.data?.count).toBe(1);
    expect(result.data?.topReasons).toBeDefined();
  });
});

// ── Market data agent ──

describe("MarketDataAgent", () => {
  test("ingest stores ticks and detects line moves", async () => {
    const db = createRegDb();
    const fetchImpl = mockFetch([
      {
        id: "1",
        slug: "market-a",
        question: "Q",
        conditionId: "0x0",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.5","0.5"]',
        volume: "10000",
        volume24hr: "5000",
        liquidity: "20000",
        lastTradePrice: 0.5,
        bestBid: 0.49,
        bestAsk: 0.51,
        spread: 0.02,
        active: true,
        closed: false,
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      },
    ]);

    const agent = new MarketDataAgent(db, { fetchOptions: { fetchImpl } });
    const result = await agent.ingest(undefined, 1);

    expect(result.marketsFetched).toBe(1);
    expect(result.ticksStored).toBe(1);

    // Verify tick in DB
    const ticks = db.query<{ slug: string }, []>(`SELECT slug FROM ${TABLE.POLYMARKET_TICKS}`).all();
    expect(ticks).toHaveLength(1);
    expect(ticks[0].slug).toBe("market-a");
  });

  test("latestTicks returns most recent per slug", async () => {
    const db = createRegDb();
    const now = Math.floor(Date.now() / 1000);
    db.run(
      `INSERT INTO ${TABLE.POLYMARKET_TICKS} (slug, yes_price, no_price, best_bid, best_ask, spread, volume_24hr, volume_total, liquidity, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["s1", 0.5, 0.5, 0.49, 0.51, 0.02, 100, 200, 300, now - 100],
    );
    db.run(
      `INSERT INTO ${TABLE.POLYMARKET_TICKS} (slug, yes_price, no_price, best_bid, best_ask, spread, volume_24hr, volume_total, liquidity, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["s1", 0.55, 0.45, 0.54, 0.56, 0.02, 150, 250, 350, now],
    );

    const agent = new MarketDataAgent(db);
    const latest = agent.latestTicks(10);
    expect(latest).toHaveLength(1);
    expect(latest[0].yesPrice).toBe(0.55);
  });
});

// ── Admin agent ──

describe("AdminAgent", () => {
  test("self_exclude + get_status roundtrip", async () => {
    const db = createRegDb();
    const agent = new AdminAgent(db);
    const ctx = makeAgentCtx(db);

    // Exclude
    const exclude = await agent.run(
      { type: "ADMIN_ACTION", payload: { action: "self_exclude", nodeId: "n1", userId: "u1", payload: { reason: "cooling-off" } } },
      ctx,
    );
    expect(exclude.ok).toBe(true);

    // Check status
    const status = await agent.run(
      { type: "ADMIN_ACTION", payload: { action: "get_status", nodeId: "n1", userId: "u1" } },
      ctx,
    );
    expect(status.ok).toBe(true);
    expect(status.data?.selfExcluded).toBe(true);
    expect(status.data?.exclusionReason).toBe("cooling-off");
    expect(status.data?.dailyWagerTotal).toBe(0);
  });

  test("set_limit creates regulatory limit", async () => {
    const db = createRegDb();
    const agent = new AdminAgent(db);
    const ctx = makeAgentCtx(db);

    const result = await agent.run(
      { type: "ADMIN_ACTION", payload: { action: "set_limit", nodeId: "n1", userId: "u1", payload: { stateCode: "NJ", sportId: "nba", marketId: "m1", maxWager: 500 } } },
      ctx,
    );

    expect(result.ok).toBe(true);

    const limit = db.query<{ max_wager: number }, []>(`SELECT max_wager FROM ${TABLE.REGULATORY_LIMITS}`).get();
    expect(limit?.max_wager).toBe(500);
  });
});

// ── End-to-end pipeline ──

describe("End-to-end agent pipeline", () => {
  test("full compliance pipeline dispatches market ingest + spike detect", async () => {
    const db = createRegDb();
    const orch = new AgentOrchestrator();
    const repo = new ComplianceRepository(db);
    orch.register(new ComplianceAgent(repo));
    orch.register(new OpsAgent(new ViolationAlerts(db)));
    orch.register(new MarketDataAgent(db, {
      fetchOptions: {
        fetchImpl: mockFetch([
          {
            id: "99",
            slug: "e2e-market",
            question: "E2E",
            conditionId: "0x0",
            outcomes: '["Yes","No"]',
            outcomePrices: '["0.5","0.5"]',
            volume: "5000",
            volume24hr: "2000",
            liquidity: "10000",
            lastTradePrice: 0.5,
            active: true,
            closed: false,
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ]),
      },
    }));

    const results = await orch.runCompliancePipeline(makeAgentCtx(db));
    expect(results).toHaveLength(2);

    // Market ingest should succeed
    const ingestResult = results.find((r) => r.role === "market_data");
    expect(ingestResult?.ok).toBe(true);

    // Spike detect should succeed
    const opsResult = results.find((r) => r.role === "ops");
    expect(opsResult?.ok).toBe(true);
  });
});
