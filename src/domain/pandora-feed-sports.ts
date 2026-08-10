/**
 * Pandora / Spandora **feed sport id** SSOT (`live.sports` / eventData path `s/{id}/…`).
 *
 * This is **not** the widget `sportOrder` id and **not** necessarily the Ultra
 * ticket `apiSportId`. Three planes:
 *
 * | Plane | Source | Example |
 * | ----- | ------ | ------- |
 * | feedSportId | live.sports / eventData | tennis=8, basketball=2, TT=93 |
 * | widgetSportId | shell sportOrder | tennis=2, TT=220, favorites=214 |
 * | inventoryBucket | stream-list-v2 | tennis, table_tennis, football |
 *
 * Captured 2026-08-10 from wss://spandora.ganchrow.com live.sports (85 ids).
 * mainapp: isTableTennis(e) ⇒ Number(e)===93.
 */

import { getSport, type SportId } from './sports.ts';

export type PandoraFeedSportKind =
  | 'core' // maps 1:1 to SportId
  | 'variant' // maps to parent SportId (props/futures/college)
  | 'event' // one-off tournament shell
  | 'unmapped'; // known feed name, no SportId yet

export type PandoraFeedSport = {
  feedSportId: number;
  /** live.sports[id].n */
  name: string;
  /**
   * Canonical SportId when known.
   * Variants (props/futures) point at the parent sport.
   */
  sportId: SportId | null;
  kind: PandoraFeedSportKind;
  /** Parent feed id when this is a props/futures/event shell. */
  parentFeedSportId?: number;
};

/**
 * Core + high-value feed ids. Names match live.sports capture.
 * Unmapped specialty ids are still listed so agents do not invent aliases.
 */
export const PANDORA_FEED_SPORTS: readonly PandoraFeedSport[] = [
  // ── Core (eventData board regulars) ────────────────────────────────────
  { feedSportId: 1, name: 'Baseball', sportId: 'baseball', kind: 'core' },
  { feedSportId: 2, name: 'Basketball', sportId: 'basketball', kind: 'core' },
  { feedSportId: 3, name: 'Football', sportId: 'american_football', kind: 'core' },
  { feedSportId: 4, name: 'Hockey', sportId: 'ice_hockey', kind: 'core' },
  { feedSportId: 5, name: 'Soccer', sportId: 'soccer', kind: 'core' },
  { feedSportId: 6, name: 'Fighting', sportId: 'martial_arts', kind: 'core' },
  { feedSportId: 7, name: 'Golf', sportId: 'golf', kind: 'core' },
  { feedSportId: 8, name: 'Tennis', sportId: 'tennis', kind: 'core' },
  { feedSportId: 9, name: 'Motor Racing', sportId: 'motorsport', kind: 'core' },
  { feedSportId: 10, name: 'Horse Racing', sportId: 'horse_racing', kind: 'core' },
  { feedSportId: 13, name: 'Boxing', sportId: 'boxing', kind: 'core' },
  { feedSportId: 27, name: 'MMA', sportId: 'ufc', kind: 'core' },
  { feedSportId: 86, name: 'Handball', sportId: 'handball', kind: 'core' },
  { feedSportId: 87, name: 'Cricket', sportId: 'cricket', kind: 'core' },
  { feedSportId: 88, name: 'Volleyball', sportId: 'volleyball', kind: 'core' },
  { feedSportId: 89, name: 'Futsal', sportId: 'futsal', kind: 'core' },
  { feedSportId: 90, name: 'Bandy', sportId: 'bandy', kind: 'core' },
  { feedSportId: 92, name: 'Rugby', sportId: 'rugby', kind: 'core' },
  { feedSportId: 93, name: 'Table Tennis', sportId: 'table_tennis', kind: 'core' },
  {
    feedSportId: 94,
    name: 'Australian Rules',
    sportId: 'australian_rules',
    kind: 'core',
  },
  { feedSportId: 95, name: 'Badminton', sportId: 'badminton', kind: 'core' },
  { feedSportId: 98, name: 'Snooker', sportId: 'snooker', kind: 'core' },
  {
    feedSportId: 107,
    name: 'Martial Arts/UFC',
    sportId: 'martial_arts',
    kind: 'core',
  },
  {
    feedSportId: 110,
    name: 'Beach Volleyball',
    sportId: 'volleyball',
    kind: 'variant',
    parentFeedSportId: 88,
  },
  {
    feedSportId: 114,
    name: 'E-Sports',
    sportId: 'sports_channels',
    kind: 'core',
  },
  { feedSportId: 118, name: 'Darts', sportId: 'darts', kind: 'core' },
  { feedSportId: 124, name: 'Cycling', sportId: 'cycling', kind: 'core' },
  { feedSportId: 125, name: 'Formula 1', sportId: 'formula_1', kind: 'core' },
  { feedSportId: 135, name: 'Floorball', sportId: 'floorball', kind: 'core' },
  { feedSportId: 172, name: 'Curling', sportId: null, kind: 'unmapped' },
  { feedSportId: 91, name: 'Curling', sportId: null, kind: 'unmapped' },
  { feedSportId: 218, name: 'Padel', sportId: null, kind: 'unmapped' },
  { feedSportId: 113, name: 'Water Polo', sportId: null, kind: 'unmapped' },
  { feedSportId: 120, name: 'Field Hockey', sportId: null, kind: 'unmapped' },
  { feedSportId: 122, name: 'Lacrosse', sportId: null, kind: 'unmapped' },
  { feedSportId: 190, name: 'Softball', sportId: 'baseball', kind: 'variant', parentFeedSportId: 1 },
  { feedSportId: 126, name: 'Universal', sportId: null, kind: 'unmapped' },
  { feedSportId: 127, name: 'Combat Sport', sportId: 'martial_arts', kind: 'variant', parentFeedSportId: 6 },

  // ── Variants (props / futures / college / esports) ─────────────────────
  {
    feedSportId: 24,
    name: 'Basketball Props',
    sportId: 'basketball',
    kind: 'variant',
    parentFeedSportId: 2,
  },
  {
    feedSportId: 25,
    name: 'Hockey Props',
    sportId: 'ice_hockey',
    kind: 'variant',
    parentFeedSportId: 4,
  },
  {
    feedSportId: 26,
    name: 'Baseball Props',
    sportId: 'baseball',
    kind: 'variant',
    parentFeedSportId: 1,
  },
  {
    feedSportId: 33,
    name: 'Football Futures',
    sportId: 'american_football',
    kind: 'variant',
    parentFeedSportId: 3,
  },
  {
    feedSportId: 36,
    name: 'Basketball Futures',
    sportId: 'basketball',
    kind: 'variant',
    parentFeedSportId: 2,
  },
  {
    feedSportId: 37,
    name: 'Baseball Futures',
    sportId: 'baseball',
    kind: 'variant',
    parentFeedSportId: 1,
  },
  {
    feedSportId: 52,
    name: 'Racing Futures',
    sportId: 'motorsport',
    kind: 'variant',
    parentFeedSportId: 9,
  },
  {
    feedSportId: 53,
    name: 'Golf Props',
    sportId: 'golf',
    kind: 'variant',
    parentFeedSportId: 7,
  },
  {
    feedSportId: 55,
    name: 'Soccer Futures',
    sportId: 'soccer',
    kind: 'variant',
    parentFeedSportId: 5,
  },
  {
    feedSportId: 60,
    name: 'Football Props',
    sportId: 'american_football',
    kind: 'variant',
    parentFeedSportId: 3,
  },
  {
    feedSportId: 63,
    name: 'Tennis Futures',
    sportId: 'tennis',
    kind: 'variant',
    parentFeedSportId: 8,
  },
  {
    feedSportId: 64,
    name: 'PROPS - NHL 40C',
    sportId: 'ice_hockey',
    kind: 'variant',
    parentFeedSportId: 4,
  },
  {
    feedSportId: 102,
    name: 'College Basketball',
    sportId: 'basketball',
    kind: 'variant',
    parentFeedSportId: 2,
  },
  {
    feedSportId: 111,
    name: 'CFL Football',
    sportId: 'american_football',
    kind: 'variant',
    parentFeedSportId: 3,
  },
  {
    feedSportId: 217,
    name: 'CFL Football',
    sportId: 'american_football',
    kind: 'variant',
    parentFeedSportId: 3,
  },
  {
    feedSportId: 121,
    name: 'LFA',
    sportId: 'american_football',
    kind: 'variant',
    parentFeedSportId: 3,
  },
  {
    feedSportId: 130,
    name: 'Nascar',
    sportId: 'motorsport',
    kind: 'variant',
    parentFeedSportId: 9,
  },
  {
    feedSportId: 131,
    name: 'Basketball 3x3',
    sportId: 'basketball',
    kind: 'variant',
    parentFeedSportId: 2,
  },
  {
    feedSportId: 132,
    name: 'esport-cs:go',
    sportId: 'sports_channels',
    kind: 'variant',
    parentFeedSportId: 114,
  },
  {
    feedSportId: 133,
    name: 'esport-fifa',
    sportId: 'sports_channels',
    kind: 'variant',
    parentFeedSportId: 114,
  },
  {
    feedSportId: 134,
    name: 'esport-dota',
    sportId: 'sports_channels',
    kind: 'variant',
    parentFeedSportId: 114,
  },
  // Dummy shells (keep listed so feed coverage = 100%)
  { feedSportId: 103, name: 'Rugby Union Dummy', sportId: 'rugby', kind: 'variant', parentFeedSportId: 92 },
  { feedSportId: 104, name: 'Rugby League Dummy', sportId: 'rugby', kind: 'variant', parentFeedSportId: 92 },
  { feedSportId: 128, name: 'Rugby League Dummy', sportId: 'rugby', kind: 'variant', parentFeedSportId: 92 },
  { feedSportId: 129, name: 'Rugby Union Dummy', sportId: 'rugby', kind: 'variant', parentFeedSportId: 92 },

  // ── Event shells (map to parent when clear) ────────────────────────────
  {
    feedSportId: 14,
    name: 'Olympics Soccer - Men',
    sportId: 'soccer',
    kind: 'event',
    parentFeedSportId: 5,
  },
  {
    feedSportId: 15,
    name: 'Olympics Soccer - Women',
    sportId: 'soccer',
    kind: 'event',
    parentFeedSportId: 5,
  },
  {
    feedSportId: 119,
    name: 'Liga MX',
    sportId: 'soccer',
    kind: 'event',
    parentFeedSportId: 5,
  },
  {
    feedSportId: 123,
    name: "FIFA Women's World Cup",
    sportId: 'soccer',
    kind: 'event',
    parentFeedSportId: 5,
  },
  {
    feedSportId: 264,
    name: "FIFA Women's World Cup",
    sportId: 'soccer',
    kind: 'event',
    parentFeedSportId: 5,
  },
  {
    feedSportId: 214,
    name: 'FIFA World Cup 2026',
    sportId: 'soccer',
    kind: 'event',
    parentFeedSportId: 5,
  },
  {
    feedSportId: 220,
    name: 'Top Soccer',
    sportId: 'soccer',
    kind: 'variant',
    parentFeedSportId: 5,
  },
  {
    feedSportId: 99,
    name: 'Super Bowl LVI',
    sportId: 'american_football',
    kind: 'event',
    parentFeedSportId: 3,
  },
  {
    feedSportId: 203,
    name: 'Super Bowl LX',
    sportId: 'american_football',
    kind: 'event',
    parentFeedSportId: 3,
  },
  {
    feedSportId: 109,
    name: 'Grey Cup',
    sportId: 'american_football',
    kind: 'event',
    parentFeedSportId: 3,
  },
  {
    feedSportId: 201,
    name: 'Grey Cup',
    sportId: 'american_football',
    kind: 'event',
    parentFeedSportId: 3,
  },
  {
    feedSportId: 112,
    name: 'IIHF World Championship',
    sportId: 'ice_hockey',
    kind: 'event',
    parentFeedSportId: 4,
  },
  {
    feedSportId: 216,
    name: 'IIHF World Championship',
    sportId: 'ice_hockey',
    kind: 'event',
    parentFeedSportId: 4,
  },
  {
    feedSportId: 202,
    name: 'Hockey World Juniors',
    sportId: 'ice_hockey',
    kind: 'event',
    parentFeedSportId: 4,
  },

  // ── Explicitly unmapped / specialty (do not invent SportId) ────────────
  { feedSportId: 11, name: 'Olympics', sportId: null, kind: 'unmapped' },
  { feedSportId: 16, name: 'Futures', sportId: null, kind: 'unmapped' },
  { feedSportId: 39, name: 'Entertainment', sportId: null, kind: 'unmapped' },
  { feedSportId: 96, name: 'Chess', sportId: null, kind: 'unmapped' },
  { feedSportId: 97, name: 'Kabaddi', sportId: null, kind: 'unmapped' },
  { feedSportId: 105, name: 'Politics', sportId: null, kind: 'unmapped' },
  { feedSportId: 106, name: 'Simulations', sportId: null, kind: 'unmapped' },
  { feedSportId: 115, name: 'Politics', sportId: null, kind: 'unmapped' },
] as const;

/** Index by feedSportId (first row wins if a id is listed twice). */
const byFeedId = new Map<number, PandoraFeedSport>();
for (const row of PANDORA_FEED_SPORTS) {
  if (!byFeedId.has(row.feedSportId)) {
    byFeedId.set(row.feedSportId, row);
  }
  if (row.sportId != null && !getSport(row.sportId)) {
    throw new Error(
      `pandora-feed-sports: invalid sportId ${row.sportId} for feed ${row.feedSportId}`
    );
  }
}

/** Proven constants (mainapp / board). */
export const FEED_SPORT = {
  baseball: 1,
  basketball: 2,
  american_football: 3,
  ice_hockey: 4,
  soccer: 5,
  fighting: 6,
  golf: 7,
  tennis: 8,
  motorsport: 9,
  horse_racing: 10,
  boxing: 13,
  mma: 27,
  handball: 86,
  cricket: 87,
  volleyball: 88,
  futsal: 89,
  bandy: 90,
  rugby: 92,
  table_tennis: 93,
  australian_rules: 94,
  badminton: 95,
  snooker: 98,
  darts: 118,
  cycling: 124,
  formula_1: 125,
  floorball: 135,
} as const;

export function getPandoraFeedSport(
  feedSportId: number | string
): PandoraFeedSport | undefined {
  const n = typeof feedSportId === 'number' ? feedSportId : Number(feedSportId);
  if (!Number.isFinite(n)) return undefined;
  return byFeedId.get(n);
}

/**
 * Resolve feed sport id → canonical SportId.
 * Variants/events map to parent sport when set.
 */
export function sportIdFromFeedSportId(
  feedSportId: number | string
): SportId | null {
  const row = getPandoraFeedSport(feedSportId);
  return row?.sportId ?? null;
}

export function feedSportName(feedSportId: number | string): string | null {
  return getPandoraFeedSport(feedSportId)?.name ?? null;
}

/** All feed ids that map to a given SportId (core + variants). */
export function feedSportIdsForSport(sportId: SportId): number[] {
  return [...byFeedId.values()]
    .filter(r => r.sportId === sportId)
    .map(r => r.feedSportId)
    .sort((a, b) => a - b);
}

export function listPandoraFeedSports(): readonly PandoraFeedSport[] {
  return [...byFeedId.values()].sort((a, b) => a.feedSportId - b.feedSportId);
}

export function listMappedFeedSports(): PandoraFeedSport[] {
  return listPandoraFeedSports().filter(r => r.sportId != null);
}

/**
 * Human slug for display when SportId missing (e.g. "padel", "chess").
 */
export function feedSportSlug(feedSportId: number | string): string | null {
  const row = getPandoraFeedSport(feedSportId);
  if (!row) return null;
  if (row.sportId) return row.sportId;
  return row.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
