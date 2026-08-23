/**
 * Fonbet feed parser — ODDSCORP WebSocket wire shape → normalized events.
 *
 * Wire shapes (per the third-party feed contract):
 *   update_event:  ["fonbet","update_event","FONSCA…", { bk_event_id, bk_event_native_id,
 *     event_name, league_name, sport, sport_id, team1, team2, meta }]
 *   update_markets: ["fonbet","update_markets","FONSCA…", [[key, sel, odds, "", metaJson], …]]
 *     metaJson: { market_type, market_name, outcome_name, factor_id, p } — market_type 1 =
 *     match winner (1X2).
 *
 * The parser is fixture-first: built against this documented shape and tested with
 * synthetic fixtures matching it; verify against a real capture before trusting.
 *
 * @see https://oddscorp / betting-api.com (third-party Fonbet feeds)
 * @see docs/DATA_MODEL.md — output feeds the unified odds contract
 */
export type FonbetEventWire = {
  bk_event_id: string;
  bk_event_native_id?: string;
  event_name?: string;
  league_name?: string;
  sport?: string;
  sport_id?: string;
  team1?: string;
  team2?: string;
  meta?: string;
  direct_link?: string;
  /** Fonbet internal feed delay (seconds) — freshness hint. */
  live_delay?: string | number | null;
};

export type FonbetMarketWire = [string, number, string, string, string];

export type FonbetEventRow = {
  /** bk_event_native_id (stable per event across live/pre). */
  id: string;
  home: string;
  away: string;
  league: string;
  sport: string;
  competitionId: string | null;
  homeDecimal: number | null;
  awayDecimal: number | null;
  asOf: number;
  startAt: number | null;
};

/** Winner market types (Fonbet 1X2 family). */
const WINNER_MARKET_TYPES = new Set([1, 41, 43, 44, 45]);

function normName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseMeta(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function parseStartAt(meta: Record<string, unknown> | null): number | null {
  const raw = meta?.start_at;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw * 1000;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n * 1000 : null;
  }
  return null;
}

function competitionSlug(league: string): string | null {
  const s = league.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return s ? s : null;
}

/**
 * Extract the moneyline home/away decimal odds for one event from its
 * markets. Winner-type markets only; outcomes resolve against team1/team2
 * by name (fallback: literal '1'/'2' selections).
 */
export function extractMoneyline(
  ev: FonbetEventWire,
  markets: FonbetMarketWire[],
): { homeDecimal: number | null; awayDecimal: number | null } {
  const homeN = normName(ev.team1);
  const awayN = normName(ev.team2);
  let homeDecimal: number | null = null;
  let awayDecimal: number | null = null;
  for (const m of markets) {
    const meta = parseMeta(m[4]);
    const marketType = Number(meta?.market_type);
    if (!Number.isFinite(marketType) || !WINNER_MARKET_TYPES.has(marketType)) continue;
    const decimal = Number(m[2]);
    if (!Number.isFinite(decimal) || decimal <= 1) continue;
    const outcome = String(meta?.outcome_name ?? "").trim().toLowerCase();
    const outcomeN = normName(outcome);
    if (homeN && (outcomeN === homeN || outcomeN === "1")) homeDecimal ??= decimal;
    else if (awayN && (outcomeN === awayN || outcomeN === "2")) awayDecimal ??= decimal;
  }
  return { homeDecimal, awayDecimal };
}

/**
 * Normalize one update_event + its update_markets into a row for the
 * unified odds contract. Null when the event has no usable teams.
 */
export function parseFonbetEvent(
  ev: FonbetEventWire,
  markets: FonbetMarketWire[],
  now: number = Date.now(),
): FonbetEventRow | null {
  const home = ev.team1?.trim();
  const away = ev.team2?.trim();
  const league = ev.league_name?.trim() ?? "";
  if (!home || !away) return null;
  const { homeDecimal, awayDecimal } = extractMoneyline(ev, markets);
  const meta = parseMeta(ev.meta);
  return {
    id: (ev.bk_event_native_id ?? ev.bk_event_id)?.trim(),
    home,
    away,
    league,
    sport: (ev.sport ?? "").trim().toLowerCase(),
    competitionId: competitionSlug(league),
    homeDecimal,
    awayDecimal,
    asOf: now,
    startAt: parseStartAt(meta),
  };
}
