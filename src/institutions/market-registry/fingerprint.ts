import { createHash } from "node:crypto";
import {
  asSourceRegistryFingerprint,
  type SourceRegistryFingerprint,
} from "./brands.ts";
import {
  buildSportsSourceRegistryArtifact,
  SPORTS_SOURCE_REGISTRY,
} from "./registry.ts";
import type { SportsSourceRegistry } from "./types.ts";

/** Stable fingerprint of registry semantics; generation time is deliberately fixed. */
export function sourceRegistryFingerprint(
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY,
): SourceRegistryFingerprint {
  const artifact = buildSportsSourceRegistryArtifact("1970-01-01T00:00:00.000Z", registry);
  return asSourceRegistryFingerprint(
    createHash("sha256").update(canonicalJson(artifact)).digest("hex"),
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
