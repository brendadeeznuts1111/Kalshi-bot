/**
 * value-patterns.ts — consensus vs venue value detector.
 *
 * Pure building block: given OddsEvent[] (any adapter: xml/json/ws) and venue
 * implied references (Kalshi cents, Polymarket fraction), emit value patterns
 * per event × side. Reuses eventsToOddsPrints (vig-stripped implieds) from the
 * alpha signal-context so every detector input is the same normalized shape
 * the clusterer and the edge pipeline consume.
 */
import type { OddsEvent } from "../../alpha/odds-types.ts";
import { eventsToOddsPrints } from "../../alpha/signal-context.ts";

export type VenuePriceRef = {
  /** Event id, matching OddsEvent.id. */
  eventId: string;
  /** Venue key: kalshi | polymarket | ... */
  venue: string;
  /** Side as the venue prices it (ticker suffix for Kalshi, outcome name for Polymarket). */
  side: string;
  /** Implied probability 0..1 (Kalshi cents/100, Polymarket fraction). */
  implied: number;
};

export type ValuePattern = {
  eventId: string;
  side: string;
  venue: string;
  venueImplied: number;
  consensus: number;
  gap: number;
  bookmakers: number;
  spread: number;
  kind: "venue_undervalued" | "venue_overvalued" | "thin_consensus" | "wide_spread";
  severity: "info" | "watch" | "high";
  note: string;
};

export type DetectValuePatternsOptions = {
  /** |gap| threshold above which a venue is undervalued/overvalued. Default 0.04. */
  gapThreshold?: number;
  /** Fewer bookmakers than this -> thin_consensus. Default 4. */
  minBookmakers?: number;
  /** Consensus spread above this -> wide_spread. Default 0.12. */
  spreadThreshold?: number;
};

type SideConsensus = {
  consensus: number;
  bookmakers: number;
  spread: number;
};

function sideConsensus(events: OddsEvent[]): Map<string, Map<string, SideConsensus>> {
  const prints = eventsToOddsPrints(events);
  const bySide = new Map<string, Map<string, Array<{ implied: number }>>>();
  for (const p of prints) {
    const sides = bySide.get(p.eventId) ?? new Map<string, Array<{ implied: number }>>();
    const arr = sides.get(p.side) ?? [];
    arr.push({ implied: p.implied });
    sides.set(p.side, arr);
    bySide.set(p.eventId, sides);
  }
  const out = new Map<string, Map<string, SideConsensus>>();
  for (const [eventId, sides] of bySide) {
    const m = new Map<string, SideConsensus>();
    for (const [side, arr] of sides) {
      const implieds = arr.map((a) => a.implied);
      const consensus = implieds.reduce((a, b) => a + b, 0) / implieds.length;
      const spread = Math.max(...implieds) - Math.min(...implieds);
      m.set(side, { consensus, bookmakers: implieds.length, spread });
    }
    out.set(eventId, m);
  }
  return out;
}

/**
 * Detect value patterns: venue implied vs bookmaker consensus per event × side.
 * A venue priced below consensus is undervalued (value on the venue YES side);
 * priced above consensus is overvalued. Thin or wide consensus flags data quality
 * before trusting any gap.
 */
export function detectValuePatterns(
  events: OddsEvent[],
  venueRefs: VenuePriceRef[],
  options: DetectValuePatternsOptions = {},
): ValuePattern[] {
  const gapThreshold = options.gapThreshold ?? 0.04;
  const minBookmakers = options.minBookmakers ?? 4;
  const spreadThreshold = options.spreadThreshold ?? 0.12;
  const consensus = sideConsensus(events);
  const patterns: ValuePattern[] = [];

  for (const ref of venueRefs) {
    const side = consensus.get(ref.eventId)?.get(ref.side);
    if (!side) continue;
    const gap = ref.implied - side.consensus;
    const base = {
      eventId: ref.eventId,
      side: ref.side,
      venue: ref.venue,
      venueImplied: ref.implied,
      consensus: side.consensus,
      gap,
      bookmakers: side.bookmakers,
      spread: side.spread,
    };
    if (side.bookmakers < minBookmakers) {
      patterns.push({
        ...base,
        kind: "thin_consensus",
        severity: side.bookmakers < 2 ? "watch" : "info",
        note: `${side.bookmakers} bookmaker(s) — gap not actionable below ${minBookmakers}`,
      });
    }
    if (side.spread > spreadThreshold) {
      patterns.push({
        ...base,
        kind: "wide_spread",
        severity: side.spread > spreadThreshold * 1.5 ? "watch" : "info",
        note: `bookmaker spread ${(side.spread * 100).toFixed(1)}pp — consensus weak`,
      });
    }
    if (side.bookmakers >= minBookmakers && side.spread <= spreadThreshold) {
      if (gap <= -gapThreshold) {
        patterns.push({
          ...base,
          kind: "venue_undervalued",
          severity: gap <= -gapThreshold * 2 ? "high" : "watch",
          note: `${ref.venue} prices ${(ref.implied * 100).toFixed(1)}% vs consensus ${(side.consensus * 100).toFixed(1)}% (gap ${(gap * 100).toFixed(1)}pp)`,
        });
      } else if (gap >= gapThreshold) {
        patterns.push({
          ...base,
          kind: "venue_overvalued",
          severity: gap >= gapThreshold * 2 ? "watch" : "info",
          note: `${ref.venue} prices ${(ref.implied * 100).toFixed(1)}% vs consensus ${(side.consensus * 100).toFixed(1)}% (gap +${(gap * 100).toFixed(1)}pp)`,
        });
      }
    }
  }
  return patterns.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
}

/** Kalshi price cents -> implied probability (cents/100). */
export function kalshiCentsToImplied(cents: number): number {
  return Math.max(0, Math.min(1, cents / 100));
}

