/**
 * Three planes — keep separate:
 *
 * 1. Inventory — stream-list → skin_events.inventory_id
 * 2. Odds     — Pandora eventCoefficients (period / marketType / selection)
 * 3. Ticket   — place-bet componentBets (periodId / marketId / key)
 *
 * Wire field `stream_id` (Plive JSON) maps to interior `inventoryId` at parse.
 * Odds eventId and ticket eventId are usually the same wire number, but the
 * field names and types stay distinct so callers do not mix planes by accident.
 * DOM `set-to-max-{event}-m-{n}` is incomplete — not a TicketLeg or OddsLine.
 */

import type { CompetitionId } from './competitions.ts';
import type { SportId } from './sports.ts';

// ── 1. Inventory ───────────────────────────────────────────────────────────

/** Inventory plane (stream-list → skin_events). */
export type InventoryEventRef = {
  inventoryId: string; // brand-ok — opaque provider inventory primary key
  sportId?: SportId;
  competitionId?: CompetitionId;
};

// ── 2. Odds (Pandora) ──────────────────────────────────────────────────────

/** Widget / Pandora match id (`#!/event/N`, coefficient room). */
export type OddsEventRef = {
  eventId: string; // brand-ok — opaque provider event primary key
};

/**
 * One priced Pandora coefficient line.
 * Field names match the coefficient store (`period`, `marketType`, `selection`).
 */
export type OddsLine = {
  eventId: string; // brand-ok — opaque provider event primary key
  period: string;
  marketType: string;
  selection: string;
};

export type CoefficientLineCoords = {
  eventId: number | string;
  period: string;
  marketType: string;
  selection: string;
};

export function oddsLineFromCoefficient(line: CoefficientLineCoords): OddsLine | undefined {
  const eventId = String(line.eventId ?? '').trim();
  const period = String(line.period ?? '').trim();
  const marketType = String(line.marketType ?? '').trim();
  const selection = String(line.selection ?? '').trim();
  if (!eventId || !period || !marketType || !selection) return undefined;
  return { eventId, period, marketType, selection };
}

export function describeOddsLine(line: OddsLine): string {
  return (
    `odds event=${line.eventId}` +
    ` period=${periodLabel(line.period)}` +
    ` market=${marketLabel(line.marketType)}` +
    ` selection=${line.selection}`
  );
}

/** Concrete Pandora-shaped capture: Darin vs Plachy, Plachy ML. */
export const EXAMPLE_DARIN_PLACHY_ODDS_LINE: OddsLine = {
  eventId: '196878741',
  period: 'm',
  marketType: '3',
  selection: '2',
};

// ── 3. Ticket (place-bet) ──────────────────────────────────────────────────

/**
 * One ticket componentBet selection.
 * Field names match ticket wire (`periodId`, `marketId`, `key`).
 */
export type TicketLeg = {
  eventId: string; // brand-ok — opaque provider event primary key
  periodId: string;
  marketId: string;
  key: string;
};

export type TicketLegCoords = {
  eventId: string | number;
  periodId?: string | null;
  marketId?: string | number | null;
  key?: string | null;
};

export function ticketLegFromWire(leg: TicketLegCoords): TicketLeg | undefined {
  const eventId = String(leg.eventId ?? '').trim();
  const periodId = String(leg.periodId ?? '').trim();
  const marketId = leg.marketId != null ? String(leg.marketId).trim() : '';
  const key = leg.key != null ? String(leg.key).trim() : '';
  if (!eventId || !periodId || !marketId || !key) return undefined;
  return { eventId, periodId, marketId, key };
}

export function describeTicketLeg(leg: TicketLeg): string {
  return (
    `ticket event=${leg.eventId}` +
    ` period=${periodLabel(leg.periodId)}` +
    ` market=${marketLabel(leg.marketId)}` +
    ` key=${leg.key}`
  );
}

/** Concrete ticket capture: Darin vs Plachy, Plachy ML. */
export const EXAMPLE_DARIN_PLACHY_TICKET_LEG: TicketLeg = {
  eventId: '196878741',
  periodId: 'm',
  marketId: '3',
  key: '2',
};

// ── Shared labels + explicit bridges ────────────────────────────────────────

/**
 * Proven market type / marketId labels (Pandora + ticket share these ids).
 * TT + tennis extended: 7 total_points, 9 set CS, 16 set CS (encoded), 18 game winner.
 * @see partner/fantasy-ultra/market-decode.ts
 */
export const KNOWN_MARKET_LABELS = {
  '1': 'moneyline_3way',
  '3': 'moneyline',
  '4': 'draw_no_bet',
  '5': 'total',
  /** Alias: spread (sportsbook) / handicap (Pandora m/6). */
  '6': 'spread',
  '7': 'total_points',
  '8': 'team_total',
  '9': 'correct_score_sets',
  '16': 'set_correct_score',
  '18': 'game_winner',
  '20': 'set_total_games',
  '21': 'set_game_handicap',
  '30': 'outright_futures',
} as const;

export type KnownMarketId = keyof typeof KNOWN_MARKET_LABELS;

export function marketLabel(marketId: string): string {
  const id = marketId.trim();
  const known = KNOWN_MARKET_LABELS[id as KnownMarketId];
  return known ?? `market:${id || '?'}`;
}

/**
 * Default period tab order from plive `sportPeriodsService.periodCodes`
 * (mainapp). Per-sport order can override via live.sportPeriod.
 */
export const PANDORA_PERIOD_CODES = [
  'm',
  'h1',
  'h2',
  's1',
  's2',
  's3',
  's4',
  's5',
  's6',
  's7',
  's8',
  's9',
  's10',
  's11',
  's12',
  's13',
  's14',
] as const;

export type PandoraPeriodCode = (typeof PANDORA_PERIOD_CODES)[number];

/**
 * Pseudo period tabs on the event page that share match-level markets
 * (`event.controller` realPeriodIds Proxy → `"m"`).
 */
export const PSEUDO_PERIOD_TO_MATCH: Readonly<Record<string, 'm'>> = {
  p: 'm', // player props tab
  pp: 'm',
  wc: 'm', // parlay / world cup specials shell
  cn: 'm',
  cd: 'm',
  td: 'm',
  fg: 'm',
  sgp: 'm', // same game parlay
  bb: 'm', // bet builder
  fb: 'm', // featured / free bet shell
};

/**
 * Collapse pseudo period tabs to the coefficient period they price against.
 * Real codes (`m`, `h1`, `s3`, `q2`) pass through unchanged.
 */
export function canonicalizePeriodId(periodId: string): string {
  const p = periodId.trim().toLowerCase();
  if (!p) return p;
  return PSEUDO_PERIOD_TO_MATCH[p] ?? p;
}

/**
 * Human label for a Pandora / ticket period id.
 * Wire codes: m, hN, sN (set/segment), qN (quarter), iN (inning), ot/OT.
 * Pseudo tabs (p, sgp, bb, …) label as product shells, not match.
 */
export function periodLabel(periodId: string): string {
  const raw = periodId.trim();
  if (!raw) return '?';
  const p = raw.toLowerCase();

  if (p === 'm') return 'match';
  if (p === 'p' || p === 'pp') return 'player props';
  if (p === 'sgp') return 'same game parlay';
  if (p === 'bb') return 'bet builder';
  if (p === 'fb') return 'featured bets';
  if (p === 'wc') return 'parlay specials';
  if (p === 'ot' || p === 'eot') return 'overtime';
  if (p === 'et') return 'extra time';
  if (p === 'pen' || p === 'pens' || p === 'pso') return 'penalties';

  if (/^s\d+$/.test(p)) return `set ${p.slice(1)}`;
  if (/^h\d+$/.test(p)) return `half ${p.slice(1)}`;
  if (/^q\d+$/.test(p)) return `quarter ${p.slice(1)}`;
  if (/^i\d+$/.test(p)) return `inning ${p.slice(1)}`;
  if (/^p\d+$/.test(p)) return `period ${p.slice(1)}`; // hockey P1/P2 style as p1
  if (/^g\d+$/.test(p)) return `game ${p.slice(1)}`;

  // League-scoped keys sometimes appear as L_<code>
  if (/^l_/i.test(raw)) return periodLabel(raw.slice(2));

  return raw;
}

/** True when period is a default periodCodes entry (not a pseudo tab). */
export function isPandoraPeriodCode(periodId: string): boolean {
  const p = periodId.trim().toLowerCase();
  return (PANDORA_PERIOD_CODES as readonly string[]).includes(p);
}

/** Explicit bridge: odds line → ticket leg (same wire numbers, new type). */
export function ticketLegFromOddsLine(line: OddsLine): TicketLeg {
  return {
    eventId: line.eventId,
    periodId: line.period,
    marketId: line.marketType,
    key: line.selection,
  };
}

/** Explicit bridge: ticket leg → odds line. */
export function oddsLineFromTicketLeg(leg: TicketLeg): OddsLine {
  return {
    eventId: leg.eventId,
    period: leg.periodId,
    marketType: leg.marketId,
    selection: leg.key,
  };
}
