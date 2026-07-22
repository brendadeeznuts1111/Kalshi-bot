import { sha3Hex } from "../evidence-chain.ts";
import { asCanonicalEventId, type CanonicalEventId } from "./types.ts";

export function mintKalshiEventId(eventTicker: string): CanonicalEventId {
  return asCanonicalEventId(sha3Hex(`kalshi|${eventTicker.trim()}`).slice(0, 32));
}

export function kalshiMarketId(ticker: string): string {
  return `kalshi:${ticker}`;
}

export function kalshiSourceRowHash(eventTicker: string): string {
  return sha3Hex(`kalshi-event|${eventTicker}`);
}
