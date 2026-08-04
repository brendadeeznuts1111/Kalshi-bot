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

export type PartnerLiveUrlSet = {
  desktop: string;
  mobile: string;
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
