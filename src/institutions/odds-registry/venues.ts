/**
 * venues.ts — consensus vs Kalshi + Polymarket: per-sport × per-market table of
 * bookmaker capacity (odds registry) against venue declared coverage
 * (market-registry SPORTS_SOURCE_REGISTRY). Declaration-level by design: live
 * odds flow through the adapters; this is the comparison shape they feed.
 */
import { SPORTS_SOURCE_REGISTRY } from "../market-registry/registry.ts";
import { unbrand } from "../market-registry/brands.ts";
import type { OddsRegistryConfig } from "./types.ts";

export type VenueCoverage = {
  key: string;
  label: string;
  declared: boolean;
  state: string | null;
};

export type SportConsensusRow = {
  sport: string;
  bookmakers: number;
  markets: string[];
  venues: VenueCoverage[];
};

export type OddsVsVenuesPayload = {
  schema: "odds-vs-venues/v1";
  generatedAt: string;
  capacityFloor: number;
  rows: SportConsensusRow[];
};

/**
 * Join-key map: odds-registry sport keys (odds-api vocabulary, e.g. `tennis_atp`)
 * to venue-registry sport keys (`tennis`). Sports without a venue counterpart
 * stay unmapped — their venues row reads `declared:false`.
 */
export const VENUE_SPORT_MAP: Readonly<Record<string, string>> = {
  tennis_atp: "tennis",
};

/**
 * Join the odds-registry config (bookmaker count per sport) with the venue
 * registry (Kalshi/Polymarket declared integrations per sport).
 */
export function compareOddsVsVenues(cfg: OddsRegistryConfig, now = new Date()): OddsVsVenuesPayload {
  const sports = new Map<string, { bookmakers: Set<string>; markets: Set<string> }>();
  for (const bk of cfg.bookmakers) {
    for (const sport of bk.sports) {
      const row = sports.get(sport) ?? { bookmakers: new Set<string>(), markets: new Set<string>() };
      row.bookmakers.add(bk.key);
      if (bk.markets) for (const m of bk.markets.split(",")) row.markets.add(m.trim());
      sports.set(sport, row);
    }
  }

  // venue integrations indexed by (source key, sport key)
  const integrations = new Map<string, Map<string, string>>();
  for (const src of SPORTS_SOURCE_REGISTRY.sources) integrations.set(src.key, new Map());
  for (const it of SPORTS_SOURCE_REGISTRY.integrations) {
    const m = integrations.get(it.source);
    if (m) m.set(unbrand(it.sport), it.state);
  }

  const rows: SportConsensusRow[] = [...sports.entries()].sort().map(([sport, s]) => ({
    sport,
    bookmakers: s.bookmakers.size,
    markets: [...s.markets].sort(),
    venues: SPORTS_SOURCE_REGISTRY.sources.map((src) => {
      const venueSport = VENUE_SPORT_MAP[sport] ?? sport;
      const state = integrations.get(src.key)?.get(venueSport) ?? null;
      return { key: src.key, label: src.label, declared: state !== null, state };
    }),
  }));

  return {
    schema: "odds-vs-venues/v1",
    generatedAt: now.toISOString(),
    capacityFloor: cfg.capacityFloor,
    rows,
  };
}

/** Venue sport keys differ from registry sport keys; map declared venue sports back for labeling. */
export function venueSports(): { key: string; label: string }[] {
  return SPORTS_SOURCE_REGISTRY.sports.map((s) => ({ key: unbrand(s.key), label: s.label }));
}

