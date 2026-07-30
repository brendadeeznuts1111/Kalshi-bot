/**
 * ANSI venue badges for tennis / cross-market desk output.
 * Identity colors (not edge ok/warn/bad — use terminal-utils edgeColor for those).
 *
 * Mirrors monorepo lib/venues/venue-brand.ts (Kalshi-bot has no monorepo lib import).
 *
 * @see https://bun.com/docs/runtime/color
 */

import { ANSI } from './terminal-utils.ts';

export type MarketVenue =
  | 'kalshi'
  | 'polymarket'
  | 'pinnacle'
  | 'betfair'
  | 'unknown';

const META: Record<
  MarketVenue,
  { label: string; short: string; /** brand hex for Bun.color */ hex: string }
> = {
  kalshi: { label: 'Kalshi', short: 'KX', hex: '#7DD3FC' },
  polymarket: { label: 'Poly', short: 'PM', hex: '#2E5CFF' },
  pinnacle: { label: 'Pinnacle', short: 'PN', hex: '#1A73E8' },
  betfair: { label: 'Betfair', short: 'BF', hex: '#F5B942' },
  unknown: { label: 'Unknown', short: '??', hex: '#8b949e' },
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

function paint(text: string, hex: string): string {
  const open = Bun.color(hex, 'ansi') || '';
  return open ? `${open}${text}${ANSI.reset}` : text;
}

/** @example fmtVenueBadge('polymarket', false) → "● PM" */
export function fmtVenueBadge(
  venue: MarketVenue | string,
  showLabel = true,
): string {
  const id = typeof venue === 'string' ? parseMarketVenue(venue) : venue;
  const v = META[id] ?? META.unknown;
  const label = showLabel ? v.label : v.short;
  return `${paint('●', v.hex)} ${paint(label, v.hex)}`;
}

export function fmtVenueLegend(): string {
  const venues: MarketVenue[] = ['kalshi', 'polymarket', 'pinnacle', 'betfair'];
  return 'Venues: ' + venues.map(v => fmtVenueBadge(v, true)).join('  ');
}
