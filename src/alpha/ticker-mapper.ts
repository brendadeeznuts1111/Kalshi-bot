// @see https://bun.com/docs/runtime/sqlite
/** Kalshi-specific ticker ↔ Odds API event glue — hand-maintained, not liftable from public repos. */
import { Database } from "bun:sqlite";
import { ensureCacheDir } from "../research/cache.ts";
import type { FeedEventId } from "./odds-types.ts";
import { asFeedEventId, tryFeedEventId } from "./odds-types.ts";
import { TICKER_MAP_DB, TICKER_OVERRIDES_PATH } from "./paths.ts";

export type FeedEventRef = {
  eventId: FeedEventId;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
};

export type MappedEvent = FeedEventRef & {
  kalshiTicker: string;
  matchScore: number;
  source: "override" | "auto";
};

export type TickerMapperOptions = {
  dbPath?: string;
  overridesPath?: string;
  /** When true, run hard-fail validation before returning a mapping. */
  validate?: boolean;
  pinnacleProb?: number;
  kalshiPriceCents?: number;
};

export type MappingValidationOptions = {
  maxStartHoursDrift?: number;
  maxImpliedProbGapCents?: number;
};

export class TickerMappingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TickerMappingError";
    this.code = code;
  }
}

/** Kalshi NBA suffix codes → substring match in Odds API team names. */
export const NBA_TEAM_CODES: Record<string, string> = {
  ATL: "Hawks",
  BOS: "Celtics",
  BKN: "Nets",
  CHA: "Hornets",
  CHI: "Bulls",
  CLE: "Cavaliers",
  DAL: "Mavericks",
  DEN: "Nuggets",
  DET: "Pistons",
  GSW: "Warriors",
  HOU: "Rockets",
  IND: "Pacers",
  LAC: "Clippers",
  LAL: "Lakers",
  MEM: "Grizzlies",
  MIA: "Heat",
  MIL: "Bucks",
  MIN: "Timberwolves",
  NOP: "Pelicans",
  NYK: "Knicks",
  OKC: "Thunder",
  ORL: "Magic",
  PHI: "76ers",
  PHX: "Suns",
  POR: "Trail Blazers",
  SAC: "Kings",
  SAS: "Spurs",
  TOR: "Raptors",
  UTA: "Jazz",
  WAS: "Wizards",
};

let mapDb: Database | null = null;
let mapDbs = new Map<string, Database>();

function mapperDatabase(dbPath = TICKER_MAP_DB): Database {
  if (dbPath === TICKER_MAP_DB && mapDb) return mapDb;
  const cached = mapDbs.get(dbPath);
  if (cached) return cached;
  const db = new Database(dbPath, { create: true });
  if (dbPath !== ":memory:") {
    db.run("PRAGMA journal_mode=WAL;");
  }
  db.run(`CREATE TABLE IF NOT EXISTS ticker_map (
    kalshi_ticker TEXT PRIMARY KEY,
    feed_event_id TEXT NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    start_time TEXT NOT NULL,
    last_validated INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS unmapped_tickers (
    kalshi_ticker TEXT PRIMARY KEY,
    last_seen INTEGER NOT NULL
  )`);
  if (dbPath === TICKER_MAP_DB) mapDb = db;
  mapDbs.set(dbPath, db);
  return db;
}

type OverrideRow = {
  eventId: string;
  home: string;
  away: string;
  start: string;
};

export async function loadTickerOverrides(
  path = TICKER_OVERRIDES_PATH,
): Promise<Record<string, OverrideRow>> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  try {
    const raw = (await file.json()) as Record<string, OverrideRow>;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/** Extract Kalshi date token e.g. 26JAN15 from KXNBAGAME-26JAN15LALBOS. */
export function extractKalshiDateToken(ticker: string): string | null {
  const m = ticker.match(/(\d{2}[A-Z]{3}\d{2})/);
  return m?.[1] ?? null;
}

/** Parse KXNBAGAME suffix into [homeCode, awayCode] (Kalshi home+away order). */
export function parseNbaGameTeamCodes(ticker: string): [string, string] | null {
  const m = ticker.match(/^KXNBAGAME-\d{2}[A-Z]{3}\d{2}([A-Z]{6})$/);
  if (!m) return null;
  const blob = m[1]!;
  return [blob.slice(0, 3), blob.slice(3, 6)];
}

/** Team hint tokens from ticker suffix (uppercase runs). */
export function extractTeamHints(ticker: string): string[] {
  const nba = parseNbaGameTeamCodes(ticker);
  if (nba) return nba;
  const upper = ticker.replace(/[^A-Z]/g, "");
  const hints: string[] = [];
  for (let len = 3; len <= 4; len++) {
    if (upper.length >= len) hints.push(upper.slice(-len));
  }
  return [...new Set(hints)];
}

function teamNameMatchesCode(code: string, teamName: string): boolean {
  const needle = NBA_TEAM_CODES[code];
  if (!needle) return teamName.toUpperCase().includes(code);
  return teamName.toLowerCase().includes(needle.toLowerCase());
}

function teamHintScore(hints: string[], home: string, away: string): number {
  const blob = `${home} ${away}`.toUpperCase();
  let score = 0;
  for (const hint of hints) {
    if (blob.includes(hint)) score += 1;
  }
  return score;
}

function bothTeamsMatched(ticker: string, home: string, away: string): boolean {
  const nba = parseNbaGameTeamCodes(ticker);
  if (nba) {
    const [homeCode, awayCode] = nba;
    return teamNameMatchesCode(homeCode, home) && teamNameMatchesCode(awayCode, away);
  }
  const hints = extractTeamHints(ticker);
  const homeHit = hints.some((h) => home.toUpperCase().includes(h));
  const awayHit = hints.some((h) => away.toUpperCase().includes(h));
  return homeHit && awayHit;
}

function dateProximityScore(kalshiToken: string | null, commenceTime: string): number {
  if (!kalshiToken) return 0;
  const parsed = parseKalshiDateToken(kalshiToken);
  if (!parsed) return 0;
  const commence = new Date(commenceTime);
  if (Number.isNaN(commence.getTime())) return 0;
  const diffDays = Math.abs(
    (commence.getTime() - parsed.getTime()) / (24 * 60 * 60 * 1000),
  );
  return diffDays <= 1 ? 1 : 0;
}

/** 26JAN15 → Date (UTC noon, year 20YY). */
export function parseKalshiDateToken(token: string): Date | null {
  const m = token.match(/^(\d{2})([A-Z]{3})(\d{2})$/);
  if (!m) return null;
  const year = 2000 + Number(m[1]);
  const mon = monthAbbrev(m[2]!);
  if (mon === null) return null;
  const day = Number(m[3]);
  return new Date(Date.UTC(year, mon, day, 12, 0, 0));
}

function monthAbbrev(abbr: string): number | null {
  const map: Record<string, number> = {
    JAN: 0,
    FEB: 1,
    MAR: 2,
    APR: 3,
    MAY: 4,
    JUN: 5,
    JUL: 6,
    AUG: 7,
    SEP: 8,
    OCT: 9,
    NOV: 10,
    DEC: 11,
  };
  return map[abbr] ?? null;
}

const MIN_AUTO_MATCH_SCORE = 2;
const DEFAULT_MAX_START_HOURS_DRIFT = 36;
const DEFAULT_MAX_IMPLIED_PROB_GAP_CENTS = 15;

/** Hard-fail validation — start time, both teams, optional implied-prob sanity. */
export function validateTickerMapping(
  kalshiTicker: string,
  mapped: MappedEvent,
  options: MappingValidationOptions & {
    pinnacleProb?: number;
    kalshiPriceCents?: number;
  } = {},
): void {
  const dateToken = extractKalshiDateToken(kalshiTicker);
  if (!dateToken) {
    throw new TickerMappingError("missing_date_token", `No Kalshi date token in ${kalshiTicker}`);
  }
  const kalshiDate = parseKalshiDateToken(dateToken);
  const commence = new Date(mapped.commenceTime);
  if (!kalshiDate || Number.isNaN(commence.getTime())) {
    throw new TickerMappingError(
      "invalid_start_time",
      `Unparseable start time for ${kalshiTicker}: ${mapped.commenceTime}`,
    );
  }
  const driftHours =
    Math.abs(commence.getTime() - kalshiDate.getTime()) / (60 * 60 * 1000);
  const maxDrift = options.maxStartHoursDrift ?? DEFAULT_MAX_START_HOURS_DRIFT;
  if (driftHours > maxDrift) {
    throw new TickerMappingError(
      "start_time_drift",
      `Start drift ${driftHours.toFixed(1)}h exceeds ${maxDrift}h for ${kalshiTicker}`,
    );
  }

  if (!bothTeamsMatched(kalshiTicker, mapped.homeTeam, mapped.awayTeam)) {
    throw new TickerMappingError(
      "team_mismatch",
      `Both teams must match ticker suffix for ${kalshiTicker} (${mapped.awayTeam} @ ${mapped.homeTeam})`,
    );
  }

  if (options.pinnacleProb != null && options.kalshiPriceCents != null) {
    const gapCents = Math.abs(options.pinnacleProb * 100 - options.kalshiPriceCents);
    const maxGap = options.maxImpliedProbGapCents ?? DEFAULT_MAX_IMPLIED_PROB_GAP_CENTS;
    if (gapCents > maxGap) {
      throw new TickerMappingError(
        "implied_prob_gap",
        `Pinnacle ${(options.pinnacleProb * 100).toFixed(1)}c vs Kalshi ${options.kalshiPriceCents}c — gap ${gapCents.toFixed(1)}c > ${maxGap}c`,
      );
    }
  }
}

export async function matchTicker(
  kalshiTicker: string,
  feedEvents: FeedEventRef[],
  options: TickerMapperOptions = {},
): Promise<MappedEvent | null> {
  await ensureCacheDir();
  const db = mapperDatabase(options.dbPath);
  const overrides = await loadTickerOverrides(options.overridesPath);

  const override = overrides[kalshiTicker];
  if (override) {
    const eventId = tryFeedEventId(override.eventId);
    if (!eventId) return null;
    const mapped: MappedEvent = {
      kalshiTicker,
      eventId,
      homeTeam: override.home,
      awayTeam: override.away,
      commenceTime: override.start,
      matchScore: 999,
      source: "override",
    };
    if (options.validate !== false) {
      validateTickerMapping(kalshiTicker, mapped, {
        pinnacleProb: options.pinnacleProb,
        kalshiPriceCents: options.kalshiPriceCents,
      });
    }
    persistMapping(db, mapped);
    return mapped;
  }

  const dateToken = extractKalshiDateToken(kalshiTicker);
  const hints = extractTeamHints(kalshiTicker);

  let bestScore = 0;
  let best: MappedEvent | null = null;
  for (const event of feedEvents) {
    let score = dateProximityScore(dateToken, event.commenceTime);
    score += teamHintScore(hints, event.homeTeam, event.awayTeam);
    if (score > bestScore) {
      bestScore = score;
      best = {
        kalshiTicker,
        eventId: event.eventId,
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        commenceTime: event.commenceTime,
        matchScore: score,
        source: "auto",
      };
    }
  }

  if (best && bestScore >= MIN_AUTO_MATCH_SCORE) {
    if (options.validate !== false) {
      validateTickerMapping(kalshiTicker, best, {
        pinnacleProb: options.pinnacleProb,
        kalshiPriceCents: options.kalshiPriceCents,
      });
    }
    persistMapping(db, best);
    return best;
  }

  db.run("INSERT OR REPLACE INTO unmapped_tickers (kalshi_ticker, last_seen) VALUES (?, ?)", [
    kalshiTicker,
    Date.now(),
  ]);
  return null;
}

/** Hard-fail wrapper — throws TickerMappingError when mapping or validation fails. */
export async function mapTickerOrThrow(
  kalshiTicker: string,
  feedEvents: FeedEventRef[],
  options: TickerMapperOptions = {},
): Promise<MappedEvent> {
  const mapped = await matchTicker(kalshiTicker, feedEvents, { ...options, validate: true });
  if (!mapped) {
    throw new TickerMappingError("unmapped", `No Pinnacle event for ${kalshiTicker}`);
  }
  return mapped;
}

function persistMapping(db: Database, mapped: MappedEvent): void {
  db.run(
    `INSERT OR REPLACE INTO ticker_map
      (kalshi_ticker, feed_event_id, home_team, away_team, start_time, last_validated)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      mapped.kalshiTicker,
      mapped.eventId,
      mapped.homeTeam,
      mapped.awayTeam,
      mapped.commenceTime,
      Date.now(),
    ],
  );
}

export function resetTickerMapperCache(dbPath?: string): void {
  const close = (db: Database) => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  };
  if (dbPath) {
    const hit = mapDbs.get(dbPath);
    if (hit) close(hit);
    mapDbs.delete(dbPath);
    if (dbPath === TICKER_MAP_DB) mapDb = null;
    return;
  }
  for (const db of mapDbs.values()) close(db);
  mapDbs.clear();
  mapDb = null;
}

export { asFeedEventId };
