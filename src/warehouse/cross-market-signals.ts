/**
 * Cross-market validation signals — compare Kalshi implied probs to
 * Polymarket / Pinnacle. Callers must supply parsed live venue probabilities.
 */
import type { CanonicalEventId, KalshiEventTicker } from "../institutions/event-store/brands.ts";
import { unbrand } from "../institutions/event-store/brands.ts";

export type CrossMarketOdds = {
  polymarketProb: number | null;
  pinnacleProb: number | null;
};

export type CrossMarketSignal = {
  eventId: CanonicalEventId;
  eventTicker: KalshiEventTicker | null;
  title: string;
  playerA: string;
  playerB: string;
  /** Kalshi mid for player A YES (cents). */
  kalshiMidCents: number;
  /** Implied from mid: midCents / 100. */
  kalshiProb: number;
  polymarketProb: number | null;
  pinnacleProb: number | null;
  /** Kalshi − Polymarket (probability points). 0 when Poly missing. */
  deviationPoly: number;
  /** Kalshi − Pinnacle (probability points). 0 when Pinny missing. */
  deviationPinny: number;
  /** Max |deviation| across available venues. */
  absDeviation: number;
};

export type WarehouseEventForSignal = {
  eventId: CanonicalEventId;
  eventTicker: KalshiEventTicker | null;
  title: string;
  playerA: string;
  playerB: string;
  /** Player A YES mid in cents — skip when null. */
  kalshiMidCents: number | null;
};

export const CROSS_MARKET_MIN_ABS_DEVIATION = 0.01;

/** Simple mid → probability (cents / 100). */
export function midToProb(midCents: number | null): number | null {
  if (midCents == null || midCents <= 0 || midCents >= 100) return null;
  return midCents / 100;
}

export type FetchCrossMarketOdds = (
  eventTickers: readonly string[],
) => Promise<Map<string, CrossMarketOdds>>;

export function buildCrossMarketSignals(
  events: readonly WarehouseEventForSignal[],
  oddsByTicker: Map<string, CrossMarketOdds>,
  options: { minAbsDeviation?: number } = {},
): CrossMarketSignal[] {
  const minAbs = options.minAbsDeviation ?? CROSS_MARKET_MIN_ABS_DEVIATION;
  const signals: CrossMarketSignal[] = [];

  for (const event of events) {
    const kalshiProb = midToProb(event.kalshiMidCents);
    if (kalshiProb == null || event.kalshiMidCents == null) continue;

    const tickerKey = event.eventTicker ? unbrand(event.eventTicker) : unbrand(event.eventId);
    const cross = oddsByTicker.get(tickerKey);
    const polyProb = cross?.polymarketProb ?? null;
    const pinnyProb = cross?.pinnacleProb ?? null;

    const deviationPoly = polyProb != null ? kalshiProb - polyProb : 0;
    const deviationPinny = pinnyProb != null ? kalshiProb - pinnyProb : 0;
    const absDeviation = Math.max(
      polyProb != null ? Math.abs(deviationPoly) : 0,
      pinnyProb != null ? Math.abs(deviationPinny) : 0,
    );

    if (absDeviation <= minAbs) continue;

    signals.push({
      eventId: event.eventId,
      eventTicker: event.eventTicker,
      title: event.title,
      playerA: event.playerA,
      playerB: event.playerB,
      kalshiMidCents: event.kalshiMidCents,
      kalshiProb,
      polymarketProb: polyProb,
      pinnacleProb: pinnyProb,
      deviationPoly,
      deviationPinny,
      absDeviation,
    });
  }

  return signals.sort((a, b) => b.absDeviation - a.absDeviation);
}

/** Largest signed deviation by absolute value (for display). */
export function primaryDeviation(signal: CrossMarketSignal): number {
  if (Math.abs(signal.deviationPoly) >= Math.abs(signal.deviationPinny)) {
    return signal.deviationPoly;
  }
  return signal.deviationPinny;
}

export function formatProbPct(prob: number | null, digits = 1): string {
  if (prob == null) return "—";
  return `${(prob * 100).toFixed(digits)}%`;
}

export function formatDeviationPct(deviation: number, digits = 1): string {
  const pct = deviation * 100;
  const body = `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%`;
  return body;
}
