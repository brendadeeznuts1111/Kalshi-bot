/**
 * Fantasy402 Ultra / plive widget runtime config (from HTML source + stream-list-v2).
 *
 * Sport order is UI-only; API sport ids differ (table tennis widget 220 vs API 93).
 * Stream-list exposes ~30 buckets; only a subset have confirmed API/widget ids.
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
 * Canonical sport key ↔ stream-list bucket ↔ API sportId (ticket) ↔ widget id.
 * `apiSportId` / `widgetSportId` null until confirmed on wire (Get_SportsLeagues / ticket / HTML).
 */
export type FantasySportMapping = {
  canonical: string;
  /** stream-list-v2 sports bucket key */
  streamBucket: string;
  /** API / ticket sportId (e.g. componentBets.sportId); null if unknown */
  apiSportId: number | null;
  /** Widget sportOrder id; null if not in sidebar map */
  widgetSportId: number | null;
  label: string;
  /**
   * true = primary desk sports (mapped with full ids, default sync targets).
   * false = coverage inventory only until API id confirmed.
   */
  primary: boolean;
};

function row(
  streamBucket: string,
  label: string,
  opts: {
    canonical?: string;
    apiSportId?: number | null;
    widgetSportId?: number | null;
    primary?: boolean;
  } = {},
): FantasySportMapping {
  return {
    canonical: opts.canonical ?? streamBucket,
    streamBucket,
    apiSportId: opts.apiSportId ?? null,
    widgetSportId: opts.widgetSportId ?? null,
    label,
    primary: opts.primary ?? false,
  };
}

/**
 * Full stream-list-v2 bucket map (observed 2026-08).
 * Confirmed ticket/widget ids only for soccer/tennis/basketball/table_tennis.
 */
export const FANTASY_SPORT_MAPPINGS: readonly FantasySportMapping[] = [
  // Primary desk sports (confirmed ids)
  row("football", "Soccer", {
    canonical: "soccer",
    apiSportId: 1,
    widgetSportId: 1,
    primary: true,
  }),
  row("tennis", "Tennis", {
    apiSportId: 2,
    widgetSportId: 2,
    primary: true,
  }),
  row("basketball", "Basketball", {
    apiSportId: 4,
    widgetSportId: 4,
    primary: true,
  }),
  row("table_tennis", "Table Tennis", {
    apiSportId: 93,
    widgetSportId: 220,
    primary: true,
  }),
  // Full stream-list inventory (api/widget ids TBD)
  row("ice_hockey", "Ice Hockey"),
  row("volleyball", "Volleyball"),
  row("handball", "Handball"),
  row("baseball", "Baseball"),
  row("bandy", "Bandy"),
  row("snooker", "Snooker"),
  row("billiards", "Billiards"),
  row("badminton", "Badminton"),
  row("cricket", "Cricket"),
  row("golf", "Golf"),
  row("bicycle", "Cycling", { canonical: "cycling" }),
  row("boxing", "Boxing"),
  row("formula_1", "Formula 1"),
  row("rugby", "Rugby"),
  row("hurling", "Hurling"),
  row("gaelic_football", "Gaelic Football"),
  row("floorball", "Floorball"),
  row("motorsport", "Motorsport"),
  row("american_football", "American Football"),
  row("australian_rules", "Australian Rules"),
  row("darts", "Darts"),
  row("futsal", "Futsal"),
  row("ufc", "UFC"),
  row("martial_arts", "Martial Arts"),
  row("horse_racing", "Horse Racing"),
  row("sports_channels", "Sports Channels"),
] as const;

/** Favorites is UI-only virtual sport in sportOrder. */
export const WIDGET_FAVORITES_SPORT_ID = 214;

const byApi = new Map(
  FANTASY_SPORT_MAPPINGS.filter((m) => m.apiSportId != null).map((m) => [
    m.apiSportId!,
    m,
  ]),
);
const byWidget = new Map(
  FANTASY_SPORT_MAPPINGS.filter((m) => m.widgetSportId != null).map((m) => [
    m.widgetSportId!,
    m,
  ]),
);
const byCanonical = new Map(
  FANTASY_SPORT_MAPPINGS.map((m) => [m.canonical, m]),
);
const byStream = new Map(
  FANTASY_SPORT_MAPPINGS.map((m) => [m.streamBucket, m]),
);

export function fantasySportByApiId(
  apiSportId: number,
): FantasySportMapping | undefined {
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

/** Primary desk sports (confirmed API + widget ids). */
export function primaryFantasySports(): FantasySportMapping[] {
  return FANTASY_SPORT_MAPPINGS.filter((m) => m.primary);
}

/** All stream buckets we know about from the static map. */
export function mappedStreamBuckets(): string[] {
  return FANTASY_SPORT_MAPPINGS.map((m) => m.streamBucket);
}
