import type { ResearchConfig, ScoredRepo } from "./types.ts";
import { compareScored } from "./score.ts";
import { DEFAULT_MAX_PER_TAG, SDK_ONLY_TAG, UNTAGGED_BUCKET } from "./constants.ts";

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
    const tags = item.signals.strategyTags.filter((t) => t !== SDK_ONLY_TAG);
    if (!tags.length) return (tagCounts.get(UNTAGGED_BUCKET) ?? 0) < maxPerTag;
    return tags.every((tag) => (tagCounts.get(tag) ?? 0) < maxPerTag);
  }

  function recordPick(item: ScoredRepo): void {
    const tags = item.signals.strategyTags.filter((t) => t !== SDK_ONLY_TAG);
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
