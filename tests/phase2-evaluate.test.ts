// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/test/writing-tests
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  buildTrades,
  deriveYesSide,
  evaluate,
  kalshiFeeCents,
  PRIMARY_THRESHOLD_CENTS,
  type ScoredMarket,
} from "../scripts/phase2-evaluate.ts";

// ── In-memory event-store fixture ───────────────────────────────

function makeDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE events (
      event_id TEXT PRIMARY KEY,
      player_a TEXT, player_b TEXT,
      start_ts TEXT, surface TEXT,
      winner TEXT, loser TEXT,
      corpus TEXT NOT NULL DEFAULT 'trading'
    );
    CREATE TABLE resolutions (
      event_id TEXT PRIMARY KEY,
      outcome INTEGER, winner TEXT, resolved_ts TEXT
    );
    CREATE TABLE price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT, ticker TEXT, ts INTEGER,
      kalshi_mid_cents INTEGER, kalshi_bid_cents INTEGER, kalshi_ask_cents INTEGER,
      kalshi_volume_24h INTEGER, kalshi_open_interest INTEGER,
      poly_prob REAL, pinny_prob REAL,
      elo_prob REAL, elo_surface TEXT, elo_a REAL, elo_b REAL,
      rps_flag INTEGER, div_flag INTEGER, source TEXT, surface_edge INTEGER
    );
    CREATE TABLE markets (
      ticker TEXT PRIMARY KEY,
      market_kind TEXT, yes_side_label TEXT, side_code TEXT
    );
  `);
  return db;
}

function addEvent(
  db: Database,
  eventId: string,
  opts: { startTs?: string | null; winner?: string | null; surface?: string; playerA?: string; playerB?: string } = {},
): void {
  db.run(
    "INSERT INTO events (event_id, player_a, player_b, start_ts, surface, winner) VALUES (?, ?, ?, ?, ?, ?)",
    [
      eventId,
      opts.playerA ?? "Player Alpha",
      opts.playerB ?? "Player Beta",
      opts.startTs === undefined ? "2026-01-10T12:00:00Z" : opts.startTs,
      opts.surface ?? "hard",
      opts.winner === undefined ? "Player Alpha" : opts.winner,
    ],
  );
  db.run("INSERT INTO resolutions (event_id, outcome, winner, resolved_ts) VALUES (?, ?, ?, ?)", [
    eventId,
    opts.winner === "Player Beta" ? 0 : 1,
    opts.winner === undefined ? "Player Alpha" : opts.winner,
    "2026-01-10T14:00:00Z",
  ]);
}

function addSnapshot(
  db: Database,
  eventId: string,
  ticker: string,
  ts: number,
  opts: { mid?: number | null; bid?: number | null; ask?: number | null; elo?: number | null; surface?: string } = {},
): void {
  db.run(
    `INSERT INTO price_snapshots
       (event_id, ticker, ts, kalshi_mid_cents, kalshi_bid_cents, kalshi_ask_cents, elo_prob, elo_surface)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      ticker,
      ts,
      opts.mid === undefined ? 50 : opts.mid,
      opts.bid === undefined ? 48 : opts.bid,
      opts.ask === undefined ? 52 : opts.ask,
      opts.elo === undefined ? 0.6 : opts.elo,
      opts.surface ?? null,
    ],
  );
}

function addMarket(db: Database, ticker: string, yesSideLabel: string, sideCode: string): void {
  db.run("INSERT INTO markets (ticker, market_kind, yes_side_label, side_code) VALUES (?, 'match_winner', ?, ?)", [
    ticker,
    yesSideLabel,
    sideCode,
  ]);
}

const START_MS = Date.parse("2026-01-10T12:00:00Z");
const HOUR = 3_600_000;

// ── (a) leakage guard ───────────────────────────────────────────

describe("phase2-evaluate leakage guard", () => {
  test("picks the LAST pre-start snapshot, never a post-start price", () => {
    const db = makeDb();
    addEvent(db, "ev1");
    addMarket(db, "KX-TEST-A", "Player Alpha", "ALP");
    addSnapshot(db, "ev1", "KX-TEST-A", START_MS - 2 * HOUR, { mid: 40, elo: 0.5 });
    addSnapshot(db, "ev1", "KX-TEST-A", START_MS - HOUR, { mid: 45, elo: 0.55 }); // last pre-start
    addSnapshot(db, "ev1", "KX-TEST-A", START_MS + HOUR, { mid: 90, elo: 0.99 }); // post-start — must not be used

    const result = evaluate(db);
    expect(result.counts.scoredMarkets).toBe(1);
    expect(result.scored[0].selectedTs).toBe(START_MS - HOUR);
    expect(result.scored[0].pMarket).toBe(0.45);
    expect(result.scored[0].pElo).toBe(0.55);
    expect(result.counts.skippedNoPreStartPrice).toBe(0);
    db.close();
  });

  test("event with only post-start snapshots is excluded and counted", () => {
    const db = makeDb();
    addEvent(db, "ev1");
    addMarket(db, "KX-TEST-A", "Player Alpha", "ALP");
    addSnapshot(db, "ev1", "KX-TEST-A", START_MS + HOUR);

    const result = evaluate(db);
    expect(result.counts.scoredMarkets).toBe(0);
    expect(result.counts.skippedNoPreStartPrice).toBe(1);
    expect(result.verdict.overall).toBe("INSUFFICIENT_DATA");
    db.close();
  });
});

// ── (b) fallback-first-snapshot ─────────────────────────────────

describe("phase2-evaluate start_ts fallback", () => {
  test("unparseable start_ts falls back to the FIRST snapshot and counts it", () => {
    const db = makeDb();
    addEvent(db, "ev1", { startTs: "not-a-date" });
    addMarket(db, "KX-TEST-A", "Player Alpha", "ALP");
    addSnapshot(db, "ev1", "KX-TEST-A", START_MS - 2 * HOUR, { mid: 41 });
    addSnapshot(db, "ev1", "KX-TEST-A", START_MS - HOUR, { mid: 42 });

    const result = evaluate(db);
    expect(result.counts.fallbackFirstSnapshot).toBe(1);
    expect(result.scored[0].selectedTs).toBe(START_MS - 2 * HOUR);
    expect(result.scored[0].pMarket).toBe(0.41);
    db.close();
  });
});

// ── (c) dedupe: many snapshots / many tickers → one trade per event ──

describe("phase2-evaluate trade dedupe", () => {
  test("5 snapshots of one event produce exactly 1 scored market and ≤1 trade", () => {
    const db = makeDb();
    addEvent(db, "ev1");
    addMarket(db, "KX-TEST-A", "Player Alpha", "ALP");
    for (let i = 5; i >= 1; i--) {
      addSnapshot(db, "ev1", "KX-TEST-A", START_MS - i * HOUR, { mid: 50, elo: 0.7 });
    }

    const result = evaluate(db);
    expect(result.counts.scoredMarkets).toBe(1);
    expect(result.roiByThreshold[PRIMARY_THRESHOLD_CENTS].trades).toBe(1);
    expect(result.roiByThreshold[PRIMARY_THRESHOLD_CENTS].dedupedExtras).toBe(0);
    db.close();
  });

  test("two tickers of one event collapse to one trade (largest edge kept)", () => {
    const db = makeDb();
    addEvent(db, "ev1");
    addMarket(db, "KX-TEST-A", "Player Alpha", "ALP");
    addMarket(db, "KX-TEST-B", "Player Beta", "BET");
    addSnapshot(db, "ev1", "KX-TEST-A", START_MS - HOUR, { mid: 50, elo: 0.56 }); // edge 6¢
    addSnapshot(db, "ev1", "KX-TEST-B", START_MS - HOUR, { mid: 50, elo: 0.4 }); // edge 10¢

    const result = evaluate(db);
    expect(result.counts.scoredMarkets).toBe(2);
    const roi = result.roiByThreshold[PRIMARY_THRESHOLD_CENTS];
    expect(roi.trades).toBe(1);
    expect(roi.dedupedExtras).toBe(1);
    db.close();
  });
});

// ── (d) ROI math with the fee function ──────────────────────────

describe("phase2-evaluate ROI math", () => {
  test("kalshiFeeCents implements ceil(0.07 * c * (100 - c) / 100)", () => {
    expect(kalshiFeeCents(62)).toBe(2); // ceil(1.6492)
    expect(kalshiFeeCents(42)).toBe(2); // ceil(1.7052)
    expect(kalshiFeeCents(50)).toBe(2); // ceil(1.75)
    expect(kalshiFeeCents(99)).toBe(1); // ceil(0.0693)
  });

  const base: ScoredMarket = {
    eventId: "ev1",
    ticker: "KX-TEST-A",
    surface: "hard",
    startTsMs: START_MS,
    selectedTs: START_MS - HOUR,
    pElo: 0.7,
    pMarket: 0.6,
    y: 1,
    yesSideLabel: "Player Alpha",
    bidCents: 58,
    askCents: 62,
    midCents: 60,
  };

  test("BUY_YES win at ask 62: profit = 100 - 62 - 2 = 36¢ (zero-fee 38¢)", () => {
    const { trades } = buildTrades([base], 4);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.direction).toBe("BUY_YES");
    expect(t.entryCents).toBe(62);
    expect(t.feeCents).toBe(2);
    expect(t.win).toBe(true);
    expect(t.profitCents).toBe(36);
    expect(t.zeroFeeProfitCents).toBe(38);
  });

  test("BUY_NO loss at 100 - bid = 42: profit = -42 - 2 = -44¢ (zero-fee -42¢)", () => {
    const short: ScoredMarket = { ...base, pElo: 0.3, y: 1 };
    const { trades } = buildTrades([short], 4);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.direction).toBe("BUY_NO");
    expect(t.entryCents).toBe(42);
    expect(t.feeCents).toBe(2);
    expect(t.win).toBe(false);
    expect(t.profitCents).toBe(-44);
    expect(t.zeroFeeProfitCents).toBe(-42);
  });

  test("missing bid/ask falls back to mid and is counted", () => {
    const noQuote: ScoredMarket = { ...base, bidCents: null, askCents: null };
    const { trades } = buildTrades([noQuote], 4);
    expect(trades[0].entryCents).toBe(60); // mid fallback
    expect(trades[0].usedFallbackPrice).toBe(true);
  });
});

// ── (e) Brier for Elo and market ────────────────────────────────

describe("phase2-evaluate Brier", () => {
  test("computes Brier_Elo and Brier_Market plus per-surface breakdown", () => {
    const db = makeDb();
    addEvent(db, "ev1", { winner: "Player Alpha", surface: "clay" });
    addMarket(db, "KX-TEST-A", "Player Alpha", "ALP");
    addSnapshot(db, "ev1", "KX-TEST-A", START_MS - HOUR, { mid: 60, elo: 0.8, surface: "clay" });
    // y=1 → elo (0.8-1)^2=0.04, market (0.6-1)^2=0.16
    addEvent(db, "ev2", { winner: "Player Beta", surface: "clay", playerA: "Player Gamma", playerB: "Player Beta" });
    addMarket(db, "KX-TEST-G", "Player Gamma", "GAM");
    addSnapshot(db, "ev2", "KX-TEST-G", START_MS - HOUR, { mid: 50, elo: 0.4, surface: "clay" });
    // y=0 → elo 0.16, market 0.25

    const result = evaluate(db);
    expect(result.brier.n).toBe(2);
    expect(result.brier.eloBrier).toBeCloseTo(0.1, 10); // (0.04+0.16)/2
    expect(result.brier.marketBrier).toBeCloseTo(0.205, 10); // (0.16+0.25)/2
    expect(result.brier.bySurface.clay.n).toBe(2);
    expect(result.brier.bySurface.clay.elo).toBeCloseTo(0.1, 10);
    db.close();
  });
});

// ── (f) verdict FAILs with insufficient data ────────────────────

describe("phase2-evaluate verdict", () => {
  test("below the event minimum every data criterion FAILs as INSUFFICIENT_DATA", () => {
    const db = makeDb();
    // 3 resolved, profitable events — still far below the 100-event minimum.
    for (let i = 1; i <= 3; i++) {
      addEvent(db, `ev${i}`, { winner: "Player Alpha" });
      addMarket(db, `KX-TEST-${i}`, "Player Alpha", "ALP");
      addSnapshot(db, `ev${i}`, `KX-TEST-${i}`, START_MS - HOUR, { mid: 50, elo: 0.7 });
    }

    const result = evaluate(db);
    expect(result.verdict.overall).toBe("INSUFFICIENT_DATA");
    const minEvents = result.verdict.criteria.find((c) => c.name.includes("independent events"))!;
    expect(minEvents.pass).toBe(false);
    expect(minEvents.actual).toBe("3 scored events");
    const netRoi = result.verdict.criteria.find((c) => c.name.includes("net ROI"))!;
    expect(netRoi.pass).toBe(false);
    expect(netRoi.insufficient).toBe(true);
    // Leakage-guard criterion is structural and still reports its counts.
    const guard = result.verdict.criteria.find((c) => c.name.includes("pre-start"))!;
    expect(guard.pass).toBe(true);
    // Decision matrix rows are undecided under INSUFFICIENT_DATA.
    expect(result.verdict.decisionMatrix.every((r) => r.triggered === null)).toBe(true);
    db.close();
  });
});

// ── (g) side derivation ─────────────────────────────────────────

describe("phase2-evaluate side derivation", () => {
  test("deriveYesSide prefers markets.yes_side_label for match-winner markets", () => {
    const side = deriveYesSide("KXITFMATCH-26JUL22IVACHA-CHA", {
      market_kind: "match_winner",
      yes_side_label: "Aleksander Chayka",
      side_code: "CHA",
    });
    expect(side).toEqual({ yesSideLabel: "Aleksander Chayka", source: "markets" });
  });

  test("deriveYesSide returns null without a markets row (ambiguous)", () => {
    expect(deriveYesSide("KXITFMATCH-26JUL22IVACHA-CHA", null)).toBeNull();
  });

  test("deriveYesSide rejects non-match-winner market kinds", () => {
    expect(
      deriveYesSide("KX-SET1-CHA", { market_kind: "set_winner", yes_side_label: "X", side_code: "CHA" }),
    ).toBeNull();
  });

  test("YES-side win and loss both resolve from events.winner", () => {
    const db = makeDb();
    addEvent(db, "ev1", {
      playerA: "Aleksander Chayka",
      playerB: "Kalin Ivanovski",
      winner: "Kalin Ivanovski",
    });
    addMarket(db, "KXITFMATCH-26JUL22IVACHA-CHA", "Aleksander Chayka", "CHA");
    addMarket(db, "KXITFMATCH-26JUL22IVACHA-IVA", "Kalin Ivanovski", "IVA");
    addSnapshot(db, "ev1", "KXITFMATCH-26JUL22IVACHA-CHA", START_MS - HOUR);
    addSnapshot(db, "ev1", "KXITFMATCH-26JUL22IVACHA-IVA", START_MS - HOUR);

    const result = evaluate(db);
    expect(result.counts.scoredMarkets).toBe(2);
    const cha = result.scored.find((s) => s.ticker.endsWith("-CHA"))!;
    const iva = result.scored.find((s) => s.ticker.endsWith("-IVA"))!;
    expect(cha.y).toBe(0); // Chayka lost → YES on Chayka resolves 0
    expect(iva.y).toBe(1); // Ivanovski won → YES on Ivanovski resolves 1
    db.close();
  });

  test("ticker with no markets row is counted as skipped_unknown_side", () => {
    const db = makeDb();
    addEvent(db, "ev1");
    addSnapshot(db, "ev1", "KX-UNKNOWN-X", START_MS - HOUR);

    const result = evaluate(db);
    expect(result.counts.scoredMarkets).toBe(0);
    expect(result.counts.skippedUnknownSide).toBe(1);
    db.close();
  });
});
