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
  apiSportId: number | null;
  widgetSportId: number | null;
  label: string;
  status: BindingStatus;
};

/** @deprecated alias — use LiveProductSportBinding */
export type SkinSportBinding = LiveProductSportBinding;

type BindingSeed = {
  sportId: SportId;
  inventoryBucket: string;
  apiSportId?: number | null;
  widgetSportId?: number | null;
  label: string;
  status: BindingStatus;
};

const BUCKEYE_LIVE_BINDINGS: readonly BindingSeed[] = [
  {
    sportId: 'soccer',
    inventoryBucket: 'football',
    apiSportId: 1,
    widgetSportId: 1,
    label: 'Soccer',
    status: 'primary',
  },
  {
    sportId: 'tennis',
    inventoryBucket: 'tennis',
    apiSportId: 2,
    widgetSportId: 2,
    label: 'Tennis',
    status: 'primary',
  },
  {
    sportId: 'basketball',
    inventoryBucket: 'basketball',
    apiSportId: 4,
    widgetSportId: 4,
    label: 'Basketball',
    status: 'primary',
  },
  {
    sportId: 'table_tennis',
    inventoryBucket: 'table_tennis',
    apiSportId: 93,
    widgetSportId: 220,
    label: 'Table Tennis',
    status: 'primary',
  },
  { sportId: 'ice_hockey', inventoryBucket: 'ice_hockey', label: 'Ice Hockey', status: 'inventory' },
  { sportId: 'volleyball', inventoryBucket: 'volleyball', label: 'Volleyball', status: 'inventory' },
  { sportId: 'handball', inventoryBucket: 'handball', label: 'Handball', status: 'inventory' },
  { sportId: 'baseball', inventoryBucket: 'baseball', label: 'Baseball', status: 'inventory' },
  { sportId: 'bandy', inventoryBucket: 'bandy', label: 'Bandy', status: 'inventory' },
  { sportId: 'snooker', inventoryBucket: 'snooker', label: 'Snooker', status: 'inventory' },
  { sportId: 'billiards', inventoryBucket: 'billiards', label: 'Billiards', status: 'inventory' },
  { sportId: 'badminton', inventoryBucket: 'badminton', label: 'Badminton', status: 'inventory' },
  { sportId: 'cricket', inventoryBucket: 'cricket', label: 'Cricket', status: 'inventory' },
  { sportId: 'golf', inventoryBucket: 'golf', label: 'Golf', status: 'inventory' },
  { sportId: 'cycling', inventoryBucket: 'bicycle', label: 'Cycling', status: 'inventory' },
  { sportId: 'boxing', inventoryBucket: 'boxing', label: 'Boxing', status: 'inventory' },
  { sportId: 'formula_1', inventoryBucket: 'formula_1', label: 'Formula 1', status: 'inventory' },
  { sportId: 'rugby', inventoryBucket: 'rugby', label: 'Rugby', status: 'inventory' },
  { sportId: 'hurling', inventoryBucket: 'hurling', label: 'Hurling', status: 'inventory' },
  {
    sportId: 'gaelic_football',
    inventoryBucket: 'gaelic_football',
    label: 'Gaelic Football',
    status: 'inventory',
  },
  { sportId: 'floorball', inventoryBucket: 'floorball', label: 'Floorball', status: 'inventory' },
  { sportId: 'motorsport', inventoryBucket: 'motorsport', label: 'Motorsport', status: 'inventory' },
  {
    sportId: 'american_football',
    inventoryBucket: 'american_football',
    label: 'American Football',
    status: 'inventory',
  },
  {
    sportId: 'australian_rules',
    inventoryBucket: 'australian_rules',
    label: 'Australian Rules',
    status: 'inventory',
  },
  { sportId: 'darts', inventoryBucket: 'darts', label: 'Darts', status: 'inventory' },
  { sportId: 'futsal', inventoryBucket: 'futsal', label: 'Futsal', status: 'inventory' },
  { sportId: 'ufc', inventoryBucket: 'ufc', label: 'UFC', status: 'inventory' },
  {
    sportId: 'martial_arts',
    inventoryBucket: 'martial_arts',
    label: 'Martial Arts',
    status: 'inventory',
  },
  {
    sportId: 'horse_racing',
    inventoryBucket: 'horse_racing',
    label: 'Horse Racing',
    status: 'inventory',
  },
  {
    sportId: 'sports_channels',
    inventoryBucket: 'sports_channels',
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

/** @deprecated use LIVE_PRODUCT_SPORT_BINDINGS */
export const SKIN_SPORT_BINDINGS = LIVE_PRODUCT_SPORT_BINDINGS;

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

/** @deprecated use listLiveProductSportBindings */
export function listSkinSportBindings(
  liveProduct?: LiveProductId
): readonly LiveProductSportBinding[] {
  return listLiveProductSportBindings(liveProduct);
}

export function liveProductHasSportCoverage(liveProduct: LiveProductId, sportId: SportId): boolean {
  const rows = byProduct.get(liveProduct) ?? [];
  return rows.some(
    r => r.sportId === sportId && r.status !== 'unsupported' && r.status !== 'unknown'
  );
}

/** @deprecated use liveProductHasSportCoverage */
export function skinHasSportCoverage(liveProduct: LiveProductId, sportId: SportId): boolean {
  return liveProductHasSportCoverage(liveProduct, sportId);
}

export function liveProductsWithBindings(): LiveProductId[] {
  return (['plive', 'ezlive', 'ultralive', 'maglive'] as const).filter(
    p => (byProduct.get(p)?.length ?? 0) > 0
  );
}

/** @deprecated use liveProductsWithBindings */
export function skinsWithBindings(): LiveProductId[] {
  return liveProductsWithBindings();
}
