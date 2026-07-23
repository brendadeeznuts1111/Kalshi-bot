// @see https://bun.com/docs/test/index#run-tests
import { afterEach, describe, expect, test } from "bun:test";
import { openEventStore } from "../../../src/institutions/event-store/open-db.ts";
import {
  clearStrengthCache,
  DEFAULT_UNKNOWN_STRENGTH,
  MATCH_WEIGHT_GAMES,
  matchupPriorP,
  normalizePlayerName,
  parseScoreText,
  PRIOR_UNITS,
  strengthFor,
} from "./player-strengths.ts";

type Db = ReturnType<typeof openEventStore>;

let seq = 0;
function seedMatch(
  db: Db,
  opts: {
    playerA: string;
    playerB: string;
    winner: string;
    startIso: string;
    resolvedIso?: string;
    scoreText?: string;
    corpus?: string;
    tour?: string;
    outcome?: string;
    surface?: string;
  },
): void {
  seq++;
  const id = `itf|strength|${seq}`;
  db.query(
    `INSERT INTO events (
      event_id, tour, level, tournament, location, surface, court, round, best_of,
      player_a, player_b, winner, loser, start_ts, outcome, source, source_url, fetched_ts,
      source_row_hash, ingested_at, corpus, score_text
    ) VALUES (
      $id, $tour, 'itf pro wtt - men''s 15', 't', '', $surface, '', 'r', 3,
      $pa, $pb, $w, $l, $start, $outcome, 'itf-stadion', '', 1,
      $hash, 1, $corpus, $score
    )`,
  ).run({
    $id: id,
    $tour: opts.tour ?? "ITF-M",
    $surface: opts.surface ?? "Hard",
    $pa: opts.playerA,
    $pb: opts.playerB,
    $w: opts.winner,
    $l: opts.winner === opts.playerA ? opts.playerB : opts.playerA,
    $start: opts.startIso,
    $outcome: opts.outcome ?? "completed",
    $hash: `h-${id}`,
    $corpus: opts.corpus ?? "trading",
    $score: opts.scoreText ?? "6-4 6-4",
  });
  db.query(
    `INSERT INTO resolutions (event_id, outcome, winner, source, corpus, resolved_ts)
     VALUES ($id, 1, $w, 'itf-stadion', $corpus, $resolved)`,
  ).run({
    $id: id,
    $w: opts.winner,
    $corpus: opts.corpus ?? "trading",
    $resolved: opts.resolvedIso ?? opts.startIso,
  });
}

const T = (iso: string) => Date.parse(iso);

describe("player-strengths", () => {
  const dbs: Db[] = [];
  afterEach(() => {
    for (const db of dbs.splice(0)) {
      clearStrengthCache(db);
      db.close();
    }
  });

  function openDb(): Db {
    const db = openEventStore({ dbPath: ":memory:" });
    dbs.push(db);
    return db;
  }

  test("0-match player → documented default, known=false (never 0.5, never crash)", () => {
    const db = openDb();
    const s = strengthFor(db, "Ghost Player", { asOfMs: T("2026-07-22T00:00:00Z") });
    expect(s.known).toBe(false);
    expect(s.strength).toBe(DEFAULT_UNKNOWN_STRENGTH);
    expect(s.strength).not.toBe(0.5);
  });

  test("shrinkage: 1-match winner is pulled toward the mean, not 1.0", () => {
    const db = openDb();
    seedMatch(db, {
      playerA: "Alice",
      playerB: "Bob",
      winner: "Alice",
      startIso: "2026-07-20T10:00:00Z",
      scoreText: "6-4 6-4",
    });
    const s = strengthFor(db, "Alice", { asOfMs: T("2026-07-21T00:00:00Z") });
    expect(s.known).toBe(true);
    expect(s.matches).toBe(1);
    expect(s.gamesWon).toBe(12);
    expect(s.gamesLost).toBe(8);
    // (12 + 10 + 60) / (20 + 10 + 120) = 82/150 ≈ 0.547
    const expected = (12 + MATCH_WEIGHT_GAMES + PRIOR_UNITS * 0.5) / (20 + MATCH_WEIGHT_GAMES + PRIOR_UNITS);
    expect(s.strength).toBeCloseTo(expected, 6);
    expect(s.strength).toBeGreaterThan(0.5);
    expect(s.strength).toBeLessThan(0.6);
  });

  test("heavy-sample player sits near the empirical rate", () => {
    const db = openDb();
    for (let i = 0; i < 40; i++) {
      seedMatch(db, {
        playerA: "Iron Alice",
        playerB: `Opponent ${i}`,
        winner: i < 30 ? "Iron Alice" : `Opponent ${i}`,
        startIso: `2026-07-20T${String(i % 24).padStart(2, "0")}:00:0${i % 6}Z`,
        scoreText: "6-4 6-4",
      });
    }
    const s = strengthFor(db, "Iron Alice", { asOfMs: T("2026-07-21T00:00:00Z") });
    expect(s.matches).toBe(40);
    const unitsWon = s.gamesWon + MATCH_WEIGHT_GAMES * s.wins;
    const unitsTotal = s.gamesWon + s.gamesLost + MATCH_WEIGHT_GAMES * s.matches;
    const empirical = unitsWon / unitsTotal;
    expect(Math.abs(s.strength - empirical)).toBeLessThan(0.03);
  });

  test("no lookahead: strengths asOf T exclude resolutions after T", () => {
    const db = openDb();
    seedMatch(db, {
      playerA: "Alice",
      playerB: "Bob",
      winner: "Alice",
      startIso: "2026-07-20T10:00:00Z",
    });
    seedMatch(db, {
      playerA: "Alice",
      playerB: "Carol",
      winner: "Carol",
      startIso: "2026-07-21T10:00:00Z",
      scoreText: "0-6 0-6",
    });
    const before = strengthFor(db, "Alice", { asOfMs: T("2026-07-21T09:00:00Z") });
    const after = strengthFor(db, "Alice", { asOfMs: T("2026-07-22T00:00:00Z") });
    expect(before.matches).toBe(1);
    expect(after.matches).toBe(2);
    expect(after.gamesLost).toBeGreaterThan(before.gamesLost);
    expect(after.strength).toBeLessThan(before.strength);
  });

  test("research-only rows never enter estimation", () => {
    const db = openDb();
    seedMatch(db, {
      playerA: "Alice",
      playerB: "Bob",
      winner: "Alice",
      startIso: "2026-07-20T10:00:00Z",
      corpus: "research-only",
    });
    const s = strengthFor(db, "Alice", { asOfMs: T("2026-07-22T00:00:00Z") });
    expect(s.known).toBe(false);
    expect(s.matches).toBe(0);
  });

  test("walkovers and doubles are excluded", () => {
    const db = openDb();
    seedMatch(db, {
      playerA: "Alice",
      playerB: "Bob",
      winner: "Alice",
      startIso: "2026-07-20T10:00:00Z",
      outcome: "walkover",
    });
    seedMatch(db, {
      playerA: "Alice / Xena",
      playerB: "Bob / Yuri",
      winner: "Alice / Xena",
      startIso: "2026-07-20T11:00:00Z",
      tour: "ITF-MD",
    });
    const s = strengthFor(db, "Alice", { asOfMs: T("2026-07-22T00:00:00Z") });
    expect(s.matches).toBe(0);
  });

  test("surface hook filters to that surface only", () => {
    const db = openDb();
    seedMatch(db, {
      playerA: "Alice",
      playerB: "Bob",
      winner: "Alice",
      startIso: "2026-07-20T10:00:00Z",
      surface: "Clay",
    });
    const clay = strengthFor(db, "Alice", { asOfMs: T("2026-07-22T00:00:00Z"), surface: "Clay" });
    const hard = strengthFor(db, "Alice", { asOfMs: T("2026-07-22T00:00:00Z"), surface: "Hard" });
    expect(clay.matches).toBe(1);
    expect(hard.matches).toBe(0);
  });

  test("score parsing: tiebreak parens, junk hard-fails", () => {
    expect(parseScoreText("6-7(3-7) 2-6")).toEqual([[6, 7], [2, 6]]);
    expect(parseScoreText("6-4 5-7 6-3")).toEqual([[6, 4], [5, 7], [6, 3]]);
    expect(parseScoreText("")).toBeNull();
    expect(parseScoreText("RET")).toBeNull();
  });

  test("score orientation mismatch drops games but keeps the match", () => {
    const db = openDb();
    // Winner=Alice but set majority says player_b won — orientation ambiguous.
    seedMatch(db, {
      playerA: "Alice",
      playerB: "Bob",
      winner: "Alice",
      startIso: "2026-07-20T10:00:00Z",
      scoreText: "1-6 2-6",
    });
    const s = strengthFor(db, "Alice", { asOfMs: T("2026-07-22T00:00:00Z") });
    expect(s.matches).toBe(1);
    expect(s.wins).toBe(1);
    expect(s.gamesWon).toBe(0);
    expect(s.gamesLost).toBe(0);
  });

  test("name normalization folds ALLCAPS and accents", () => {
    expect(normalizePlayerName("Martin VAN DER MEERSCHEN")).toBe(
      normalizePlayerName("Martin van der Meerschen"),
    );
    expect(normalizePlayerName("José Álvarez")).toBe(normalizePlayerName("jose alvarez"));
  });

  test("matchupPriorP: symmetric → 0.5; vs average opponent returns own strength", () => {
    expect(matchupPriorP(0.5, 0.5)).toBeCloseTo(0.5, 12);
    expect(matchupPriorP(0.6, 0.5)).toBeCloseTo(0.6, 12);
    expect(matchupPriorP(0.6, 0.4)).toBeGreaterThan(0.6);
    expect(matchupPriorP(0.48, 0.48)).toBeCloseTo(0.5, 12);
  });
});
