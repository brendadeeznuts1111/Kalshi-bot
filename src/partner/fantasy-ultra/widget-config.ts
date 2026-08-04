/**
 * Fantasy402 Ultra / plive widget runtime config (from HTML source).
 * Sport order is UI-only; API sport ids differ (table tennis widget 220 vs API 93).
 */

/** Left-sidebar sport order (widget-internal ids). */
export const WIDGET_SPORT_ORDER = [214, 1, 2, 4, 220] as const;

export const FANTASY_WIDGET_CONFIG = {
  oddsFormat: "american" as const,
  roundUSOddsDown: true,
  oddsDecimalPlaces: 3,
  useCustomWebSocket: true,
  customWebSocketUrl: "wss://pandora.ganchrow.com",
  playerUSEnabled: true,
  /** Soft limit: stream after wager within this window (seconds). */
  liveStreamLastWagerToleranceSec: 86_400,
} as const;

/**
 * Canonical sport key ↔ provider API sportId (Get_SportsLeagues / bet ticket)
 * ↔ widget sport id (sportOrder / sidebar).
 */
export type FantasySportMapping = {
  canonical: string;
  /** stream-list-v2 sports bucket key */
  streamBucket: string;
  /** API / ticket sportId (e.g. componentBets.sportId) */
  apiSportId: number;
  /** Widget sportOrder id */
  widgetSportId: number | null;
  label: string;
};

export const FANTASY_SPORT_MAPPINGS: readonly FantasySportMapping[] = [
  {
    canonical: "soccer",
    streamBucket: "football",
    apiSportId: 1,
    widgetSportId: 1,
    label: "Soccer",
  },
  {
    canonical: "tennis",
    streamBucket: "tennis",
    apiSportId: 2,
    widgetSportId: 2,
    label: "Tennis",
  },
  {
    canonical: "basketball",
    streamBucket: "basketball",
    apiSportId: 4,
    widgetSportId: 4,
    label: "Basketball",
  },
  {
    canonical: "table_tennis",
    streamBucket: "table_tennis",
    apiSportId: 93,
    widgetSportId: 220,
    label: "Table Tennis",
  },
] as const;

/** Favorites is UI-only virtual sport in sportOrder. */
export const WIDGET_FAVORITES_SPORT_ID = 214;

const byApi = new Map(FANTASY_SPORT_MAPPINGS.map((m) => [m.apiSportId, m]));
const byWidget = new Map(
  FANTASY_SPORT_MAPPINGS.filter((m) => m.widgetSportId != null).map((m) => [
    m.widgetSportId!,
    m,
  ]),
);
const byCanonical = new Map(FANTASY_SPORT_MAPPINGS.map((m) => [m.canonical, m]));
const byStream = new Map(FANTASY_SPORT_MAPPINGS.map((m) => [m.streamBucket, m]));

export function fantasySportByApiId(apiSportId: number): FantasySportMapping | undefined {
  return byApi.get(apiSportId);
}

export function fantasySportByWidgetId(
  widgetSportId: number,
): FantasySportMapping | undefined {
  if (widgetSportId === WIDGET_FAVORITES_SPORT_ID) return undefined;
  return byWidget.get(widgetSportId);
}

export function fantasySportByCanonical(
  canonical: string,
): FantasySportMapping | undefined {
  return byCanonical.get(canonical.trim().toLowerCase());
}

export function fantasySportByStreamBucket(
  bucket: string,
): FantasySportMapping | undefined {
  return byStream.get(bucket.trim().toLowerCase());
}
