/**
 * Resolve external live-product sport identifiers → canonical SportId + binding.
 */

import { getSport, type SportId } from './sports.ts';
import { isLiveProductId, normalizeLiveProductName, type LiveProductId } from './live-products.ts';
import {
  listLiveProductSportBindings,
  type LiveProductSportBinding,
} from './live-product-sport-bindings.ts';

/** Favorites is UI-only virtual sport in widget sportOrder. */
export const WIDGET_FAVORITES_SPORT_ID = 214;

export type ResolveSportQuery = {
  /** Live product that owns the binding (plive / ezlive / …). */
  liveProduct: string;
  /** @deprecated use liveProduct */
  skin?: string;
  streamBucket?: string;
  apiSportId?: number;
  widgetSportId?: number;
  canonical?: string;
};

export type ResolvedSport = {
  sportId: SportId;
  binding: LiveProductSportBinding;
  liveProduct: LiveProductId;
};

function asLiveProduct(raw: string): LiveProductId | undefined {
  const n = normalizeLiveProductName(raw);
  return isLiveProductId(n) ? n : undefined;
}

export function resolveSport(query: ResolveSportQuery): ResolvedSport | undefined {
  const liveProduct = asLiveProduct(query.liveProduct ?? query.skin ?? '');
  if (!liveProduct) return undefined;

  const rows = listLiveProductSportBindings(liveProduct);
  if (rows.length === 0) return undefined;

  if (query.widgetSportId === WIDGET_FAVORITES_SPORT_ID) return undefined;

  if (query.apiSportId != null) {
    const hit = rows.find(r => r.apiSportId === query.apiSportId);
    if (hit) return { sportId: hit.sportId, binding: hit, liveProduct };
  }

  if (query.widgetSportId != null) {
    const hit = rows.find(r => r.widgetSportId === query.widgetSportId);
    if (hit) return { sportId: hit.sportId, binding: hit, liveProduct };
  }

  if (query.streamBucket != null) {
    const bucket = query.streamBucket.trim().toLowerCase();
    const hit = rows.find(r => r.streamBucket === bucket);
    if (hit) return { sportId: hit.sportId, binding: hit, liveProduct };
  }

  if (query.canonical != null) {
    const id = query.canonical.trim().toLowerCase();
    if (!getSport(id)) return undefined;
    const hit = rows.find(r => r.sportId === id);
    if (hit) return { sportId: hit.sportId, binding: hit, liveProduct };
  }

  return undefined;
}

/** Default live product for Fantasy402/Buckeye compatibility lookups. */
export const DEFAULT_COVERAGE_LIVE_PRODUCT: LiveProductId = 'plive';

/** @deprecated use DEFAULT_COVERAGE_LIVE_PRODUCT */
export const DEFAULT_COVERAGE_SKIN = DEFAULT_COVERAGE_LIVE_PRODUCT;
