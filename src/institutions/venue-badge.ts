/**
 * ANSI venue badges for tennis / cross-market desk output.
 * Identity colors (not edge ok/warn/bad — use terminal-utils edgeColor for those).
 *
 * Mirrors monorepo lib/venues/venue-brand.ts (Kalshi-bot has no monorepo lib import).
 *
 * @see https://bun.com/docs/runtime/color
 */

import { paint, type ColorKey } from '../lib/color/index.ts';

export type MarketVenue =
  | 'kalshi'
  | 'polymarket'
  | 'pinnacle'
  | 'betfair'
  | 'unknown';

const META: Record<
  MarketVenue,
  { label: string; short: string; /** ColorKey — paint() via color kernel */ key: ColorKey }
> = {
  kalshi: { label: 'Kalshi', short: 'KX', key: 'kalshi' },
  polymarket: { label: 'Poly', short: 'PM', key: 'polymarket' },
  pinnacle: { label: 'Pinnacle', short: 'PN', key: 'pinnacle' },
  betfair: { label: 'Betfair', short: 'BF', key: 'betfair' },
  unknown: { label: 'Unknown', short: '??', key: 'unknown' },
};

const ALIASES: Record<string, MarketVenue> = {
  kalshi: 'kalshi',
  kx: 'kalshi',
  polymarket: 'polymarket',
  poly: 'polymarket',
  pm: 'polymarket',
  pinnacle: 'pinnacle',
  pinny: 'pinnacle',
  pn: 'pinnacle',
  betfair: 'betfair',
  bf: 'betfair',
};

export function parseMarketVenue(raw: unknown): MarketVenue {
  if (typeof raw !== 'string' || !raw.trim()) return 'unknown';
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, '');
  return ALIASES[key] ?? 'unknown';
}

/** @example fmtVenueBadge('polymarket', false) → "● PM" */
export function fmtVenueBadge(
  venue: MarketVenue | string,
  showLabel = true,
): string {
  const id = typeof venue === 'string' ? parseMarketVenue(venue) : venue;
  const v = META[id] ?? META.unknown;
  const label = showLabel ? v.label : v.short;
  return `${paint('●', v.key)} ${paint(label, v.key)}`;
}

export function fmtVenueLegend(): string {
  const venues: MarketVenue[] = ['kalshi', 'polymarket', 'pinnacle', 'betfair'];
  return 'Venues: ' + venues.map(v => fmtVenueBadge(v, true)).join('  ');
}
