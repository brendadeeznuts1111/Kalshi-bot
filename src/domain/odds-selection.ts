/**
 * Clean separation of inventory identity vs odds/ticket selection coordinates.
 *
 * - Inventory: stream-list → skin_events.stream_id (coverage)
 * - Odds: widget #!/event/N · Pandora eventCoefficients · ticket componentBets
 *
 * Do not treat stream_id and eventId as interchangeable. DOM ids like
 * `set-to-max-{event}-m-{n}` are incomplete (trailing n is ambiguous); ticket
 * coords (eventId + periodId + marketId + key) are SSOT for a priced leg.
 */

import type { CompetitionId } from './competitions.ts';
import type { SportId } from './sports.ts';

/** Inventory plane (stream-list → skin_events). */
export type InventoryEventRef = {
  streamId: string;
  sportId?: SportId;
  competitionId?: CompetitionId;
};

/** Odds / widget / ticket plane (Pandora + place-bet). */
export type OddsEventRef = {
  /** Opaque wire id — same space as #!/event/N and ticket eventId. */
  eventId: string; // brand-ok — opaque provider event primary key
};

/**
 * Full priced selection (ticket componentBet + coefficient store).
 * periodId `m` = match; marketId `3` = moneyline (proven).
 */
export type OddsSelection = {
  eventId: string; // brand-ok — opaque provider event primary key
  periodId: string;
  marketId: string;
  key: string;
};

/** Proven Pandora / ticket marketId labels only. */
export const KNOWN_MARKET_LABELS = {
  '3': 'moneyline',
  '5': 'total',
  '6': 'spread',
} as const;

export type KnownMarketId = keyof typeof KNOWN_MARKET_LABELS;

export type TicketLegCoords = {
  eventId: string | number;
  periodId?: string | null;
  marketId?: string | number | null;
  key?: string | null;
};

export type CoefficientLineCoords = {
  eventId: number | string;
  period: string;
  marketType: string;
  selection: string;
};

export function marketLabel(marketId: string): string {
  const id = marketId.trim();
  const known = KNOWN_MARKET_LABELS[id as KnownMarketId];
  return known ?? `market:${id || '?'}`;
}

export function periodLabel(periodId: string): string {
  const p = periodId.trim();
  if (p === 'm') return 'match';
  return p || '?';
}

export function selectionFromTicketLeg(leg: TicketLegCoords): OddsSelection | undefined {
  const eventId = String(leg.eventId ?? '').trim();
  const periodId = String(leg.periodId ?? '').trim();
  const marketId = leg.marketId != null ? String(leg.marketId).trim() : '';
  const key = leg.key != null ? String(leg.key).trim() : '';
  if (!eventId || !periodId || !marketId || !key) return undefined;
  return { eventId, periodId, marketId, key };
}

export function selectionFromCoefficientLine(
  line: CoefficientLineCoords
): OddsSelection | undefined {
  const eventId = String(line.eventId ?? '').trim();
  const periodId = String(line.period ?? '').trim();
  const marketId = String(line.marketType ?? '').trim();
  const key = String(line.selection ?? '').trim();
  if (!eventId || !periodId || !marketId || !key) return undefined;
  return { eventId, periodId, marketId, key };
}

/** Human-readable selection line for logs / docs. */
export function describeSelection(sel: OddsSelection): string {
  return (
    `event=${sel.eventId}` +
    ` period=${periodLabel(sel.periodId)}` +
    ` market=${marketLabel(sel.marketId)}` +
    ` side=${sel.key}`
  );
}

/** Concrete capture: Darin vs Plachy, Plachy ML. */
export const EXAMPLE_DARIN_PLACHY_SELECTION: OddsSelection = {
  eventId: '196878741',
  periodId: 'm',
  marketId: '3',
  key: '2',
};
