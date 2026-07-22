import type { ResearchConfig, ScoredRepo } from "./types.ts";
import { compareScored } from "./score.ts";
import { DEFAULT_MAX_PER_TAG, SDK_ONLY_TAG, UNTAGGED_BUCKET } from "./constants.ts";

export type TagCoverageRow = {
  tag: string;
  count: number;
  cap: number;
  atCap: boolean;
};

/** Tag frequency in shortlist (multi-tag repos increment each tag). */
export function shortlistTagCoverage(
  shortlist: ScoredRepo[],
  maxPerTag: number,
): TagCoverageRow[] {
  const counts = new Map<string, number>();
  for (const item of shortlist) {
    const tags = (item.signals.strategyTags ?? []).filter((t) => t !== SDK_ONLY_TAG);
    if (!tags.length) {
      counts.set(UNTAGGED_BUCKET, (counts.get(UNTAGGED_BUCKET) ?? 0) + 1);
      continue;
    }
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({
      tag,
      count,
      cap: maxPerTag,
      atCap: count >= maxPerTag,
    }));
}

export function buildShortlist(
  scored: ScoredRepo[],
  config: ResearchConfig,
  shortlistSize: number,
): { shortlist: ScoredRepo[]; excludedSdkOnly: ScoredRepo[] } {
  const excludedSdkOnly = scored.filter((s) => s.signals.isSdkOnly);
  const eligible = scored.filter((s) => !s.signals.isSdkOnly);
  const sorted = [...eligible].sort((a, b) =>
    compareScored(a, b, config.weights.stackTiebreakThreshold),
  );

  const maxPerTag = config.weights.maxPerTag ?? DEFAULT_MAX_PER_TAG;
  const majorTags = config.keywords.majorStrategyTags;
  const picked: ScoredRepo[] = [];
  const tagCounts = new Map<string, number>();

  function canPick(item: ScoredRepo): boolean {
    const tags = (item.signals.strategyTags ?? []).filter((t) => t !== SDK_ONLY_TAG);
    if (!tags.length) return (tagCounts.get(UNTAGGED_BUCKET) ?? 0) < maxPerTag;
    return tags.every((tag) => (tagCounts.get(tag) ?? 0) < maxPerTag);
  }

  function recordPick(item: ScoredRepo): void {
    const tags = (item.signals.strategyTags ?? []).filter((t) => t !== SDK_ONLY_TAG);
    if (!tags.length) {
      tagCounts.set(UNTAGGED_BUCKET, (tagCounts.get(UNTAGGED_BUCKET) ?? 0) + 1);
      return;
    }
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  // Ensure each major tag appears at least once when available
  for (const tag of majorTags) {
    if (picked.length >= shortlistSize) break;
    const candidate = sorted.find(
      (s) => !picked.includes(s) && s.signals.strategyTags.includes(tag) && canPick(s),
    );
    if (candidate) {
      picked.push(candidate);
      recordPick(candidate);
    }
  }

  for (const item of sorted) {
    if (picked.length >= shortlistSize) break;
    if (picked.includes(item)) continue;
    if (!canPick(item)) continue;
    picked.push(item);
    recordPick(item);
  }

  return { shortlist: picked, excludedSdkOnly };
}
