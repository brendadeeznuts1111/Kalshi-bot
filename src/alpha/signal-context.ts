/**
 * Pinnacle consensus → SignalContext — odds client + ticker mapper wired.
 * Tenants call this from buildSignalContext; harness never imports here.
 */
import type { BookSnapshot, SignalContext } from "../institutions/alpha-signal-types.ts";
import type { OddsEvent } from "./odds-types.ts";
import { pinnacleSnapshot } from "./odds-feed.ts";
import {
  mapTickerOrThrow,
  validateTickerMapping,
  type FeedEventRef,
  type TickerMapperOptions,
} from "./ticker-mapper.ts";
import { yesProbabilityFromSnapshot } from "./ticker-formats/index.ts";

export type BuildPinnacleSignalInput = {
  kalshiTicker: string;
  book: BookSnapshot;
  events: OddsEvent[];
  /** YES side — home on KXNBAGAME; suffix team on KXMLBGAME. */
  side?: "yes" | "no";
  kalshiPriceCents?: number;
  mapperOptions?: TickerMapperOptions;
};

export function eventsToFeedRefs(events: OddsEvent[]): FeedEventRef[] {
  return events.map((e) => ({
    eventId: e.id,
    homeTeam: e.homeTeam,
    awayTeam: e.awayTeam,
    commenceTime: e.commenceTime,
  }));
}

/**
 * Map Kalshi ticker → Pinnacle event, validate, return vig-stripped p_model + components.
 */
export async function buildPinnacleSignalContext(
  input: BuildPinnacleSignalInput,
): Promise<SignalContext | null> {
  const refs = eventsToFeedRefs(input.events);
  const kalshiPriceCents =
    input.kalshiPriceCents ?? input.book.asks[0]?.priceCents ?? undefined;

  let mapped;
  try {
    mapped = await mapTickerOrThrow(input.kalshiTicker, refs, {
      ...input.mapperOptions,
      validate: false,
    });
  } catch {
    return null;
  }

  const event = input.events.find((e) => e.id === mapped.eventId);
  if (!event) return null;

  const snap = pinnacleSnapshot(event);
  if (!snap) return null;

  const side = input.side ?? "yes";
  const yesProb = yesProbabilityFromSnapshot(
    input.kalshiTicker,
    snap.probabilities.home,
    snap.probabilities.away,
    event.homeTeam,
    event.awayTeam,
  );
  const pModel = side === "yes" ? yesProb : 1 - yesProb;

  if (kalshiPriceCents != null) {
    validateTickerMapping(input.kalshiTicker, mapped, {
      pinnacleProb: pModel,
      kalshiPriceCents,
    });
  } else {
    validateTickerMapping(input.kalshiTicker, mapped);
  }

  const mid =
    input.book.bids[0] && input.book.asks[0]
      ? Math.round((input.book.bids[0].priceCents + input.book.asks[0].priceCents) / 2)
      : null;

  return {
    ticker: input.kalshiTicker,
    eventId: mapped.eventId,
    book: input.book,
    pModel,
    components: {
      pinnacle_novig_home: snap.probabilities.home,
      pinnacle_novig_away: snap.probabilities.away,
      ...(mid != null ? { kalshi_mid_cents: mid } : {}),
    },
  };
}
