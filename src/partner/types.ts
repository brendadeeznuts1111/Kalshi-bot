/**
 * Partner order adapter surface — Kalshi-bot side.
 *
 * Fantasy Ultra (PPH) implements this for login + live catalog today.
 * Place/limits stay stubbed until the bookmaker bet wire is mapped.
 */

export type PartnerId = "fantasy402" | "kalshi" | (string & {});

export type PartnerAccountStatus = "active" | "inactive" | "pending";

export type PartnerLimits = {
  maxStake: number;
  maxWin: number;
  currency?: string;
  note?: string;
};

export type PartnerOrder = {
  eventId: string;
  marketId?: string;
  side: "home" | "away" | "yes" | "no" | string;
  stake: number;
  price?: number;
  currency?: string;
  dryRun?: boolean;
};

export type PartnerExecutionResult = {
  success: boolean;
  transactionId?: string;
  remainingBalance?: number;
  dryRun?: boolean;
  error?: string;
  raw?: unknown;
};

/** Normalized live-coverage row (stream catalog — not price odds). */
export type PartnerLiveEvent = {
  partner: PartnerId;
  sport: string;
  league: string;
  eventId: string;
  home: string | null;
  away: string | null;
  streamId: number | null;
  feedId: number | null;
  donbestId: string | null;
};

/**
 * Statscore booked-events row (livescorepro product).
 * Metadata + bet_status only — **no American prices** on this product.
 */
export type PartnerBookedEvent = {
  partner: PartnerId;
  /** Statscore internal id */
  statscoreId: number;
  /** Widget / client event id (query client_event_id) */
  clientEventId: string;
  name: string;
  sportName: string;
  sportId: number | null;
  competition: string | null;
  startDate: string | null;
  statusName: string | null;
  statusType: string | null;
  /** e.g. suspended | active — coverage bet flag, not a price */
  betStatus: string | null;
  relationStatus: string | null;
};

/** Priced market row — only when a real odds wire is mapped (not Statscore livescorepro). */
export type PartnerMarket = {
  partner: PartnerId;
  ticker: string;
  name: string;
  eventClientId: string;
  marketId: string;
  homePrice: number | null;
  awayPrice: number | null;
  label: string;
  limits: PartnerLimits;
  source: string;
};

export type PartnerLiveUrlSet = {
  desktop: string;
  mobile: string;
};

/** Fantasy Get_SportsLeagues row (normalized). */
export type PartnerSportLeague = {
  sportType: string;
  sportSubType: string | null;
  display: string;
  sequence: number;
  active: boolean;
  periodDescription: string | null;
};

export interface PartnerOrderAdapter {
  readonly partnerId: PartnerId;
  /** Authenticate / refresh live session material. */
  login(): Promise<PartnerLiveUrlSet | void>;
  /** Live event catalog (coverage), not necessarily a betting book. */
  fetchEvents(options?: { sport?: string }): Promise<PartnerLiveEvent[]>;
  fetchLimits(eventId: string): Promise<PartnerLimits>;
  placeOrder(order: PartnerOrder): Promise<PartnerExecutionResult>;
}

/**
 * Extended Fantasy session surface (optional on other partners).
 * Network-capture blueprint: login → warm widget → leagues → stream → renew.
 */
export interface FantasySessionAdapter extends PartnerOrderAdapter {
  renewToken(): Promise<string>;
  warmSession(): Promise<void>;
  fetchSports(): Promise<PartnerSportLeague[]>;
  getBearerToken(): string;
  getLiveUrls(): PartnerLiveUrlSet | null;
  /** Statscore livescore booking metadata by client_event_id */
  fetchBookedEvent(clientEventId: string): Promise<PartnerBookedEvent | null>;
  /** List booked events (optional sport filter on sport_name) */
  listBookedEvents(options?: {
    sport?: string;
    limit?: number;
  }): Promise<PartnerBookedEvent[]>;
}
