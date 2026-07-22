/** Per-run cache telemetry — reset at the start of each research run. */

export type ResearchCacheStats = {
  searchEtagHits: number;
  searchDegradedHits: number;
  inspectExactHits: number;
  inspectContentReuseHits: number;
  inspectDegradedHits: number;
  apiDegradedHits: number;
};

export type CacheStatEvent =
  | "searchEtag"
  | "searchDegraded"
  | "inspectExact"
  | "inspectContentReuse"
  | "inspectDegraded"
  | "apiDegraded";

let active: ResearchCacheStats | null = null;

export function beginResearchCacheStats(): ResearchCacheStats {
  active = {
    searchEtagHits: 0,
    searchDegradedHits: 0,
    inspectExactHits: 0,
    inspectContentReuseHits: 0,
    inspectDegradedHits: 0,
    apiDegradedHits: 0,
  };
  return active;
}

export function finishResearchCacheStats(): ResearchCacheStats | null {
  const stats = active;
  active = null;
  return stats;
}

export function peekResearchCacheStats(): ResearchCacheStats | null {
  return active;
}

export function recordCacheStat(event: CacheStatEvent): void {
  if (!active) return;
  switch (event) {
    case "searchEtag":
      active.searchEtagHits++;
      break;
    case "searchDegraded":
      active.searchDegradedHits++;
      break;
    case "inspectExact":
      active.inspectExactHits++;
      break;
    case "inspectContentReuse":
      active.inspectContentReuseHits++;
      break;
    case "inspectDegraded":
      active.inspectDegradedHits++;
      break;
    case "apiDegraded":
      active.apiDegradedHits++;
      break;
  }
}

export function formatCacheStatsSummary(stats: ResearchCacheStats): string {
  const parts: string[] = [];
  if (stats.searchEtagHits) parts.push(`search ETag ${stats.searchEtagHits}`);
  if (stats.searchDegradedHits) parts.push(`search stale ${stats.searchDegradedHits}`);
  if (stats.inspectExactHits) parts.push(`inspect exact ${stats.inspectExactHits}`);
  if (stats.inspectContentReuseHits) parts.push(`inspect reuse ${stats.inspectContentReuseHits}`);
  if (stats.inspectDegradedHits) parts.push(`inspect stale ${stats.inspectDegradedHits}`);
  if (stats.apiDegradedHits) parts.push(`api stale ${stats.apiDegradedHits}`);
  return parts.length ? parts.join(", ") : "no cache hits";
}

export function hasDegradedCacheUsage(stats: ResearchCacheStats): boolean {
  return (
    stats.searchDegradedHits > 0 ||
    stats.inspectDegradedHits > 0 ||
    stats.apiDegradedHits > 0
  );
}
