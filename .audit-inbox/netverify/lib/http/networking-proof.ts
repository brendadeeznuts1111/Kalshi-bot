/**
 * Networking proof artifact schema — reportType discriminant + monitoring adapter.
 *
 * Artifact: public/registry/networking-proof.json
 * @see tools/verify-networking.ts
 */

export const NETWORKING_PROOF_SCHEMA_VERSION = 1 as const;

/** Discriminant for registry proof artifacts (monitoring / health / portal). */
export const NETWORKING_REPORT_TYPES = {
  verification: 'networking-verification',
  routes: 'networking-routes',
} as const;

export type NetworkingReportType =
  (typeof NETWORKING_REPORT_TYPES)[keyof typeof NETWORKING_REPORT_TYPES];

export type NetworkingTargetSummaryWire = {
  coldFetchMs: number;
  warmFetchMs: number;
  reuseEfficiency: number;
  protocol: string;
  compression: string;
  dnsCacheHit: boolean;
  keepAlive: boolean;
  http3: boolean;
  statusCode: number;
  bodySize: number;
};

export type NetworkingProofTargetWire = {
  name: string;
  category: string;
  optimizations: Record<string, { metric: string; status: string; detail?: string }>;
  summary: NetworkingTargetSummaryWire;
  timestamp: string;
};

/** Canonical body hashed by SHA-256 (excludes proofHash). */
export type NetworkingProofBody = {
  schemaVersion: typeof NETWORKING_PROOF_SCHEMA_VERSION;
  reportType: typeof NETWORKING_REPORT_TYPES.verification;
  timestamp: string;
  bunVersion: string;
  bunRevision: string;
  base: string;
  remote: boolean;
  allOk: boolean;
  targets: NetworkingProofTargetWire[];
  global: {
    elapsedMs: number;
    checksPassed: number;
    checksTotal: number;
    dnsCache: Record<string, number>;
  };
};

export type NetworkingProofArtifact = NetworkingProofBody & {
  proofHash: string;
};

/** Monitoring dashboard shape (@see lib/monitoring/collect.ts). */
export type NetworkingMonitoringReport = {
  schemaVersion: number;
  reportType: NetworkingReportType;
  bunVersion: string;
  bunRevision: string;
  timestamp: string;
  base: string;
  totalTargets: number;
  allOk: boolean;
  proofHash: string;
  targets: Array<{
    name: string;
    summary: {
      protocol: string;
      reuseEfficiency: number;
      coldFetchMs: number;
      warmFetchMs: number;
      statusCode: number;
      bodySize: number;
    };
  }>;
};

export function isNetworkingReportType(v: unknown): v is NetworkingReportType {
  return (
    v === NETWORKING_REPORT_TYPES.verification || v === NETWORKING_REPORT_TYPES.routes
  );
}

export function toMonitoringNetworkingReport(
  artifact: NetworkingProofArtifact
): NetworkingMonitoringReport {
  return {
    schemaVersion: artifact.schemaVersion,
    reportType: artifact.reportType,
    bunVersion: artifact.bunVersion,
    bunRevision: artifact.bunRevision,
    timestamp: artifact.timestamp,
    base: artifact.base,
    totalTargets: artifact.targets.length,
    allOk: artifact.allOk,
    proofHash: artifact.proofHash,
    targets: artifact.targets.map(t => ({
      name: t.name,
      summary: {
        protocol: t.summary.protocol,
        reuseEfficiency: t.summary.reuseEfficiency,
        coldFetchMs: t.summary.coldFetchMs,
        warmFetchMs: t.summary.warmFetchMs,
        statusCode: t.summary.statusCode,
        bodySize: t.summary.bodySize,
      },
    })),
  };
}

/** Parse saved artifact; returns null when shape is unusable. */
export function parseNetworkingProofArtifact(raw: unknown): NetworkingProofArtifact | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.proofHash !== 'string') return null;
  if (o.schemaVersion !== NETWORKING_PROOF_SCHEMA_VERSION) return null;
  if (!isNetworkingReportType(o.reportType)) return null;
  if (!Array.isArray(o.targets)) return null;
  return raw as NetworkingProofArtifact;
}
