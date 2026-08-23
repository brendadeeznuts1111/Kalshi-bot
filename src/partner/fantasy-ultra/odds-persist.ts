/**
 * Fantasy402 → odds_ticks capture bridge.
 *
 * Maps the Pandora coefficient book (PartnerMarket rows: American prices
 * under an oddsEventId) into the odds_ticks live-odds contract consumed by
 * the massey edge-flags pipeline (event_id = skin_events.odds_event_id,
 * sides 'home'/'away', decimal odds).
 *
 * @see src/institutions/massey/edge-flags.ts — consumer
 * @see src/institutions/event-store/odds-ticks-store.ts — persistence
 */
import { americanToDecimal } from "../../institutions/massey/edge.ts";
import {
  persistOddsTicks,
  type OddsTickInsert,
} from "../../institutions/event-store/odds-ticks-store.ts";
import type { Database } from "bun:sqlite";
import type { PartnerMarket } from "../types.ts";

/** odds_ticks.source marker for Pandora eventCoefficients rows. */
export const PANDORA_ODDS_SOURCE = "pandora.eventCoefficients";

/** Map priced PartnerMarket rows to odds_ticks inserts (American → decimal). */
export function partnerMarketsToOddsTicks(
  markets: PartnerMarket[],
  ts: number,
): OddsTickInsert[] {
  const out: OddsTickInsert[] = [];
  for (const m of markets) {
    const homeDec = m.homePrice != null ? americanToDecimal(m.homePrice) : null;
    const awayDec = m.awayPrice != null ? americanToDecimal(m.awayPrice) : null;
    if (homeDec != null) {
      out.push({ eventId: m.oddsEventId, source: PANDORA_ODDS_SOURCE, side: "home", decimalOdds: homeDec, ts });
    }
    if (awayDec != null) {
      out.push({ eventId: m.oddsEventId, source: PANDORA_ODDS_SOURCE, side: "away", decimalOdds: awayDec, ts });
    }
  }
  return out;
}

/** Persist the current Pandora book into odds_ticks; returns inserted rows. */
export function persistCoefficientMarkets(
  db: Database,
  markets: PartnerMarket[],
  ts: number = Date.now(),
): number {
  return persistOddsTicks(db, partnerMarketsToOddsTicks(markets, ts));
}
