/**
 * Live products / surfaces a skin can offer (plive, ezlive, ultra, mag).
 * Sport coverage bindings attach here — not to white-label skin ids.
 */

/** Coverage-capable live products. */
export const LIVE_PRODUCT_IDS = ['plive', 'ezlive', 'ultralive', 'maglive'] as const;
export type LiveProductId = (typeof LIVE_PRODUCT_IDS)[number];

export type LiveProductRecord = {
  id: LiveProductId;
  displayName: string;
  /** Catalog-style label (EZLive, UltraLive, …). */
  catalogName: string;
};

export const LIVE_PRODUCTS = [
  { id: 'plive', displayName: 'P-Live', catalogName: 'PLive' },
  { id: 'ezlive', displayName: 'EZ Live', catalogName: 'EZLive' },
  { id: 'ultralive', displayName: 'Ultra Live', catalogName: 'UltraLive' },
  { id: 'maglive', displayName: 'Mag Live', catalogName: 'MagLive' },
] as const satisfies readonly LiveProductRecord[];

/** Capacity-only legacy wire name — not a coverage owner. */
export const LEGACY_CAPACITY_LIVE_PRODUCTS = ['dark'] as const;
export type LegacyCapacityLiveProduct = (typeof LEGACY_CAPACITY_LIVE_PRODUCTS)[number];

const PRODUCT_SET = new Set<string>(LIVE_PRODUCT_IDS);
const LEGACY_SET = new Set<string>(LEGACY_CAPACITY_LIVE_PRODUCTS);
const byId = new Map<LiveProductId, (typeof LIVE_PRODUCTS)[number]>(
  LIVE_PRODUCTS.map(p => [p.id, p])
);

/** lowercase / compacted aliases → LiveProductId */
const PRODUCT_ALIASES: Record<string, LiveProductId> = {
  plive: 'plive',
  'p-live': 'plive',
  ezlive: 'ezlive',
  'ez-live': 'ezlive',
  ez: 'ezlive',
  ultralive: 'ultralive',
  ultra: 'ultralive',
  'ultra-live': 'ultralive',
  maglive: 'maglive',
  mag: 'maglive',
  'mag-live': 'maglive',
};

for (const p of LIVE_PRODUCTS) {
  PRODUCT_ALIASES[p.catalogName.toLowerCase()] = p.id;
  PRODUCT_ALIASES[p.displayName.toLowerCase().replace(/[\s_-]+/g, '')] = p.id;
}

export function isLiveProductId(value: string): value is LiveProductId {
  return PRODUCT_SET.has(value.trim().toLowerCase());
}

export function isLegacyCapacityLiveProduct(value: string): value is LegacyCapacityLiveProduct {
  return LEGACY_SET.has(value.trim().toLowerCase());
}

export function getLiveProduct(id: string): (typeof LIVE_PRODUCTS)[number] | undefined {
  const n = normalizeLiveProductName(id);
  return isLiveProductId(n) ? byId.get(n) : undefined;
}

/**
 * Normalize live-product / capacity wire names (`ultra` → `ultralive`, `EZLive` → `ezlive`).
 * Numeric wire skins (`"2"`) stay digit strings for getUltraLiveURL.
 */
export function normalizeLiveProductName(raw: string | number): string {
  if (typeof raw === 'number') return String(raw);
  const t = raw.trim();
  if (!t) return t;
  if (/^\d+$/.test(t)) return t;
  const lower = t.toLowerCase();
  const compact = lower.replace(/[\s_-]+/g, '');
  if (PRODUCT_ALIASES[lower]) return PRODUCT_ALIASES[lower];
  if (PRODUCT_ALIASES[compact]) return PRODUCT_ALIASES[compact];
  if (isLegacyCapacityLiveProduct(lower)) return lower;
  return lower;
}

export function liveProductOwnsCoverage(product: string): product is LiveProductId {
  return isLiveProductId(normalizeLiveProductName(product));
}

export function listLiveProducts(): readonly (typeof LIVE_PRODUCTS)[number][] {
  return LIVE_PRODUCTS;
}
