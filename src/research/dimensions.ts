// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
import { RESEARCH_ROOT, joinPath } from "./paths.ts";

/** Branded research slice id (dimensions.json key). */
export type DimensionId = string & { readonly __brand: "DimensionId" };

export const DEFAULT_DIMENSION = "all" as DimensionId;

export function asDimensionId(raw: string): DimensionId {
  const id = raw.trim();
  if (!id) throw new Error("DimensionId required");
  return id as DimensionId;
}

export function tryDimensionId(raw: string | undefined | null): DimensionId | undefined {
  if (!raw?.trim()) return undefined;
  return asDimensionId(raw);
}

export type DimensionDef = {
  label: string;
  queries: string[];
  candidateCap?: number;
};

export type DimensionsFile = {
  candidateCap: number;
  defaultDimension: string;
  dimensions: Record<string, DimensionDef>;
};

export type ResolvedDimensionQueries = {
  dimension: DimensionId;
  label: string;
  queries: string[];
  candidateCap: number;
};

export function normalizeDimensionId(raw: string | undefined | null): DimensionId {
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? (trimmed as DimensionId) : DEFAULT_DIMENSION;
}

export function listDimensionIds(file: DimensionsFile): DimensionId[] {
  return Object.keys(file.dimensions)
    .sort()
    .map((id) => id as DimensionId);
}

export function resolveDimensionQueries(
  file: DimensionsFile,
  dimensionId: string,
): ResolvedDimensionQueries {
  const id = normalizeDimensionId(dimensionId);
  const def = file.dimensions[id];
  if (!def) {
    const available = listDimensionIds(file).join(", ");
    throw new Error(`Unknown research dimension "${id}". Available: ${available}`);
  }
  if (!Array.isArray(def.queries) || def.queries.length === 0) {
    throw new Error(`Dimension "${id}" has no queries configured`);
  }
  return {
    dimension: id,
    label: def.label,
    queries: def.queries,
    candidateCap: def.candidateCap ?? file.candidateCap,
  };
}

export async function loadDimensionsFile(): Promise<DimensionsFile> {
  const raw = (await Bun.file(joinPath(RESEARCH_ROOT, "dimensions.json")).json()) as DimensionsFile;
  if (!raw?.dimensions || typeof raw.dimensions !== "object") {
    throw new Error("Invalid research/dimensions.json — missing dimensions map");
  }
  if (!raw.defaultDimension || !raw.dimensions[raw.defaultDimension]) {
    throw new Error("Invalid research/dimensions.json — defaultDimension must exist in dimensions");
  }
  if (!Number.isFinite(raw.candidateCap) || raw.candidateCap <= 0) {
    throw new Error("Invalid research/dimensions.json — candidateCap must be a positive number");
  }
  return raw;
}

/** Dimension tag on a run payload (legacy runs without field → all). */
export function runDimension(run: { dimension?: string | null }): DimensionId {
  return normalizeDimensionId(run.dimension ?? DEFAULT_DIMENSION);
}

/** Report/output basename: latest vs latest-{dimension}. */
export function dimensionArtifactBasename(dimension: string): string {
  const id = normalizeDimensionId(dimension);
  return id === DEFAULT_DIMENSION ? "latest" : `latest-${id}`;
}
