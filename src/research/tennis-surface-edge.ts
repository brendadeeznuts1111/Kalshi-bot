/** Minimum completed matches required per player before surfacing an edge. */
export const MIN_SURFACE_EDGE_APPEARANCES = 10;

export type EdgeScaling = "dampened" | "linear" | "sigmoid";

export type SurfacePerformance = {
  appearances: number;
  wins: number;
  /** Win rate in the normalized 0–1 range. */
  winRate: number;
};

export type SurfaceEdgeOptions = {
  minSampleSize?: number;
  scaling?: EdgeScaling;
};

/** Normalize warehouse and tournament labels to the same lookup key. */
export function normalizeTennisSurface(surface: string | null | undefined): string | null {
  const normalized = surface?.trim().toLowerCase();
  if (!normalized || normalized === "unknown" || normalized === "n/a") {
    return null;
  }
  return normalized;
}

/**
 * Player A's surface-specific edge relative to player B.
 *
 * The raw win-rate difference is converted to percentage points and dampened
 * at the extremes: diff × (1 - |diff| / 200). An insufficient sample is
 * intentionally neutral instead of extrapolated.
 */
export function computeSurfaceEdge(
  playerA: SurfacePerformance | undefined,
  playerB: SurfacePerformance | undefined,
  options: SurfaceEdgeOptions = {},
): number {
  const minSampleSize = Math.max(
    1,
    Math.floor(options.minSampleSize ?? MIN_SURFACE_EDGE_APPEARANCES),
  );
  if (
    !playerA ||
    !playerB ||
    playerA.appearances < minSampleSize ||
    playerB.appearances < minSampleSize
  ) {
    return 0;
  }

  const diff = Math.max(
    -100,
    Math.min(100, (playerA.winRate - playerB.winRate) * 100),
  );
  switch (options.scaling ?? "dampened") {
    case "linear":
      return Math.round(diff);
    case "sigmoid": {
      const scaled = 100 * (2 / (1 + Math.exp(-0.05 * diff)) - 1);
      return Math.round(Math.max(-100, Math.min(100, scaled)));
    }
    case "dampened":
    default: {
      const dampened = diff * (1 - Math.abs(diff) / 200);
      return Math.round(Math.max(-100, Math.min(100, dampened)));
    }
  }
}

export function hasReliableSurfaceSample(
  playerA: SurfacePerformance | undefined,
  playerB: SurfacePerformance | undefined,
  minSampleSize = MIN_SURFACE_EDGE_APPEARANCES,
): boolean {
  return (
    playerA !== undefined &&
    playerB !== undefined &&
    playerA.appearances >= minSampleSize &&
    playerB.appearances >= minSampleSize
  );
}
