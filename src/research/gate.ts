import type { RepoCandidate } from "./types.ts";

export type GateOptions = {
  minStars: number;
  minForks: number;
  maxAgeMonths: number;
};

export type GateRejectionReason = "archived" | "low_popularity" | "stale";

export function gateRejectionReasons(repo: RepoCandidate, options: GateOptions): GateRejectionReason[] {
  const reasons: GateRejectionReason[] = [];
  if (repo.archived) reasons.push("archived");

  const popularEnough = repo.stars >= options.minStars || repo.forks >= options.minForks;
  if (!popularEnough) reasons.push("low_popularity");

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - options.maxAgeMonths);
  const pushed = new Date(repo.pushedAt);
  if (Number.isNaN(pushed.getTime()) || pushed < cutoff) reasons.push("stale");

  return reasons;
}

export function passesGate(repo: RepoCandidate, options: GateOptions): boolean {
  return gateRejectionReasons(repo, options).length === 0;
}

export function applyGate(candidates: RepoCandidate[], options: GateOptions): RepoCandidate[] {
  return candidates.filter((repo) => passesGate(repo, options));
}
