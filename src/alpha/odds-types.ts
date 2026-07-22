// @see https://bun.com/docs/runtime/utils#bun-fetch
/** Interior types for The Odds API → Pinnacle consensus (wire parsed at boundary). */

/** Sharp book SSOT — The Odds API bookmaker key. */
export const PINNACLE_BOOKMAKER_KEY = "pinnacle" as const;

export type MarketSide = "home" | "away" | "draw";

export type FeedEventId = string & { readonly __brand: unique symbol };

export function asFeedEventId(raw: string): FeedEventId {
  const id = raw.trim();
  if (!id) throw new Error("FeedEventId required");
  return id as FeedEventId;
}

export function tryFeedEventId(raw: string | undefined): FeedEventId | undefined {
  if (!raw?.trim()) return undefined;
  return asFeedEventId(raw);
}

export type OddsOutcome = {
  name: string;
  price: number;
};

export type OddsMarket = {
  key: string;
  outcomes: OddsOutcome[];
};

export type OddsBookmaker = {
  key: string;
  title: string;
  lastUpdate: string;
  markets: OddsMarket[];
};

/** Normalized event after wire parse — Pinnacle slice attached separately. */
export type OddsEvent = {
  id: FeedEventId;
  sportKey: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  bookmakers: OddsBookmaker[];
};

export type PinnacleSnapshot = {
  eventId: FeedEventId;
  lastUpdate: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  /** American odds (The Odds API wire format). */
  american: { home: number; away: number; draw?: number };
  /** Vig-stripped implied probabilities (sum = 1). */
  probabilities: { home: number; away: number; draw?: number };
};

export type FetchOddsResult = {
  events: OddsEvent[];
  fromCache: boolean;
  etag: string | null;
  fetchedAt: number;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseOutcome(raw: unknown): OddsOutcome | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === "string" ? raw.name : null;
  const price = typeof raw.price === "number" ? raw.price : null;
  if (!name || price === null) return null;
  return { name, price };
}

function parseMarket(raw: unknown): OddsMarket | null {
  if (!isRecord(raw)) return null;
  const key = typeof raw.key === "string" ? raw.key : null;
  if (!key || !Array.isArray(raw.outcomes)) return null;
  const outcomes = raw.outcomes.map(parseOutcome).filter((o): o is OddsOutcome => o !== null);
  if (!outcomes.length) return null;
  return { key, outcomes };
}

function parseBookmaker(raw: unknown): OddsBookmaker | null {
  if (!isRecord(raw)) return null;
  const key = typeof raw.key === "string" ? raw.key : null;
  const title = typeof raw.title === "string" ? raw.title : key ?? "";
  const lastUpdate =
    typeof raw.last_update === "string"
      ? raw.last_update
      : typeof raw.lastUpdate === "string"
        ? raw.lastUpdate
        : null;
  if (!key || !lastUpdate || !Array.isArray(raw.markets)) return null;
  const markets = raw.markets.map(parseMarket).filter((m): m is OddsMarket => m !== null);
  return { key, title, lastUpdate, markets };
}

/** Wire boundary: The Odds API event array → interior events. */
export function parseOddsEventsWire(wire: unknown): OddsEvent[] {
  if (!Array.isArray(wire)) throw new Error("Odds API response must be an array");
  const out: OddsEvent[] = [];
  for (const row of wire) {
    if (!isRecord(row)) continue;
    const idRaw = typeof row.id === "string" ? row.id : null;
    const sportKey = typeof row.sport_key === "string" ? row.sport_key : null;
    const commenceTime = typeof row.commence_time === "string" ? row.commence_time : null;
    const homeTeam = typeof row.home_team === "string" ? row.home_team : null;
    const awayTeam = typeof row.away_team === "string" ? row.away_team : null;
    if (!idRaw || !sportKey || !commenceTime || !homeTeam || !awayTeam) continue;
    const bookmakers = Array.isArray(row.bookmakers)
      ? row.bookmakers.map(parseBookmaker).filter((b): b is OddsBookmaker => b !== null)
      : [];
    out.push({
      id: asFeedEventId(idRaw),
      sportKey,
      commenceTime,
      homeTeam,
      awayTeam,
      bookmakers,
    });
  }
  return out;
}
