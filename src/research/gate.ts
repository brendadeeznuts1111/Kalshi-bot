import type { RepoCandidate } from "./types.ts";

export type GateOptions = {
  minStars: number;
  minForks: number;
  maxAgeMonths: number;
};

export function applyGate(candidates: RepoCandidate[], options: GateOptions): RepoCandidate[] {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - options.maxAgeMonths);

  return candidates.filter((repo) => {
    if (repo.archived) return false;
    const popularEnough = repo.stars >= options.minStars || repo.forks >= options.minForks;
    if (!popularEnough) return false;
    const pushed = new Date(repo.pushedAt);
    if (Number.isNaN(pushed.getTime()) || pushed < cutoff) return false;
    return true;
  });
}
