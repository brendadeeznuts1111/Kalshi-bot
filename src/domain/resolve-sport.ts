/**
 * Resolve external live-product sport identifiers → canonical SportId + binding.
 *
 * Lookup priority:
 *   1. feedSportId (Pandora eventData / live.sports) — preferred for board
 *   2. apiSportId (ticket, when set — TT=93)
 *   3. widgetSportId (shell sportOrder)
 *   4. inventoryBucket (stream-list)
 *   5. canonical SportId
 */

import { getSport, type SportId } from './sports.ts';
import { isLiveProductId, normalizeLiveProductName, type LiveProductId } from './live-products.ts';
import {
  listLiveProductSportBindings,
  type LiveProductSportBinding,
} from './live-product-sport-bindings.ts';
import {
  getPandoraFeedSport,
  sportIdFromFeedSportId,
} from './pandora-feed-sports.ts';

/** Favorites is UI-only virtual sport in widget sportOrder (not feed 214). */
export const WIDGET_FAVORITES_SPORT_ID = 214;

export type ResolveSportQuery = {
  /** Live product that owns the binding (plive / ezlive / …). */
  liveProduct: string;
  inventoryBucket?: string;
  /** Pandora/Spandora feed id (eventData path / live.sports). */
  feedSportId?: number;
  /**
   * Ultra ticket sport id when known.
   * Prefer feedSportId for board. apiSportId still works for TT=93.
   */
  apiSportId?: number;
  widgetSportId?: number;
  canonical?: string;
};

export type ResolvedSport = {
  sportId: SportId;
  binding: LiveProductSportBinding;
  liveProduct: LiveProductId;
  /** How the match was made. */
  via:
    | 'feedSportId'
    | 'apiSportId'
    | 'widgetSportId'
    | 'inventoryBucket'
    | 'canonical'
    | 'feed_catalog_only';
};

function asLiveProduct(raw: string): LiveProductId | undefined {
  const n = normalizeLiveProductName(raw);
  return isLiveProductId(n) ? n : undefined;
}

function syntheticBinding(
  liveProduct: LiveProductId,
  sportId: SportId,
  feedSportId: number | null
): LiveProductSportBinding {
  const feed = feedSportId != null ? getPandoraFeedSport(feedSportId) : undefined;
  return {
    liveProduct,
    sportId,
    inventoryBucket: sportId,
    feedSportId,
    apiSportId: null,
    widgetSportId: null,
    label: feed?.name ?? sportId,
    status: 'mapped',
  };
}

export function resolveSport(query: ResolveSportQuery): ResolvedSport | undefined {
  const liveProduct = asLiveProduct(query.liveProduct);
  if (!liveProduct) return undefined;

  const rows = listLiveProductSportBindings(liveProduct);

  if (query.widgetSportId === WIDGET_FAVORITES_SPORT_ID) return undefined;

  // 1. Feed sport id (board SSOT)
  if (query.feedSportId != null) {
    const hit = rows.find(r => r.feedSportId === query.feedSportId);
    if (hit) {
      return { sportId: hit.sportId, binding: hit, liveProduct, via: 'feedSportId' };
    }
    // Fall back to feed catalog even without a product binding row
    const sid = sportIdFromFeedSportId(query.feedSportId);
    if (sid) {
      const byCanonical = rows.find(r => r.sportId === sid);
      if (byCanonical) {
        return {
          sportId: sid,
          binding: byCanonical,
          liveProduct,
          via: 'feedSportId',
        };
      }
      return {
        sportId: sid,
        binding: syntheticBinding(liveProduct, sid, query.feedSportId),
        liveProduct,
        via: 'feed_catalog_only',
      };
    }
  }

  // 2. Ticket apiSportId (when set)
  if (query.apiSportId != null) {
    const hit = rows.find(r => r.apiSportId === query.apiSportId);
    if (hit) {
      return { sportId: hit.sportId, binding: hit, liveProduct, via: 'apiSportId' };
    }
    // Legacy callers passed feed ids as apiSportId — try feed plane
    const asFeed = sportIdFromFeedSportId(query.apiSportId);
    if (asFeed) {
      const hitFeed = rows.find(r => r.sportId === asFeed);
      if (hitFeed) {
        return {
          sportId: asFeed,
          binding: hitFeed,
          liveProduct,
          via: 'feedSportId',
        };
      }
    }
  }

  // 3. Widget sportOrder id
  if (query.widgetSportId != null) {
    const hit = rows.find(r => r.widgetSportId === query.widgetSportId);
    if (hit) {
      return {
        sportId: hit.sportId,
        binding: hit,
        liveProduct,
        via: 'widgetSportId',
      };
    }
  }

  // 4. Inventory bucket
  if (query.inventoryBucket != null) {
    const bucket = query.inventoryBucket.trim().toLowerCase();
    const hit = rows.find(r => r.inventoryBucket === bucket);
    if (hit) {
      return {
        sportId: hit.sportId,
        binding: hit,
        liveProduct,
        via: 'inventoryBucket',
      };
    }
  }

  // 5. Canonical
  if (query.canonical != null) {
    const id = query.canonical.trim().toLowerCase();
    if (!getSport(id)) return undefined;
    const hit = rows.find(r => r.sportId === id);
    if (hit) {
      return {
        sportId: hit.sportId,
        binding: hit,
        liveProduct,
        via: 'canonical',
      };
    }
  }

  return undefined;
}

/** Default live product for Fantasy402/Buckeye compatibility lookups. */
export const DEFAULT_COVERAGE_LIVE_PRODUCT: LiveProductId = 'plive';
