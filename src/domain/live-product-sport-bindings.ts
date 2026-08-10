/**
 * Per-live-product external sport bindings into the canonical sports matrix.
 *
 * plive + ezlive share the observed stream-list map until wire proves otherwise.
 * ultralive / maglive start empty (skin may offer product; coverage unproven).
 */

import type { SportId } from './sports.ts';
import { getSport } from './sports.ts';
import type { LiveProductId } from './live-products.ts';

export const BINDING_STATUSES = [
  'primary',
  'mapped',
  'inventory',
  'unsupported',
  'unknown',
] as const;
export type BindingStatus = (typeof BINDING_STATUSES)[number];

export type LiveProductSportBinding = {
  liveProduct: LiveProductId;
  sportId: SportId;
  inventoryBucket: string;
  /**
   * Pandora/Spandora feed id (`live.sports` / eventData `s/{id}`).
   * Prefer this over apiSportId for board work.
   */
  feedSportId: number | null;
  /**
   * Ultra / ticket sport id when proven (often = feed for TT=93).
   * @deprecated for feed lookups — use feedSportId
   */
  apiSportId: number | null;
  /** Shell sportOrder / sidebar id (plive HTML). Not the feed id. */
  widgetSportId: number | null;
  label: string;
  status: BindingStatus;
};

type BindingSeed = {
  sportId: SportId;
  inventoryBucket: string;
  feedSportId?: number | null;
  apiSportId?: number | null;
  widgetSportId?: number | null;
  label: string;
  status: BindingStatus;
};

/**
 * Buckeye plive/ezlive bindings.
 * feedSportId = Pandora board (live.sports). widgetSportId = shell sportOrder.
 * Do not put widget ids in feedSportId (legacy bug: tennis widget 2 ≠ feed 8).
 *
 * apiSportId = ticket / betGroups `componentBets[].sportId` when proven.
 * mainapp sportsService treats event.sportId as the **same number space** as
 * feed (isTennis→8, isSoccer→5|214|220|221, isTableTennis→93, isGolf→7,
 * isRacing→9, isFighting→6|13|27). TT betGroups capture has sportId=93.
 * Shell Top Soccer is feed 220 — **not** widget 220 (TT sidebar).
 */
const BUCKEYE_LIVE_BINDINGS: readonly BindingSeed[] = [
  {
    sportId: 'soccer',
    inventoryBucket: 'football',
    feedSportId: 5,
    /** mainapp isSoccer includes 5 (+ shells 214/220/221). */
    apiSportId: 5,
    widgetSportId: 1,
    label: 'Soccer',
    status: 'primary',
  },
  {
    sportId: 'tennis',
    inventoryBucket: 'tennis',
    feedSportId: 8,
    /** mainapp isTennis(e) ⇒ Number(e)===8 */
    apiSportId: 8,
    widgetSportId: 2,
    label: 'Tennis',
    status: 'primary',
  },
  {
    sportId: 'basketball',
    inventoryBucket: 'basketball',
    feedSportId: 2,
    widgetSportId: 4,
    label: 'Basketball',
    status: 'primary',
  },
  {
    sportId: 'table_tennis',
    inventoryBucket: 'table_tennis',
    feedSportId: 93,
    /** Ticket betGroups + mainapp isTableTennis. */
    apiSportId: 93,
    /** Shell sportOrder entry for TT (not live.sports[220] Top Soccer). */
    widgetSportId: 220,
    label: 'Table Tennis',
    status: 'primary',
  },
  {
    sportId: 'baseball',
    inventoryBucket: 'baseball',
    feedSportId: 1,
    label: 'Baseball',
    status: 'inventory',
  },
  {
    sportId: 'ice_hockey',
    inventoryBucket: 'ice_hockey',
    feedSportId: 4,
    label: 'Ice Hockey',
    status: 'inventory',
  },
  {
    sportId: 'american_football',
    inventoryBucket: 'american_football',
    feedSportId: 3,
    label: 'American Football',
    status: 'inventory',
  },
  {
    sportId: 'golf',
    inventoryBucket: 'golf',
    feedSportId: 7,
    /** mainapp isGolf(e) ⇒ Number(e)===7 */
    apiSportId: 7,
    label: 'Golf',
    status: 'inventory',
  },
  {
    sportId: 'cricket',
    inventoryBucket: 'cricket',
    feedSportId: 87,
    label: 'Cricket',
    status: 'inventory',
  },
  {
    sportId: 'volleyball',
    inventoryBucket: 'volleyball',
    feedSportId: 88,
    label: 'Volleyball',
    status: 'inventory',
  },
  {
    sportId: 'handball',
    inventoryBucket: 'handball',
    feedSportId: 86,
    label: 'Handball',
    status: 'inventory',
  },
  {
    sportId: 'bandy',
    inventoryBucket: 'bandy',
    feedSportId: 90,
    label: 'Bandy',
    status: 'inventory',
  },
  {
    sportId: 'snooker',
    inventoryBucket: 'snooker',
    feedSportId: 98,
    label: 'Snooker',
    status: 'inventory',
  },
  { sportId: 'billiards', inventoryBucket: 'billiards', label: 'Billiards', status: 'inventory' },
  {
    sportId: 'badminton',
    inventoryBucket: 'badminton',
    feedSportId: 95,
    label: 'Badminton',
    status: 'inventory',
  },
  {
    sportId: 'cycling',
    inventoryBucket: 'bicycle',
    feedSportId: 124,
    label: 'Cycling',
    status: 'inventory',
  },
  {
    sportId: 'boxing',
    inventoryBucket: 'boxing',
    feedSportId: 13,
    /** mainapp isFighting includes 13 */
    apiSportId: 13,
    label: 'Boxing',
    status: 'inventory',
  },
  {
    sportId: 'formula_1',
    inventoryBucket: 'formula_1',
    feedSportId: 125,
    label: 'Formula 1',
    status: 'inventory',
  },
  {
    sportId: 'rugby',
    inventoryBucket: 'rugby',
    feedSportId: 92,
    label: 'Rugby',
    status: 'inventory',
  },
  { sportId: 'hurling', inventoryBucket: 'hurling', label: 'Hurling', status: 'inventory' },
  {
    sportId: 'gaelic_football',
    inventoryBucket: 'gaelic_football',
    label: 'Gaelic Football',
    status: 'inventory',
  },
  {
    sportId: 'floorball',
    inventoryBucket: 'floorball',
    feedSportId: 135,
    label: 'Floorball',
    status: 'inventory',
  },
  {
    sportId: 'motorsport',
    inventoryBucket: 'motorsport',
    feedSportId: 9,
    /** mainapp isRacing(e) ⇒ Number(e)===9 */
    apiSportId: 9,
    label: 'Motorsport',
    status: 'inventory',
  },
  {
    sportId: 'australian_rules',
    inventoryBucket: 'australian_rules',
    feedSportId: 94,
    label: 'Australian Rules',
    status: 'inventory',
  },
  {
    sportId: 'darts',
    inventoryBucket: 'darts',
    feedSportId: 118,
    label: 'Darts',
    status: 'inventory',
  },
  {
    sportId: 'futsal',
    inventoryBucket: 'futsal',
    feedSportId: 89,
    label: 'Futsal',
    status: 'inventory',
  },
  {
    sportId: 'ufc',
    inventoryBucket: 'ufc',
    feedSportId: 27,
    /** mainapp isFighting includes 27 */
    apiSportId: 27,
    label: 'UFC',
    status: 'inventory',
  },
  {
    sportId: 'martial_arts',
    inventoryBucket: 'martial_arts',
    feedSportId: 6,
    /** mainapp isFighting includes 6 */
    apiSportId: 6,
    label: 'Martial Arts',
    status: 'inventory',
  },
  {
    sportId: 'horse_racing',
    inventoryBucket: 'horse_racing',
    feedSportId: 10,
    label: 'Horse Racing',
    status: 'inventory',
  },
  {
    sportId: 'sports_channels',
    inventoryBucket: 'sports_channels',
    feedSportId: 114,
    label: 'Sports Channels',
    status: 'inventory',
  },
];

function expand(
  liveProduct: LiveProductId,
  seeds: readonly BindingSeed[]
): LiveProductSportBinding[] {
  const out: LiveProductSportBinding[] = [];
  for (const s of seeds) {
    if (!getSport(s.sportId)) {
      throw new Error(`live-product-sport-bindings: unknown sportId ${s.sportId}`);
    }
    out.push({
      liveProduct,
      sportId: s.sportId,
      inventoryBucket: s.inventoryBucket,
      feedSportId: s.feedSportId ?? null,
      apiSportId: s.apiSportId ?? null,
      widgetSportId: s.widgetSportId ?? null,
      label: s.label,
      status: s.status,
    });
  }
  return out;
}

const PLIVE = expand('plive', BUCKEYE_LIVE_BINDINGS);
const EZLIVE = expand('ezlive', BUCKEYE_LIVE_BINDINGS);

export const LIVE_PRODUCT_SPORT_BINDINGS: readonly LiveProductSportBinding[] = [
  ...PLIVE,
  ...EZLIVE,
];

const byProduct = new Map<LiveProductId, LiveProductSportBinding[]>([
  ['plive', PLIVE],
  ['ezlive', EZLIVE],
  ['ultralive', []],
  ['maglive', []],
]);

export function listLiveProductSportBindings(
  liveProduct?: LiveProductId
): readonly LiveProductSportBinding[] {
  if (liveProduct) return byProduct.get(liveProduct) ?? [];
  return LIVE_PRODUCT_SPORT_BINDINGS;
}

export function liveProductHasSportCoverage(liveProduct: LiveProductId, sportId: SportId): boolean {
  const rows = byProduct.get(liveProduct) ?? [];
  return rows.some(
    r => r.sportId === sportId && r.status !== 'unsupported' && r.status !== 'unknown'
  );
}

export function liveProductsWithBindings(): LiveProductId[] {
  return (['plive', 'ezlive', 'ultralive', 'maglive'] as const).filter(
    p => (byProduct.get(p)?.length ?? 0) > 0
  );
}
