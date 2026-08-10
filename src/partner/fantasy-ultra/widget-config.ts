/**
 * Fantasy402 Ultra / plive widget runtime config (from HTML source + stream-list-v2).
 *
 * Coverage SSOT is `src/domain/` (sports matrix + live-product bindings).
 * This module is a compatibility shim for existing Fantasy402 callers.
 *
 * Sport order is UI-only; API sport ids differ (table tennis widget 220 vs API 93).
 */

import {
  DEFAULT_COVERAGE_LIVE_PRODUCT,
  WIDGET_FAVORITES_SPORT_ID,
  listLiveProductSportBindings,
  resolveSport,
  type LiveProductSportBinding,
} from '../../domain/index.ts';

export { WIDGET_FAVORITES_SPORT_ID };

/** Left-sidebar sport order (widget-internal ids). */
export const WIDGET_SPORT_ORDER = [214, 1, 2, 4, 220] as const;

export const FANTASY_WIDGET_CONFIG = {
  oddsFormat: 'american' as const,
  roundUSOddsDown: true,
  oddsDecimalPlaces: 3,
  useCustomWebSocket: true,
  /** Default plive desk host. Public sportswidgets uses spandora (see pandora-hosts). */
  customWebSocketUrl: 'wss://pandora.ganchrow.com',
  /** Alternate public shell host (same LINE_SET / protocol). */
  spandoraWebSocketUrl: 'wss://spandora.ganchrow.com',
  playerUSEnabled: true,
  /** Soft limit: stream after wager within this window (seconds). */
  liveStreamLastWagerToleranceSec: 86_400,
  /** mainapp isTableTennis — feed sport id on eventData board. */
  feedSportTableTennis: 93,
} as const;

/**
 * Canonical sport key ↔ stream-list bucket ↔ API sportId (ticket) ↔ widget id.
 * Compatibility shape — sourced from domain live-product bindings (default: plive).
 */
export type FantasySportMapping = {
  canonical: string;
  streamBucket: string;
  /** Pandora feed id (eventData / live.sports). */
  feedSportId: number | null;
  apiSportId: number | null;
  widgetSportId: number | null;
  label: string;
  primary: boolean;
};

function bindingToMapping(b: LiveProductSportBinding): FantasySportMapping {
  return {
    canonical: b.sportId,
    streamBucket: b.inventoryBucket,
    feedSportId: b.feedSportId,
    apiSportId: b.apiSportId,
    widgetSportId: b.widgetSportId,
    label: b.label,
    primary: b.status === 'primary',
  };
}

/**
 * Full stream-list-v2 bucket map via domain plive bindings.
 * Prefer `resolveSport` / `listLiveProductSportBindings` for new code.
 */
export const FANTASY_SPORT_MAPPINGS: readonly FantasySportMapping[] =
  listLiveProductSportBindings(DEFAULT_COVERAGE_LIVE_PRODUCT).map(
    bindingToMapping,
  );

export function fantasySportByApiId(
  apiSportId: number,
): FantasySportMapping | undefined {
  const hit = resolveSport({
    liveProduct: DEFAULT_COVERAGE_LIVE_PRODUCT,
    apiSportId,
  });
  return hit ? bindingToMapping(hit.binding) : undefined;
}

/** Pandora feed sport id (preferred for board / eventData). */
export function fantasySportByFeedId(
  feedSportId: number,
): FantasySportMapping | undefined {
  const hit = resolveSport({
    liveProduct: DEFAULT_COVERAGE_LIVE_PRODUCT,
    feedSportId,
  });
  return hit ? bindingToMapping(hit.binding) : undefined;
}

export function fantasySportByWidgetId(
  widgetSportId: number,
): FantasySportMapping | undefined {
  const hit = resolveSport({
    liveProduct: DEFAULT_COVERAGE_LIVE_PRODUCT,
    widgetSportId,
  });
  return hit ? bindingToMapping(hit.binding) : undefined;
}

export function fantasySportByCanonical(
  canonical: string,
): FantasySportMapping | undefined {
  const hit = resolveSport({
    liveProduct: DEFAULT_COVERAGE_LIVE_PRODUCT,
    canonical,
  });
  return hit ? bindingToMapping(hit.binding) : undefined;
}

export function fantasySportByStreamBucket(
  bucket: string,
): FantasySportMapping | undefined {
  const hit = resolveSport({
    liveProduct: DEFAULT_COVERAGE_LIVE_PRODUCT,
    inventoryBucket: bucket,
  });
  return hit ? bindingToMapping(hit.binding) : undefined;
}

export function primaryFantasySports(): FantasySportMapping[] {
  return FANTASY_SPORT_MAPPINGS.filter((m) => m.primary);
}

export function mappedStreamBuckets(): string[] {
  return FANTASY_SPORT_MAPPINGS.map((m) => m.streamBucket);
}
