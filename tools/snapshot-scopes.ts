/**
 * Scope configurations for the snapshot tool.
 *
 * Each scope defines:
 * - baseUrl: where to fetch the report from
 * - assetPaths: relative paths to download and store alongside the manifest
 * - manifestExtra: additional fields to include in the manifest
 *
 * Add new scopes here; no other file needs changing.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type SnapshotScope = "data-plane" | "prediction" | "portal" | "gaps";

export type ScopeConfig = {
  /** Human-readable description */
  label: string;
  /** Base URL for the report endpoint (trailing slash recommended) */
  baseUrl: string | null;
  /** Relative asset paths to download */
  assetPaths: string[];
  /** Extra manifest fields */
  manifestExtra: Record<string, unknown>;
  /** Local output directory (relative to project root) */
  outputDir: string;
};

export const SCOPE_CONFIGS: Record<SnapshotScope, ScopeConfig> = {
  "data-plane": {
    label: "Event-store DB + coverage + canary state",
    baseUrl: null, // captured locally from SQLite
    assetPaths: [],
    manifestExtra: { captureType: "sqlite-local" },
    outputDir: "research/registry",
  },
  prediction: {
    label: "Prediction report (model outputs, calibration, Brier)",
    baseUrl: "http://localhost:3456/registry/prediction/report",
    assetPaths: [
      "summary.json",
      "assets/histogram.svg",
      "assets/rolling.svg",
      "assets/stability.svg",
    ],
    manifestExtra: { reportType: "prediction" },
    outputDir: "research/snapshots/prediction",
  },
  portal: {
    label: "Portal dashboard (ops metrics, partner health)",
    baseUrl: "http://localhost:3456/registry/portal/report",
    assetPaths: [
      "summary.json",
      "assets/portal-heatmap.png",
      "assets/traffic.svg",
    ],
    manifestExtra: { reportType: "portal" },
    outputDir: "research/snapshots/portal",
  },
  gaps: {
    label: "Data-gap report (coverage holes, missing sources)",
    baseUrl: "http://localhost:3456/registry/gaps/report",
    assetPaths: ["summary.json", "assets/gap-matrix.svg"],
    manifestExtra: { reportType: "gaps" },
    outputDir: "research/snapshots/gaps",
  },
};

export function isKnownScope(s: string): s is SnapshotScope {
  return s in SCOPE_CONFIGS;
}

export function resolveScope(
  requested: string | undefined,
  cwdAutoDetect = true,
): SnapshotScope {
  if (requested && isKnownScope(requested)) return requested;

  if (cwdAutoDetect) {
    // Auto-detect from directory name
    const cwd = process.cwd();
    if (cwd.includes("prediction")) return "prediction";
    if (cwd.includes("portal")) return "portal";
    if (cwd.includes("gaps")) return "gaps";

    // Check for .snapshot-scope file
    try {
      const scopeFile = join(cwd, ".snapshot-scope");
      const scope = readFileSync(scopeFile, "utf-8").trim();
      if (isKnownScope(scope)) return scope;
    } catch {
      // ignore missing file
    }
  }

  return "data-plane";
}
