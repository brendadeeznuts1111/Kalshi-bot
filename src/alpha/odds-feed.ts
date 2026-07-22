// @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
// @see https://bun.com/docs/runtime/sqlite
// @see https://the-odds-api.com/liveapi/guides/v4/
import { Database } from "bun:sqlite";
import { ensureCacheDir } from "../research/cache.ts";
import { OFFICIAL_URLS } from "../institutions/official-urls.ts";
import { impliedSideProbabilities } from "./vig-strip.ts";
import {
  PINNACLE_BOOKMAKER_KEY,
  type FeedEventId,
  type FetchOddsResult,
  type MarketSide,
  type OddsEvent,
  type PinnacleSnapshot,
  parseOddsEventsWire,
} from "./odds-types.ts";
import { ODDS_CACHE_DB } from "./paths.ts";

export type OddsFetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type OddsFeedOptions = {
  region?: string;
  markets?: string;
  /** Override for tests — defaults to global fetch. */
  fetchImpl?: OddsFetchImpl;
  dbPath?: string;
  apiKey?: string;
};

const DEFAULT_MARKETS = "h2h,spreads,totals";
const DEFAULT_REGION = "us";

let oddsDbs = new Map<string, Database>();
let oddsDb: Database | null = null;

function oddsDatabase(dbPath = ODDS_CACHE_DB): Database {
  if (oddsDb && dbPath === ODDS_CACHE_DB) return oddsDb;
  const cached = oddsDbs.get(dbPath);
  if (cached) return cached;
  const db = new Database(dbPath, { create: true });
  if (dbPath !== ":memory:") {
    db.run("PRAGMA journal_mode=WAL;");
  }
  db.run(`CREATE TABLE IF NOT EXISTS odds_cache (
    feed_key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    etag TEXT,
    fetched_at INTEGER NOT NULL
  )`);
  if (dbPath === ODDS_CACHE_DB) oddsDb = db;
  oddsDbs.set(dbPath, db);
  return db;
}

function cacheKey(sport: string, region: string, markets: string): string {
  return `${sport}/${region}/${markets}`;
}

function resolveApiKey(explicit?: string): string {
  const key = explicit ?? Bun.env.ODDS_API_KEY?.trim();
  if (!key) throw new Error("ODDS_API_KEY required — set in environment");
  return key;
}

function buildOddsUrl(sport: string, region: string, markets: string, apiKey: string): string {
  const params = new URLSearchParams({
    apiKey,
    regions: region,
    markets,
    bookmakers: PINNACLE_BOOKMAKER_KEY,
  });
  return `${OFFICIAL_URLS.oddsApi.apiBaseV4}/sports/${encodeURIComponent(sport)}/odds/?${params}`;
}

type CacheRow = { data: string; etag: string | null; fetched_at: number };

function readCache(db: Database, key: string): CacheRow | null {
  const row = db.query("SELECT data, etag, fetched_at FROM odds_cache WHERE feed_key = ?").get(key) as
    | CacheRow
    | undefined;
  return row ?? null;
}

function writeCache(db: Database, key: string, data: string, etag: string | null): void {
  db.run(
    "INSERT OR REPLACE INTO odds_cache (feed_key, data, etag, fetched_at) VALUES (?, ?, ?, ?)",
    [key, data, etag, Date.now()],
  );
}

/** Fetch raw Odds API payload with ETag cache (304 → zero quota). */
export async function fetchOdds(sport: string, options: OddsFeedOptions = {}): Promise<FetchOddsResult> {
  await ensureCacheDir();
  const region = options.region ?? DEFAULT_REGION;
  const markets = options.markets ?? DEFAULT_MARKETS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const db = oddsDatabase(options.dbPath);
  const key = cacheKey(sport, region, markets);
  const cached = readCache(db, key);

  const headers = new Headers({ Accept: "application/json" });
  if (cached?.etag) headers.set("If-None-Match", cached.etag);

  const apiKey = resolveApiKey(options.apiKey);
  const url = buildOddsUrl(sport, region, markets, apiKey);
  const res = await fetchImpl(url, { headers });

  if (res.status === 304 && cached) {
    const events = parseOddsEventsWire(JSON.parse(cached.data));
    return {
      events,
      fromCache: true,
      etag: cached.etag,
      fetchedAt: cached.fetched_at,
    };
  }

  if (!res.ok) {
    throw new Error(`Odds API error: ${res.status} ${res.statusText}`);
  }

  const body = await res.text();
  const etag = res.headers.get("etag");
  writeCache(db, key, body, etag);
  const events = parseOddsEventsWire(JSON.parse(body));
  return {
    events,
    fromCache: false,
    etag,
    fetchedAt: Date.now(),
  };
}

function findOutcomePrice(
  outcomes: { name: string; price: number }[],
  teamName: string,
): number | null {
  const exact = outcomes.find((o) => o.name === teamName);
  if (exact) return exact.price;
  const lower = teamName.toLowerCase();
  const fuzzy = outcomes.find((o) => o.name.toLowerCase() === lower);
  return fuzzy?.price ?? null;
}

/** Extract Pinnacle h2h snapshot + vig-stripped probabilities for one event. */
export function pinnacleSnapshot(event: OddsEvent): PinnacleSnapshot | null {
  const pinnacle = event.bookmakers.find((b) => b.key === PINNACLE_BOOKMAKER_KEY);
  const h2h = pinnacle?.markets.find((m) => m.key === "h2h");
  if (!pinnacle || !h2h) return null;

  const homePrice = findOutcomePrice(h2h.outcomes, event.homeTeam);
  const awayPrice = findOutcomePrice(h2h.outcomes, event.awayTeam);
  if (homePrice === null || awayPrice === null) return null;

  const drawOutcome = h2h.outcomes.find(
    (o) => o.name.toLowerCase() === "draw" || o.name.toLowerCase() === "tie",
  );
  const american = {
    home: homePrice,
    away: awayPrice,
    draw: drawOutcome?.price,
  };
  const probabilities = impliedSideProbabilities(american);

  return {
    eventId: event.id,
    lastUpdate: pinnacle.lastUpdate,
    commenceTime: event.commenceTime,
    homeTeam: event.homeTeam,
    awayTeam: event.awayTeam,
    american,
    probabilities,
  };
}

export function listPinnacleSnapshots(events: OddsEvent[]): PinnacleSnapshot[] {
  return events.map(pinnacleSnapshot).filter((s): s is PinnacleSnapshot => s !== null);
}

/** Model probability for a side — vig-stripped Pinnacle h2h consensus. */
export function getModelProb(event: OddsEvent, side: MarketSide): number | null {
  const snap = pinnacleSnapshot(event);
  if (!snap) return null;
  if (side === "home") return snap.probabilities.home;
  if (side === "away") return snap.probabilities.away;
  return snap.probabilities.draw ?? null;
}

export function getModelProbByEventId(
  events: OddsEvent[],
  eventId: FeedEventId,
  side: MarketSide,
): number | null {
  const event = events.find((e) => e.id === eventId);
  if (!event) return null;
  return getModelProb(event, side);
}

/** Reset module singleton db (tests). */
export function resetOddsFeedCache(dbPath?: string): void {
  const close = (db: Database) => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  };
  if (dbPath) {
    const hit = oddsDbs.get(dbPath);
    if (hit) close(hit);
    oddsDbs.delete(dbPath);
    if (dbPath === ODDS_CACHE_DB) oddsDb = null;
    return;
  }
  for (const db of oddsDbs.values()) close(db);
  oddsDbs.clear();
  oddsDb = null;
}
