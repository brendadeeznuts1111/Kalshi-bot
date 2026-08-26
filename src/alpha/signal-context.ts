/**
 * Pinnacle consensus → SignalContext — odds client + ticker mapper wired.
 * Tenants call this from buildSignalContext; harness never imports here.
 */
import type { BookSnapshot, SignalContext } from "../institutions/alpha-signal-types.ts";
import {
  attachEdgePatternComponents,
  resolveSettlementWeighting,
  scanEdgePatterns,
  type SettlementPhase,
} from "../settlement/index.ts";
import type { OddsEvent } from "./odds-types.ts";
import { pinnacleSnapshot } from "./odds-feed.ts";
import {
  mapTickerOrThrow,
  validateTickerMapping,
  type FeedEventRef,
  type TickerMapperOptions,
} from "./ticker-mapper.ts";
import { yesProbabilityFromSnapshot } from "./ticker-formats/index.ts";
import { clusterOddsPrints, type OddsPrint } from "./cluster/odds-vector.ts";

export type BuildPinnacleSignalInput = {
  kalshiTicker: string;
  book: BookSnapshot;
  events: OddsEvent[];
  /** YES side — home on KXNBAGAME; suffix team on KXMLBGAME. */
  side?: "yes" | "no";
  kalshiPriceCents?: number;
  mapperOptions?: TickerMapperOptions;
  /**
   * Optional shell settlement + sport-wide edge patterns.
   * When set, components get settlement_* and pat_* tags from scanEdgePatterns.
   */
  settlement?: {
    sportId: string;
    phase: SettlementPhase;
    marketType?: string | null;
    period?: string | null;
    matchState?: {
      firstSetCompleted?: boolean;
      matchCompleted?: boolean;
      periodCompleted?: boolean;
      minute?: number;
      injuryRisk?: boolean;
      eligibilityBroken?: boolean;
    };
    /** Default true — scan convergent edge patterns. */
    scanPatterns?: boolean;
  };
};

/**
 * American odds -> implied probability (The Odds API convention): positive
 * price p -> 100/(100+p); negative -> -p/(100-p).
 */
export function americanToImplied(price: number): number {
  return price >= 0 ? 100 / (100 + price) : -price / (100 - price);
}

/**
 * Convert normalized events into clustering prints [source, event, side, implied,
 * vig, ts] - the heap-based clusterer input (cluster/odds-vector.ts, §193).
 * One print per outcome per bookmaker, implied derived from American odds, vig =
 * the market's overround (sum of implieds minus 1, floored at 0).
 */
export function eventsToOddsPrints(events: OddsEvent[]): OddsPrint[] {
  const prints: OddsPrint[] = [];
  for (const ev of events) {
    for (const bk of ev.bookmakers) {
      const m = bk.markets[0];
      if (!m || m.outcomes.length < 2) continue;
      let sum = 0;
      const implieds: Array<{ side: string; implied: number }> = [];
      for (const o of m.outcomes) {
        const implied = americanToImplied(o.price);
        implieds.push({ side: o.name, implied });
        sum += implied;
      }
      const vig = Math.max(0, sum - 1);
      const ts = Date.parse(ev.commenceTime) || 0;
      for (const { side, implied } of implieds) {
        prints.push({ id: bk.key + ':' + ev.id + ':' + side, source: bk.key, eventId: ev.id, side, implied: implied / sum, vig, ts });
      }
    }
  }
  return prints;
}

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

  let components: Record<string, number> = {
    pinnacle_novig_home: snap.probabilities.home,
    pinnacle_novig_away: snap.probabilities.away,
    ...(mid != null ? { kalshi_mid_cents: mid } : {}),
  };

  if (input.settlement) {
    if (input.settlement.scanPatterns === false) {
      const w = resolveSettlementWeighting({
        sportId: input.settlement.sportId,
        phase: input.settlement.phase,
        ...(input.settlement.marketType !== undefined ? { marketType: input.settlement.marketType } : {}),
        ...(input.settlement.period !== undefined ? { period: input.settlement.period } : {}),
        ...(input.settlement.matchState !== undefined ? { matchState: input.settlement.matchState } : {}),
      });
      components = {
        ...components,
        settlement_void_risk:
          w.voidRisk === "high" ? 3 : w.voidRisk === "medium" ? 2 : w.voidRisk === "low" ? 1 : 0,
        settlement_phase_live: w.phase === "live" ? 1 : 0,
        settlement_prefer_unit_markets: w.preferCompletedUnitMarkets ? 1 : 0,
      };
    } else {
      const scan = scanEdgePatterns({
        sportId: input.settlement.sportId,
        phase: input.settlement.phase,
        ...(input.settlement.marketType !== undefined ? { marketType: input.settlement.marketType } : {}),
        ...(input.settlement.period !== undefined ? { period: input.settlement.period } : {}),
        ...(input.settlement.matchState !== undefined ? { matchState: input.settlement.matchState } : {}),
      });
      components = attachEdgePatternComponents(components, scan);
    }
  }

  return {
    ticker: input.kalshiTicker,
    eventId: mapped.eventId,
    book: input.book,
    pModel,
    components,
    consensus: buildOddsConsensus(input.events),
  };
}

/**
 * Heap-based odds consensus: cluster the event prints across sources and return a
 * compact summary (the signal pipeline's consensus surface, §193). Null when fewer
 * than two prints are derivable.
 */
export function buildOddsConsensus(events: OddsEvent[]): { prints: number; clusters: number; noise: number; labels: number[] } | null {
  const consensusPrints = eventsToOddsPrints(events);
  if (consensusPrints.length < 2) return null;
  const r = clusterOddsPrints(consensusPrints, { minClusterSize: 2 });
  return { prints: r.prints.length, clusters: [...r.clusters.keys()].length, noise: r.noiseCount, labels: r.labels };
}
