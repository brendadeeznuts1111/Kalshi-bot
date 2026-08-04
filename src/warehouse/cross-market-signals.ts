/**
 * Cross-market signal types for warehouse CLI (offline types only).
 */
import type { CanonicalEventId, KalshiEventTicker } from "../institutions/event-store/brands.ts";

export type CrossMarketOdds = {
  polymarketProb: number | null;
  pinnacleProb: number | null;
};

export type WarehouseEventForSignal = {
  eventId: CanonicalEventId;
  eventTicker: KalshiEventTicker | null;
  title: string;
  playerA: string;
  playerB: string;
  kalshiMidCents: number | null;
};
