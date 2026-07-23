/**
 * Player strength store — per-player serve/return strength estimated from the
 * Stadion ITF results corpus (event-store resolutions, corpus='trading' ONLY;
 * research-only rows never enter estimation, per doctrine).
 *
 * What the corpus actually carries (inspected 2026-07-22, 1,153 resolutions):
 *   - events.player_a / player_b / winner / start_ts / surface / tour
 *   - events.score_text for ~99% of resolved rows ("6-4 5-7 6-3", tiebreak
 *     scores parenthesised, e.g. "6-7(3-7)") — set/game scores, oriented
 *     player_a-first (validated per match below; mismatches are skipped, not
 *     guessed).
 *   - NO point-level or serve stats. So the estimator uses match outcomes +
 *     game win rates — never invented point stats.
 *   - Format: no explicit format column; doubles are identified by tour
 *     suffix (ITF-MD / ITF-WD) and excluded — doubles dynamics differ.
 *   - Surface: events.surface ∈ {Clay, Hard, unknown}; ~60% of rows are
 *     'unknown', so v1 callers pass no surface. `surface` is the hook: when
 *     given, estimation runs over that surface's matches only.
 *
 * Estimator (documented shrinkage):
 *   units_won   = gamesWon + MATCH_WEIGHT_GAMES · matchesWon
 *   units_total = games     + MATCH_WEIGHT_GAMES · matches
 *   strength    = (units_won + PRIOR_UNITS · 0.5) / (units_total + PRIOR_UNITS)
 * A Beta-style shrinkage toward 0.5 (the corpus mean is 0.5 by symmetry —
 * every win is someone else's loss). PRIOR_UNITS = 60 game-units ≈ 3 matches
 * of ~20 games: a 1-match player is pulled hard toward the mean, a 40-match
 * player sits near the empirical rate. Sensitivity on the 2026-07 corpus
 * (3 days!): rolling Brier improves monotonically as K shrinks (K=120 →
 * 0.218, K=60 → 0.201, K=24 → 0.180) — same-week form dominates a 3-day
 * corpus, so smaller K fits this window better but would overfit tiny
 * samples on a longer one. K=60 is the documented moderate choice, NOT the
 * Brier-minimizing one. MATCH_WEIGHT_GAMES = 10 counts a match win as 10
 * game-wins so matches with missing score_text still inform the estimate.
 *
 * Unknown players (0 corpus matches) get DEFAULT_UNKNOWN_STRENGTH = 0.55 —
 * corpus-measured newcomer premium (see constant doc): at ITF level first-seen
 * players beat already-seen players ~63% of the time, so the default sits
 * ABOVE the symmetric mean, shrunk toward 0.5 for small n. Never a crash,
 * never a silent 0.5.
 *
 * NO LOOKAHEAD: every query filters start_ts ≤ asOf AND resolved_ts ≤ asOf —
 * a strength asOf T uses only outcomes known before T (same discipline as the
 * backtest's timestamp alignment).
 */
import type { Database } from "bun:sqlite";

export const PRIOR_UNITS = 60;
export const MATCH_WEIGHT_GAMES = 10;
/**
 * Unknown-player default. Counter-intuitive but corpus-measured: replaying the
 * corpus chronology, players with a prior corpus record beat first-seen
 * players only 37% of the time (n=100) — at ITF futures level, one-off
 * entrants are often higher-ranked seeds while repeat players are grinders.
 * Shrinking the measured newcomer premium (0.63) toward 0.5 (small n) gives
 * 0.55. Documented, never a crash, never a 0.5 cop-out.
 */
export const DEFAULT_UNKNOWN_STRENGTH = 0.55;
export const SINGLES_TOURS = ["ITF-M", "ITF-W"] as const;

export type PlayerStrength = {
  /** Normalized identity key. */
  key: string;
  matches: number;
  wins: number;
  gamesWon: number;
  gamesLost: number;
  /** Shrunk strength in (0,1); ≈ P(beat the average corpus player). */
  strength: number;
  /** false when the player has zero corpus matches (default applied). */
  known: boolean;
};

/** Lowercase, accent-stripped, letters-only — Stadion vs Kalshi ALLCAPS safe. */
export function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

type MatchRow = {
  player_a: string;
  player_b: string;
  winner: string;
  score_text: string;
};

/** Parse "6-4 5-7 7-6(7-5)" → per-set [gamesA, gamesB]; unparseable → null. */
export function parseScoreText(scoreText: string): Array<[number, number]> | null {
  const trimmed = scoreText.trim();
  if (!trimmed) return null;
  const sets: Array<[number, number]> = [];
  for (const token of trimmed.split(/\s+/)) {
    const m = /^(\d+)-(\d+)(?:\(\d+-\d+\))?$/.exec(token);
    if (!m) return null;
    sets.push([Number(m[1]), Number(m[2])]);
  }
  return sets.length ? sets : null;
}

/**
 * Games won/lost for the winner, with orientation validation: the majority of
 * parsed set-winners must agree with the winner field (score_text is
 * player_a-first). Disagreement → null (ambiguous orientation hard-fails; the
 * match still counts at match level, its games are dropped).
 */
function gamesForWinner(row: MatchRow): { won: number; lost: number } | null {
  const sets = parseScoreText(row.score_text);
  if (!sets) return null;
  let aSets = 0;
  let bSets = 0;
  let gamesA = 0;
  let gamesB = 0;
  for (const [a, b] of sets) {
    gamesA += a;
    gamesB += b;
    if (a > b) aSets++;
    else if (b > a) bSets++;
  }
  const winnerIsA = row.winner === row.player_a;
  const setMajorityA = aSets > bSets;
  if (aSets === bSets || winnerIsA !== setMajorityA) return null;
  return winnerIsA ? { won: gamesA, lost: gamesB } : { won: gamesB, lost: gamesA };
}

type Agg = {
  rawName: string;
  matches: number;
  wins: number;
  gamesWon: number;
  gamesLost: number;
};

function shrink(agg: Agg): number {
  const unitsWon = agg.gamesWon + MATCH_WEIGHT_GAMES * agg.wins;
  const unitsTotal =
    agg.gamesWon + agg.gamesLost + MATCH_WEIGHT_GAMES * agg.matches;
  return (unitsWon + PRIOR_UNITS * 0.5) / (unitsTotal + PRIOR_UNITS);
}

export type CorpusStrengths = {
  /** Normalized key → aggregate. */
  byKey: Map<string, Agg>;
  /** Normalized keys shared by >1 distinct raw name — ambiguous identity. */
  ambiguousKeys: Set<string>;
};

const cacheByDb = new WeakMap<Database, Map<string, CorpusStrengths>>();

function loadCorpusStrengths(
  db: Database,
  opts: { asOfMs: number; surface?: string },
): CorpusStrengths {
  const cacheKey = `${opts.asOfMs}|${opts.surface ?? ""}`;
  let cache = cacheByDb.get(db);
  if (!cache) {
    cache = new Map();
    cacheByDb.set(db, cache);
  }
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const asOfIso = new Date(opts.asOfMs).toISOString();
  const surfaceClause = opts.surface ? "AND e.surface = $surface" : "";
  const rows = db
    .query(
      `SELECT e.player_a, e.player_b, e.winner, e.score_text
       FROM resolutions r
       JOIN events e ON e.event_id = r.event_id
       WHERE r.corpus = 'trading' AND e.corpus = 'trading'
         AND e.tour IN ('ITF-M', 'ITF-W')
         AND e.outcome = 'completed'
         AND e.start_ts <= $asOf AND r.resolved_ts <= $asOf
         ${surfaceClause}`,
    )
    .all(
      opts.surface
        ? { $asOf: asOfIso, $surface: opts.surface }
        : { $asOf: asOfIso },
    ) as MatchRow[];

  const byKey = new Map<string, Agg>();
  const rawNames = new Map<string, Set<string>>();
  const bump = (name: string, won: boolean, gWon: number, gLost: number) => {
    const key = normalizePlayerName(name);
    if (!key) return;
    let agg = byKey.get(key);
    if (!agg) {
      agg = { rawName: name, matches: 0, wins: 0, gamesWon: 0, gamesLost: 0 };
      byKey.set(key, agg);
    }
    agg.matches++;
    if (won) agg.wins++;
    agg.gamesWon += gWon;
    agg.gamesLost += gLost;
    let names = rawNames.get(key);
    if (!names) {
      names = new Set();
      rawNames.set(key, names);
    }
    names.add(name.trim().replace(/\s+/g, " ").toLowerCase());
  };

  for (const row of rows) {
    if (row.winner !== row.player_a && row.winner !== row.player_b) continue;
    const winnerIsA = row.winner === row.player_a;
    const games = gamesForWinner(row);
    bump(row.player_a, winnerIsA, games ? (winnerIsA ? games.won : games.lost) : 0, games ? (winnerIsA ? games.lost : games.won) : 0);
    bump(row.player_b, !winnerIsA, games ? (winnerIsA ? games.lost : games.won) : 0, games ? (winnerIsA ? games.won : games.lost) : 0);
  }

  const ambiguousKeys = new Set<string>();
  for (const [key, names] of rawNames) {
    if (names.size > 1) ambiguousKeys.add(key);
  }

  const out = { byKey, ambiguousKeys };
  if (cache.size > 256) cache.clear();
  cache.set(cacheKey, out);
  return out;
}

/** Test-only: drop cached corpus for one DB. */
export function clearStrengthCache(db: Database): void {
  cacheByDb.delete(db);
}

/**
 * Strength for one player as of `asOfMs`. Unknown → DEFAULT_UNKNOWN_STRENGTH
 * with known=false (documented ITF-level default, never a crash or 0.5).
 */
export function strengthFor(
  db: Database,
  playerName: string,
  opts: { asOfMs: number; surface?: string },
): PlayerStrength {
  const key = normalizePlayerName(playerName);
  const corpus = loadCorpusStrengths(db, opts);
  const agg = corpus.byKey.get(key);
  if (!agg || agg.matches === 0) {
    return {
      key,
      matches: 0,
      wins: 0,
      gamesWon: 0,
      gamesLost: 0,
      strength: DEFAULT_UNKNOWN_STRENGTH,
      known: false,
    };
  }
  return {
    key,
    matches: agg.matches,
    wins: agg.wins,
    gamesWon: agg.gamesWon,
    gamesLost: agg.gamesLost,
    strength: shrink(agg),
    known: true,
  };
}

/** True when the normalized name collides across distinct corpus players. */
export function isAmbiguousName(
  db: Database,
  playerName: string,
  opts: { asOfMs: number; surface?: string },
): boolean {
  const corpus = loadCorpusStrengths(db, opts);
  return corpus.ambiguousKeys.has(normalizePlayerName(playerName));
}

/**
 * Bradley–Terry matchup probability: P(yes beats no). Against an exactly
 * average opponent (0.5) this returns the player's own strength; symmetric
 * strengths → exactly 0.5.
 */
export function matchupPriorP(strengthYes: number, strengthNo: number): number {
  const a = strengthYes * (1 - strengthNo);
  const b = strengthNo * (1 - strengthYes);
  const denom = a + b;
  if (denom <= 0) return 0.5;
  return a / denom;
}
