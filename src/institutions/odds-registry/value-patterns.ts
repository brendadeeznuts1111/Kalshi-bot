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
// ── Convergence detector (P5: mispricing + convergence) ────────────────────

export type ConvergenceSnapshot = {
  /** Epoch ms of this snapshot (from bookmaker lastUpdate when present). */
  ts: number;
  /** Bookmaker consensus (mean vig-stripped implied) for the side. */
  consensus: number;
  /** Bookmaker spread (max-min implied) — how tight the field is. */
  spread: number;
  /** How many bookmakers quoted this side. */
  bookmakers: number;
};

export type ConvergencePattern = {
  eventId: string;
  side: string;
  kind: "converging" | "diverging" | "venue_converging" | "stale";
  severity: "info" | "watch" | "high";
  /** Current consensus implied. */
  consensus: number;
  /** Prior consensus implied (earlier snapshot). */
  priorConsensus: number;
  /** Current spread. */
  spread: number;
  /** Prior spread. */
  priorSpread: number;
  note: string;
};

export type DetectConvergenceOptions = {
  /** Spread tightening (pp) required to call it converging. Default 2pp. */
  tightenPp?: number;
  /** Spread widening (pp) required to call it diverging. Default 3pp. */
  widenPp?: number;
  /** Consensus move (pp) that counts as meaningful drift. Default 1.5pp. */
  movePp?: number;
  /** Max snapshot age (ms) before stale. Default 5 min. */
  maxAgeMs?: number;
};

/**
 * Compare two consensus snapshots for one event×side and classify movement:
 * bookmakers tightening onto a price (converging), spreading apart
 * (diverging), or a stale quote. Pure — callers feed snapshots from any
 * adapter (xml/json/ws) at any cadence.
 */
export function classifyConvergence(
  eventId: string,
  side: string,
  current: ConvergenceSnapshot,
  prior: ConvergenceSnapshot | null,
  options: DetectConvergenceOptions = {},
): ConvergencePattern | null {
  const tightenPp = options.tightenPp ?? 2;
  const widenPp = options.widenPp ?? 3;
  const movePp = options.movePp ?? 1.5;
  const maxAgeMs = options.maxAgeMs ?? 5 * 60_000;

  const age = Date.now() - current.ts;
  if (age > maxAgeMs) {
    return {
      eventId, side, kind: "stale", severity: "info",
      consensus: current.consensus, priorConsensus: current.consensus,
      spread: current.spread, priorSpread: current.spread,
      note: `quote ${Math.round(age / 1000)}s old — refresh the feed`,
    };
  }

  if (!prior || prior.bookmakers < 2 || current.bookmakers < 2) return null;
  const spreadDelta = (current.spread - prior.spread) * 100;
  const consensusDelta = (current.consensus - prior.consensus) * 100;

  if (spreadDelta <= -tightenPp) {
    const severity = Math.abs(consensusDelta) >= movePp ? "watch" : "info";
    return {
      eventId, side, kind: "converging", severity,
      consensus: current.consensus, priorConsensus: prior.consensus,
      spread: current.spread, priorSpread: prior.spread,
      note: `spread tightened ${(prior.spread * 100).toFixed(1)}pp → ${(current.spread * 100).toFixed(1)}pp` + (Math.abs(consensusDelta) >= movePp ? ` — consensus moved ${consensusDelta >= 0 ? "+" : ""}${consensusDelta.toFixed(1)}pp` : ""),
    };
  }
  if (spreadDelta >= widenPp) {
    return {
      eventId, side, kind: "diverging", severity: "watch",
      consensus: current.consensus, priorConsensus: prior.consensus,
      spread: current.spread, priorSpread: prior.spread,
      note: `spread widened ${(prior.spread * 100).toFixed(1)}pp → ${(current.spread * 100).toFixed(1)}pp — disagreement growing`,
    };
  }
  return null;
}

/**
 * Build a per-side consensus snapshot from OddsEvent[] (same normalized shape
 * as the value detector). ts = latest bookmaker lastUpdate across the event
 * (falls back to Date.now() when no timestamps exist).
 */
export function consensusSnapshot(events: OddsEvent[], eventId: string, side: string): ConvergenceSnapshot | null {
  let consensus: number | null = null;
  let spread = 0;
  let count = 0;
  let ts = 0;
  for (const ev of events) {
    if (ev.id !== eventId) continue;
    for (const bk of ev.bookmakers) {
      const lastUpdate = Date.parse(bk.lastUpdate);
      if (Number.isFinite(lastUpdate) && lastUpdate > ts) ts = lastUpdate;
      const m = bk.markets[0];
      if (!m) continue;
      const o = m.outcomes.find((x) => x.name === side);
      if (!o) continue;
      const implied = americanToImpliedLocal(o.price);
      if (implied <= 0 || implied >= 1) continue;
      if (consensus === null) consensus = implied;
      count += 1;
      const min = consensus ?? implied;
      spread = Math.max(spread, Math.abs(implied - min));
    }
  }
  if (count === 0 || consensus === null) return null;
  // re-derive true mean/spread over collected implieds
  const implieds: number[] = [];
  for (const ev of events) {
    if (ev.id !== eventId) continue;
    for (const bk of ev.bookmakers) {
      const o = bk.markets[0]?.outcomes.find((x) => x.name === side);
      if (!o) continue;
      const implied = americanToImpliedLocal(o.price);
      if (implied > 0 && implied < 1) implieds.push(implied);
    }
  }
  const mean = implieds.reduce((a, b) => a + b, 0) / implieds.length;
  const mn = Math.min(...implieds);
  const mx = Math.max(...implieds);
  return {
    ts: ts > 0 ? ts : Date.now(),
    consensus: mean,
    spread: mx - mn,
    bookmakers: implieds.length,
  };
}

/** American -> implied (mirrors the alpha helper; kept local to stay import-light). */
function americanToImpliedLocal(price: number): number {
  if (!Number.isFinite(price) || price === 0) return 0;
  return price > 0 ? 100 / (100 + price) : -price / (100 - price);
}


