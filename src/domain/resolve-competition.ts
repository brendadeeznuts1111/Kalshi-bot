/**
 * Resolve Plive/EZLive stream-list league wire → canonical Competition.
 *
 * Inventory key: (liveProduct shell) + streamBucket + league string.
 * ezlive reuses plive mappings (shared SportsWidgets shell).
 */

import {
  COMPETITIONS,
  normalizeLeagueKey,
  type CompetitionId,
  type CompetitionRecord,
} from './competitions.ts';
import { listLiveProductSportBindings } from './live-product-sport-bindings.ts';
import { isLiveProductId, normalizeLiveProductName, type LiveProductId } from './live-products.ts';
import { isSportId, type SportId } from './sports.ts';

export type ResolveCompetitionQuery = {
  liveProduct: string;
  league: string;
  streamBucket?: string;
  sportId?: string;
};

export type ResolvedCompetition = {
  competitionId: CompetitionId;
  competition: (typeof COMPETITIONS)[number];
  liveProduct: LiveProductId;
  /** Mapping shell used (plive when ezlive falls back). */
  mappingLiveProduct: 'plive';
};

function asLiveProduct(raw: string): LiveProductId | undefined {
  const n = normalizeLiveProductName(raw);
  return isLiveProductId(n) ? n : undefined;
}

/** Shell that owns competition mappings for this live product. */
function mappingShellFor(liveProduct: LiveProductId): 'plive' | undefined {
  if (liveProduct === 'plive' || liveProduct === 'ezlive') return 'plive';
  return undefined;
}

function bucketForSport(liveProduct: LiveProductId, sportId: SportId): string | undefined {
  const rows = listLiveProductSportBindings(liveProduct);
  return rows.find(r => r.sportId === sportId)?.streamBucket;
}

function leagueMatches(comp: CompetitionRecord, leagueNorm: string): boolean {
  const plive = comp.providerMappings.plive;
  if (plive && normalizeLeagueKey(plive.leagueKey) === leagueNorm) return true;
  return comp.aliases.some(a => normalizeLeagueKey(a) === leagueNorm);
}

/**
 * Map stream-list league (+ bucket/sport) to a seeded Competition.
 * Returns undefined for unknown / junk leagues.
 */
export function resolveCompetition(
  query: ResolveCompetitionQuery
): ResolvedCompetition | undefined {
  const liveProduct = asLiveProduct(query.liveProduct);
  if (!liveProduct) return undefined;

  const mappingLiveProduct = mappingShellFor(liveProduct);
  if (!mappingLiveProduct) return undefined;

  const leagueNorm = normalizeLeagueKey(query.league ?? '');
  if (!leagueNorm) return undefined;

  let streamBucket = query.streamBucket?.trim().toLowerCase() || undefined;
  let sportId: SportId | undefined =
    query.sportId && isSportId(query.sportId) ? query.sportId : undefined;

  if (!streamBucket && sportId) {
    streamBucket = bucketForSport(mappingLiveProduct, sportId);
  }

  const candidates = COMPETITIONS.filter(c => {
    if (sportId && c.sportId !== sportId) return false;
    const map = c.providerMappings.plive;
    if (!map) return false;
    if (streamBucket && map.streamBucket !== streamBucket) return false;
    return leagueMatches(c, leagueNorm);
  });

  if (candidates.length === 0) return undefined;
  // Prefer exact streamBucket match when multiple alias hits (should be rare).
  const hit =
    (streamBucket
      ? candidates.find(c => c.providerMappings.plive?.streamBucket === streamBucket)
      : undefined) ?? candidates[0]!;

  return {
    competitionId: hit.id,
    competition: hit,
    liveProduct,
    mappingLiveProduct,
  };
}
