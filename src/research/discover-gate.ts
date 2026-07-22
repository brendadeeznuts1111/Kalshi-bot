import type { GateOptions } from "./gate.ts";

export type DiscoverGateOverrides = {
  discoverMinStars?: number;
  discoverMinForks?: number;
  discoverMaxAgeMonths?: number;
  /** Force broad GitHub search (no stars:/forks: qualifiers). */
  discoverBroad?: boolean;
};

export type ResolvedGates = {
  apply: GateOptions;
  discover: GateOptions;
};

function hasExplicitDiscoverOverride(overrides: DiscoverGateOverrides): boolean {
  return (
    overrides.discoverBroad === true ||
    overrides.discoverMinStars !== undefined ||
    overrides.discoverMinForks !== undefined ||
    overrides.discoverMaxAgeMonths !== undefined
  );
}

/**
 * Resolve GitHub search gate vs local apply gate.
 *
 * Default: when apply gate has popularity thresholds and no explicit discover
 * overrides, discover broadly (minStars/minForks 0) so applyGate can reject
 * near misses — enables live gate-miss without seeding runs.
 *
 * Use --discover-min-stars / --discover-min-forks to restore search pre-filtering.
 */
export function resolveDiscoverGate(
  applyGate: GateOptions,
  overrides: DiscoverGateOverrides = {},
): GateOptions {
  if (overrides.discoverBroad) {
    return {
      minStars: overrides.discoverMinStars ?? 0,
      minForks: overrides.discoverMinForks ?? 0,
      maxAgeMonths: overrides.discoverMaxAgeMonths ?? applyGate.maxAgeMonths,
    };
  }

  if (hasExplicitDiscoverOverride(overrides)) {
    return {
      minStars: overrides.discoverMinStars ?? applyGate.minStars,
      minForks: overrides.discoverMinForks ?? applyGate.minForks,
      maxAgeMonths: overrides.discoverMaxAgeMonths ?? applyGate.maxAgeMonths,
    };
  }

  if (applyGate.minStars > 0 || applyGate.minForks > 0) {
    return {
      minStars: 0,
      minForks: 0,
      maxAgeMonths: applyGate.maxAgeMonths,
    };
  }

  return { ...applyGate };
}

export function resolveGates(
  applyGate: GateOptions,
  overrides: DiscoverGateOverrides = {},
): ResolvedGates {
  const discover = resolveDiscoverGate(applyGate, overrides);
  return { apply: applyGate, discover };
}

export function gatesDiffer(apply: GateOptions, discover: GateOptions): boolean {
  return (
    apply.minStars !== discover.minStars ||
    apply.minForks !== discover.minForks ||
    apply.maxAgeMonths !== discover.maxAgeMonths
  );
}

export function formatDiscoverGateNote(apply: GateOptions, discover: GateOptions): string | null {
  if (!gatesDiffer(apply, discover)) return null;
  return (
    `Discovery search uses relaxed gate (min-stars=${discover.minStars}, min-forks=${discover.minForks}, ` +
    `max-age-months=${discover.maxAgeMonths}); apply gate is stricter ` +
    `(min-stars=${apply.minStars}, min-forks=${apply.minForks}, max-age-months=${apply.maxAgeMonths}).`
  );
}

export function parseSearchQueryPopularity(query: string): {
  minStars: number;
  minForks: number;
} {
  const stars = /\bstars:>=(\d+)/i.exec(query);
  const forks = /\bforks:>=(\d+)/i.exec(query);
  return {
    minStars: stars ? Number(stars[1]) : 0,
    minForks: forks ? Number(forks[1]) : 0,
  };
}

/**
 * Mode of stars/forks qualifiers across stored/search query strings.
 * maxAgeMonths inherited from apply (pushed dates are not recoverable).
 */
export function inferDiscoverGateFromSearchQueries(
  searchQueries: string[],
  apply: GateOptions,
): GateOptions | null {
  if (searchQueries.length === 0) return null;
  const tallies = new Map<string, { n: number; minStars: number; minForks: number }>();
  for (const q of searchQueries) {
    const { minStars, minForks } = parseSearchQueryPopularity(q);
    const key = `${minStars}:${minForks}`;
    const cur = tallies.get(key) ?? { n: 0, minStars, minForks };
    cur.n += 1;
    tallies.set(key, cur);
  }
  const best = [...tallies.values()].sort((a, b) => b.n - a.n)[0];
  if (!best) return null;
  return {
    minStars: best.minStars,
    minForks: best.minForks,
    maxAgeMonths: apply.maxAgeMonths,
  };
}
