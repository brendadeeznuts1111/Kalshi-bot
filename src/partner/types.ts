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

/**
 * Order intent for Ultra / bet-factory style tickets.
 * Field names align with captured componentBets (eventId, marketId, key, periodId).
 */
export type PartnerOrder = {
  /** Widget / book event id (e.g. 196878741) */
  eventId: string;
  /** Market id string (e.g. "3") */
  marketId?: string;
  /** Selection key (e.g. "2" for away/side) */
  key?: string;
  subKey?: string;
  /** Period id (e.g. "m" match) */
  periodId?: string;
  side: "home" | "away" | "yes" | "no" | string;
  /** Stake / risk amount in account currency */
  stake: number;
  /**
   * Decimal odds when known (e.g. 1.892… from finalOdds).
   * Not American; convert at boundary if UI shows +117.
   */
  price?: number;
  currency?: string;
  dryRun?: boolean;
  sportId?: number;
  leagueId?: number;
  team1?: string;
  team2?: string;
};

export type PartnerExecutionResult = {
  success: boolean;
  transactionId?: string;
  ticketNumber?: string;
  betGroupId?: number;
  betId?: number;
  /** Decimal odds accepted */
  finalOdds?: number;
  risk?: number;
  toWin?: number;
  currency?: string;
  remainingBalance?: number;
  dryRun?: boolean;
  error?: string;
  /** e from wire (0 = ok) */
  wireErrorCode?: number;
  raw?: unknown;
};

/** One leg from componentBets[] */
export type PartnerComponentBet = {
  betId: number;
  sequenceNumber: number;
  sportId: number | null;
  leagueId: number | null;
  leagueName: string | null;
  eventId: string;
  marketId: string | null;
  periodId: string | null;
  key: string | null;
  subKey: string | null;
  team1: string | null;
  team2: string | null;
  finalOdds: number | null;
  canCashout: boolean;
  state: number | null;
};

/** Accepted / open bet group (betGroups[] row) */
export type PartnerBetGroup = {
  betGroupId: number;
  ticketNumber: string;
  finalOdds: number | null;
  risk: number;
  toWin: number;
  currency: string | null;
  betType: number | null;
  /** Wire settlement marker; 0 = open / not decided */
  result: number | null;
  state: number | null;
  /** 0/1 when book marks win; null when unknown */
  isWin: number | null;
  acceptTime: number | null;
  delay: number | null;
  legs: PartnerComponentBet[];
};

/** Normalized live-coverage row (stream catalog — not price odds). */
export type PartnerLiveEvent = {
  partner: PartnerId;
  sport: string;
  league: string;
  /** Interior inventory key (from wire `stream_id`). Not odds/ticket eventId. */
  inventoryId: string;
  home: string | null;
  away: string | null;
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
