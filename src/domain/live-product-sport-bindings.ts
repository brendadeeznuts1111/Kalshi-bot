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
  streamBucket: string;
  apiSportId: number | null;
  widgetSportId: number | null;
  label: string;
  status: BindingStatus;
};

/** @deprecated alias — use LiveProductSportBinding */
export type SkinSportBinding = LiveProductSportBinding;

type BindingSeed = {
  sportId: SportId;
  streamBucket: string;
  apiSportId?: number | null;
  widgetSportId?: number | null;
  label: string;
  status: BindingStatus;
};

const BUCKEYE_LIVE_BINDINGS: readonly BindingSeed[] = [
  {
    sportId: 'soccer',
    streamBucket: 'football',
    apiSportId: 1,
    widgetSportId: 1,
    label: 'Soccer',
    status: 'primary',
  },
  {
    sportId: 'tennis',
    streamBucket: 'tennis',
    apiSportId: 2,
    widgetSportId: 2,
    label: 'Tennis',
    status: 'primary',
  },
  {
    sportId: 'basketball',
    streamBucket: 'basketball',
    apiSportId: 4,
    widgetSportId: 4,
    label: 'Basketball',
    status: 'primary',
  },
  {
    sportId: 'table_tennis',
    streamBucket: 'table_tennis',
    apiSportId: 93,
    widgetSportId: 220,
    label: 'Table Tennis',
    status: 'primary',
  },
  { sportId: 'ice_hockey', streamBucket: 'ice_hockey', label: 'Ice Hockey', status: 'inventory' },
  { sportId: 'volleyball', streamBucket: 'volleyball', label: 'Volleyball', status: 'inventory' },
  { sportId: 'handball', streamBucket: 'handball', label: 'Handball', status: 'inventory' },
  { sportId: 'baseball', streamBucket: 'baseball', label: 'Baseball', status: 'inventory' },
  { sportId: 'bandy', streamBucket: 'bandy', label: 'Bandy', status: 'inventory' },
  { sportId: 'snooker', streamBucket: 'snooker', label: 'Snooker', status: 'inventory' },
  { sportId: 'billiards', streamBucket: 'billiards', label: 'Billiards', status: 'inventory' },
  { sportId: 'badminton', streamBucket: 'badminton', label: 'Badminton', status: 'inventory' },
  { sportId: 'cricket', streamBucket: 'cricket', label: 'Cricket', status: 'inventory' },
  { sportId: 'golf', streamBucket: 'golf', label: 'Golf', status: 'inventory' },
  { sportId: 'cycling', streamBucket: 'bicycle', label: 'Cycling', status: 'inventory' },
  { sportId: 'boxing', streamBucket: 'boxing', label: 'Boxing', status: 'inventory' },
  { sportId: 'formula_1', streamBucket: 'formula_1', label: 'Formula 1', status: 'inventory' },
  { sportId: 'rugby', streamBucket: 'rugby', label: 'Rugby', status: 'inventory' },
  { sportId: 'hurling', streamBucket: 'hurling', label: 'Hurling', status: 'inventory' },
  {
    sportId: 'gaelic_football',
    streamBucket: 'gaelic_football',
    label: 'Gaelic Football',
    status: 'inventory',
  },
  { sportId: 'floorball', streamBucket: 'floorball', label: 'Floorball', status: 'inventory' },
  { sportId: 'motorsport', streamBucket: 'motorsport', label: 'Motorsport', status: 'inventory' },
  {
    sportId: 'american_football',
    streamBucket: 'american_football',
    label: 'American Football',
    status: 'inventory',
  },
  {
    sportId: 'australian_rules',
    streamBucket: 'australian_rules',
    label: 'Australian Rules',
    status: 'inventory',
  },
  { sportId: 'darts', streamBucket: 'darts', label: 'Darts', status: 'inventory' },
  { sportId: 'futsal', streamBucket: 'futsal', label: 'Futsal', status: 'inventory' },
  { sportId: 'ufc', streamBucket: 'ufc', label: 'UFC', status: 'inventory' },
  {
    sportId: 'martial_arts',
    streamBucket: 'martial_arts',
    label: 'Martial Arts',
    status: 'inventory',
  },
  {
    sportId: 'horse_racing',
    streamBucket: 'horse_racing',
    label: 'Horse Racing',
    status: 'inventory',
  },
  {
    sportId: 'sports_channels',
    streamBucket: 'sports_channels',
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
      streamBucket: s.streamBucket,
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
