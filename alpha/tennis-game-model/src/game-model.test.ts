// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { openEventStore } from "../../../src/institutions/event-store/open-db.ts";
import {
  asCanonicalEventId,
  asKalshiMarketTicker,
} from "../../../src/institutions/event-store/brands.ts";
import { buildGameModelP } from "./game-model.ts";
import type { ScoreContext } from "./score-context.ts";

type Db = ReturnType<typeof openEventStore>;

function seedEventWithBook(db: Db): {
  eventId: ReturnType<typeof asCanonicalEventId>;
  ticker: ReturnType<typeof asKalshiMarketTicker>;
} {
  const eventId = asCanonicalEventId("itf|game-model|test-1");
  const ticker = asKalshiMarketTicker("KXITFMATCH-26JUL22AAA-BBB");
  const now = Date.now();
  db.query(
    `INSERT INTO events (
      event_id, tour, level, tournament, location, surface, court, round, best_of,
      player_a, player_b, winner, loser, start_ts, outcome, source, source_url, fetched_ts,
      source_row_hash, ingested_at, corpus
    ) VALUES (
      $id, 'ITF-M', 'KXITFMATCH', 't', '', 'Hard', '', 'r', 3,
      'Alice', 'Bob', '', '', $start, 'scheduled', 'test', '', $now,
      'h', $now, 'trading'
    )`,
  ).run({ $id: eventId, $start: new Date(now).toISOString(), $now: now });
  db.query(
    `INSERT INTO markets (market_id, event_id, venue, ticker, series, side_code, yes_side_label, competitor_id, source)
     VALUES ('kalshi:test', $id, 'kalshi', $ticker, 'KXITFMATCH', 'BBB', 'Bob', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'test')`,
  ).run({ $id: eventId, $ticker: ticker });
  const book = JSON.stringify({
    ts: now,
    seq: 1,
    bids: [{ priceCents: 44, size: 10 }],
    asks: [{ priceCents: 46, size: 10 }],
  });
  db.query(
    `INSERT INTO book_ticks (event_id, ticker, ts, recv_ts, source_clock, seq, levels_json, source, source_url)
     VALUES ($id, $ticker, $ts, $ts, 'recv', 1, $book, 'kalshi-rest', '')`,
  ).run({ $id: eventId, $ticker: ticker, $ts: now, $book: book });
  return { eventId, ticker };
}

let histSeq = 0;
function seedHistory(
  db: Db,
  opts: { playerA: string; playerB: string; winner: string; startIso: string; scoreText?: string },
): void {
  histSeq++;
  const id = `itf|game-model|hist-${histSeq}`;
  db.query(
    `INSERT INTO events (
      event_id, tour, level, tournament, location, surface, court, round, best_of,
      player_a, player_b, winner, loser, start_ts, outcome, source, source_url, fetched_ts,
      source_row_hash, ingested_at, corpus, score_text
    ) VALUES (
      $id, 'ITF-M', 'itf pro wtt - men''s 15', 't', '', 'Hard', '', 'r', 3,
      $pa, $pb, $w, $l, $start, 'completed', 'itf-stadion', '', 1,
      $hash, 1, 'trading', $score
    )`,
  ).run({
    $id: id,
    $pa: opts.playerA,
    $pb: opts.playerB,
    $w: opts.winner,
    $l: opts.winner === opts.playerA ? opts.playerB : opts.playerA,
    $start: opts.startIso,
    $hash: `h-${id}`,
    $score: opts.scoreText ?? "6-4 6-4",
  });
  db.query(
    `INSERT INTO resolutions (event_id, outcome, winner, source, corpus, resolved_ts)
     VALUES ($id, 1, $w, 'itf-stadion', 'trading', $resolved)`,
  ).run({ $id: id, $w: opts.winner, $resolved: opts.startIso });
}

describe("game-model", () => {
  test("pre-match with both players unknown → default-vs-default 0.5, players_known=0", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const { eventId, ticker } = seedEventWithBook(db);
    const result = buildGameModelP({
      db,
      ticker,
      eventId,
      currentMidCents: 50,
      score: null,
    });
    expect(result).not.toBeNull();
    expect(result!.pModel).toBeCloseTo(0.5, 6);
    expect(result!.components.model_kind).toBe(0);
    expect(result!.components.players_known).toBe(0);
    // Market echo retained as a component, never blended into p_model.
    expect(result!.components.market_opening_prior).toBeCloseTo(0.45, 6);
    db.close();
  });

  test("market observation does not alter p_model when the causal circuit is fixed", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const { eventId, ticker } = seedEventWithBook(db);
    const lowMarket = buildGameModelP({
      db,
      ticker,
      eventId,
      currentMidCents: 15,
      score: null,
    });
    const highMarket = buildGameModelP({
      db,
      ticker,
      eventId,
      currentMidCents: 85,
      score: null,
    });
    expect(lowMarket).not.toBeNull();
    expect(highMarket).not.toBeNull();
    expect(highMarket!.pModel).toBe(lowMarket!.pModel);
    // Market price remains a recorded decision observation, not a model input.
    expect(highMarket!.components.market_opening_prior).toBeDefined();
    db.close();
  });

  test("pre-match with stronger YES player → p_model > 0.5 from corpus, not the mid", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const { eventId, ticker } = seedEventWithBook(db);
    // Bob (YES side) with a deep winning history as-of the tick.
    for (let i = 0; i < 12; i++) {
      seedHistory(db, {
        playerA: "Bob",
        playerB: `Hist Opponent ${i}`,
        winner: "Bob",
        startIso: `2026-07-1${i % 9}T10:00:00Z`,
        scoreText: "6-2 6-2",
      });
    }
    seedHistory(db, {
      playerA: "Alice",
      playerB: "Hist Opponent X",
      winner: "Hist Opponent X",
      startIso: "2026-07-19T10:00:00Z",
      scoreText: "6-1 6-1",
    });
    const result = buildGameModelP({
      db,
      ticker,
      eventId,
      currentMidCents: 45,
      score: null,
    });
    expect(result).not.toBeNull();
    expect(result!.components.players_known).toBe(2);
    expect(result!.pModel).toBeGreaterThan(0.5);
    // Independent of the market echo (0.45): the prior comes from strengths.
    expect(result!.pModel).not.toBeCloseTo(0.45, 2);
    expect(result!.components.hold_prob_yes).toBeGreaterThan(result!.components.hold_prob_no!);
    db.close();
  });

  test("symmetric known strengths → pre-match p_model ≈ 0.5", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const { eventId, ticker } = seedEventWithBook(db);
    for (const [a, b, w] of [
      ["Alice", "Carol", "Alice"],
      ["Bob", "Dave", "Bob"],
    ] as const) {
      seedHistory(db, { playerA: a, playerB: b, winner: w, startIso: "2026-07-19T10:00:00Z" });
    }
    const result = buildGameModelP({
      db,
      ticker,
      eventId,
      currentMidCents: 45,
      score: null,
    });
    expect(result!.components.players_known).toBe(2);
    expect(result!.pModel).toBeCloseTo(0.5, 2);
    db.close();
  });

  test("ambiguous identity → null (labeled skip), never a guess", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const { eventId, ticker } = seedEventWithBook(db);
    // YES label matches neither event player.
    db.query(`UPDATE markets SET yes_side_label = 'Nobody' WHERE ticker = $t`).run({ $t: ticker });
    const result = buildGameModelP({
      db,
      ticker,
      eventId,
      currentMidCents: 45,
      score: null,
    });
    expect(result).toBeNull();
    db.close();
  });

  test("live with server uses match Markov on self-model holds", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const { eventId, ticker } = seedEventWithBook(db);
    const score: ScoreContext = {
      setsYes: 1,
      setsNo: 0,
      gamesYes: 3,
      gamesNo: 2,
      pointsServer: 2,
      pointsReturner: 1,
      serverIsYes: true,
      bestOf: 3,
      isLive: true,
    };
    const result = buildGameModelP({
      db,
      ticker,
      eventId,
      currentMidCents: 55,
      score,
    });
    expect(result!.components.model_kind).toBe(2);
    // YES a set up with symmetric (unknown) strengths → above the 0.5 prior.
    expect(result!.pModel).toBeGreaterThan(0.5);
    db.close();
  });
});
