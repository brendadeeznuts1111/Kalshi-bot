// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
/**
 * Rotor audit catalog cross-reference for the agent CLI.
 *
 * Reads `tools/audit-catalog.json` under `ROTOR_ROOT` (plain JSON — no monorepo imports).
 * Maps Kalshi-bot shortlist repos to pulse-verified findings for `audit-list` and `suggest-lift`.
 */
import type { ResearchRun } from "../research/types.ts";
import { joinPath } from "../research/paths.ts";
import { buildRepoReport } from "../research/evidence.ts";
import {
  resolveAuditExportTier,
  type AuditExportTier,
} from "../research/audit-adapter.ts";
import { runDimension } from "../research/dimensions.ts";
import { loadResearchRun } from "../research/cache.ts";
import { latestPulseTick, resolveRotorRoot, type PulseTick } from "./pulse-log.ts";

const KALSHI_FINDING_TITLE_PREFIX = "Kalshi bot candidate: ";

export type VerificationStatus = "verified" | "watchlist" | "unverified";

export type AuditCatalogFindingWire = {
  id: string;
  kind: string;
  title: string;
  status: string;
  meta?: { emitter?: string; tier?: string };
};

export type AuditCatalogWire = {
  generated?: string;
  findings: AuditCatalogFindingWire[];
};

export type RepoVerification = {
  verified: boolean;
  verification: VerificationStatus;
  findingId: string | null;
  inCatalog: boolean;
  pulseOk: boolean | null;
  exportTier: AuditExportTier | "unverified" | null;
};

export type AuditListEntry = {
  fullName: string;
  score: number;
  auditTier: AuditExportTier | null;
  verification: VerificationStatus;
  verified: boolean;
  findingId: string | null;
  pulseOk: boolean | null;
};

export type AuditListResult = {
  runId: string;
  generatedAt: string;
  dimension: string;
  catalogPath: string;
  catalogAvailable: boolean;
  catalogGenerated: string | null;
  pulseOk: boolean | null;
  warning: string | null;
  entries: AuditListEntry[];
};

export type RotorVerificationContext = {
  byRepo: Map<string, RepoVerification>;
  catalogAvailable: boolean;
  catalogGenerated: string | null;
  pulseOk: boolean | null;
  warning: string | null;
};

export type AuditListDeps = {
  catalogPath?: string;
  loadCatalog?: () => Promise<AuditCatalogWire | null>;
  latestPulse?: () => Promise<PulseTick | null>;
  readFindingTier?: (findingId: string) => Promise<AuditExportTier | null>;
};

export function auditCatalogPath(): string {
  const explicit = Bun.env.AUDIT_CATALOG_PATH?.trim();
  if (explicit) return explicit;
  return joinPath(resolveRotorRoot(), "tools/audit-catalog.json");
}

export function normalizeRepoKey(fullName: string): string {
  return fullName.trim().toLowerCase();
}

export function fullNameFromKalshiFinding(finding: AuditCatalogFindingWire): string | null {
  if (finding.title.startsWith(KALSHI_FINDING_TITLE_PREFIX)) {
    return finding.title.slice(KALSHI_FINDING_TITLE_PREFIX.length).trim();
  }
  return null;
}

export function isKalshiBotFinding(finding: AuditCatalogFindingWire): boolean {
  return (
    finding.meta?.emitter === "kalshi-bot-research" ||
    finding.id.startsWith("kalshi-repo-")
  );
}

export function resolveExportTierFromFinding(
  finding: AuditCatalogFindingWire,
  tierFromSource: AuditExportTier | null,
): AuditExportTier | null {
  if (tierFromSource) return tierFromSource;
  const wireTier = finding.meta?.tier;
  if (wireTier === "watchlist" || wireTier === "high-value") return wireTier;
  return "high-value";
}

export function verificationForRepo(
  inCatalog: boolean,
  exportTier: AuditExportTier | "unverified" | null,
  pulseOk: boolean | null,
): RepoVerification {
  if (!inCatalog || exportTier === "unverified" || exportTier === null) {
    return {
      verified: false,
      verification: "unverified",
      findingId: null,
      inCatalog: false,
      pulseOk,
      exportTier: null,
    };
  }

  if (exportTier === "watchlist") {
    return {
      verified: false,
      verification: "watchlist",
      findingId: null,
      inCatalog: true,
      pulseOk,
      exportTier,
    };
  }

  const verified = pulseOk === true;
  return {
    verified,
    verification: verified ? "verified" : "unverified",
    findingId: null,
    inCatalog: true,
    pulseOk,
    exportTier,
  };
}

export async function defaultReadFindingTier(findingId: string): Promise<AuditExportTier | null> {
  const path = joinPath(resolveRotorRoot(), "tools/audit-findings", `${findingId}.json`);
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    const raw = (await file.json()) as { meta?: { tier?: string } };
    if (raw.meta?.tier === "watchlist") return "watchlist";
    if (raw.meta?.tier === "high-value") return "high-value";
    return null;
  } catch {
    return null;
  }
}

export async function loadAuditCatalogFile(path: string): Promise<AuditCatalogWire | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    const raw = (await file.json()) as AuditCatalogWire;
    if (!Array.isArray(raw.findings)) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function buildRotorVerificationIndex(
  deps: AuditListDeps = {},
): Promise<RotorVerificationContext> {
  const catalogPath = deps.catalogPath ?? auditCatalogPath();
  const loadCatalog = deps.loadCatalog ?? (() => loadAuditCatalogFile(catalogPath));
  const latestPulse = deps.latestPulse ?? latestPulseTick;
  const readFindingTier = deps.readFindingTier ?? defaultReadFindingTier;

  const catalog = await loadCatalog();
  const pulse = await latestPulse();
  const pulseOk = pulse?.ok ?? null;

  if (!catalog) {
    return {
      byRepo: new Map(),
      catalogAvailable: false,
      catalogGenerated: null,
      pulseOk,
      warning: `Rotor audit catalog not found: ${catalogPath}`,
    };
  }

  const byRepo = new Map<string, RepoVerification>();

  for (const finding of catalog.findings) {
    if (!isKalshiBotFinding(finding)) continue;
    const fullName = fullNameFromKalshiFinding(finding);
    if (!fullName) continue;

    const tierFromSource = await readFindingTier(finding.id);
    const exportTier = resolveExportTierFromFinding(finding, tierFromSource);
    const base = verificationForRepo(true, exportTier, pulseOk);
    byRepo.set(normalizeRepoKey(fullName), {
      ...base,
      findingId: finding.id,
      inCatalog: true,
    });
  }

  return {
    byRepo,
    catalogAvailable: true,
    catalogGenerated: catalog.generated ?? null,
    pulseOk,
    warning: null,
  };
}

export function lookupRepoVerification(
  context: RotorVerificationContext | undefined,
  fullName: string,
): RepoVerification {
  if (!context?.catalogAvailable) {
    return {
      verified: false,
      verification: "unverified",
      findingId: null,
      inCatalog: false,
      pulseOk: context?.pulseOk ?? null,
      exportTier: null,
    };
  }
  return (
    context.byRepo.get(normalizeRepoKey(fullName)) ?? {
      verified: false,
      verification: "unverified",
      findingId: null,
      inCatalog: false,
      pulseOk: context.pulseOk,
      exportTier: null,
    }
  );
}

export function buildAuditList(
  run: ResearchRun,
  context: RotorVerificationContext,
  repoFilter?: string,
): AuditListResult {
  const filterKey = repoFilter?.trim() ? normalizeRepoKey(repoFilter.trim()) : null;
  const entries: AuditListEntry[] = [];

  for (const item of run.shortlist) {
    if (filterKey && normalizeRepoKey(item.repo.fullName) !== filterKey) continue;
    const report = item.report ?? buildRepoReport(item, run.generatedAt);
    const auditTier = resolveAuditExportTier(report);
    const rotor = lookupRepoVerification(context, item.repo.fullName);
    entries.push({
      fullName: item.repo.fullName,
      score: item.score.total,
      auditTier,
      verification: rotor.verification,
      verified: rotor.verified,
      findingId: rotor.findingId,
      pulseOk: rotor.pulseOk,
    });
  }

  return {
    runId: run.runId,
    generatedAt: run.generatedAt,
    dimension: runDimension(run),
    catalogPath: auditCatalogPath(),
    catalogAvailable: context.catalogAvailable,
    catalogGenerated: context.catalogGenerated,
    pulseOk: context.pulseOk,
    warning: context.warning,
    entries,
  };
}

export function loadRunForAuditList(runId?: string, dimension?: string): ResearchRun | null {
  return loadResearchRun({ runId, dimension });
}

export async function auditListFromRun(
  run: ResearchRun,
  options?: { repo?: string; deps?: AuditListDeps },
): Promise<AuditListResult> {
  const context = await buildRotorVerificationIndex(options?.deps);
  return buildAuditList(run, context, options?.repo);
}

export function formatVerificationBadge(entry: {
  verified: boolean;
  verification: VerificationStatus;
  auditTier?: AuditExportTier | null;
}): string {
  if (entry.verified) return "✓ verified (high-value)";
  if (entry.verification === "watchlist") return "⚠ watchlist";
  return "✗ unverified";
}

export type VerificationSummary = {
  verified: number;
  watchlist: number;
  unverified: number;
  catalogAvailable: boolean;
  warning: string | null;
};

export function summarizeVerification(entries: AuditListEntry[]): VerificationSummary {
  let verified = 0;
  let watchlist = 0;
  let unverified = 0;
  for (const e of entries) {
    if (e.verified) verified++;
    else if (e.verification === "watchlist") watchlist++;
    else unverified++;
  }
  return {
    verified,
    watchlist,
    unverified,
    catalogAvailable: true,
    warning: null,
  };
}

export async function verificationSummaryForRun(
  run: ResearchRun,
  deps?: AuditListDeps,
): Promise<VerificationSummary> {
  const context = await buildRotorVerificationIndex(deps);
  const entries = buildAuditList(run, context).entries;
  const counts = summarizeVerification(entries);
  return {
    ...counts,
    catalogAvailable: context.catalogAvailable,
    warning: context.warning,
  };
}

export function formatAuditList(result: AuditListResult): string {
  const lines = [
    `Audit list — run ${result.runId} (${result.generatedAt})`,
    `Dimension: ${result.dimension}`,
    `Catalog: ${result.catalogAvailable ? result.catalogPath : "missing"}`,
  ];

  if (result.catalogGenerated) lines.push(`Catalog generated: ${result.catalogGenerated}`);
  if (result.pulseOk !== null) {
    lines.push(`Pulse: ${result.pulseOk ? "ok" : "FAIL"}`);
  }
  if (result.warning) lines.push(`Warning: ${result.warning}`);

  lines.push("", "Shortlist verification:");
  if (!result.entries.length) {
    lines.push("  (no matching shortlist repos)");
  } else {
    for (const e of result.entries) {
      const badge = formatVerificationBadge(e);
      const id = e.findingId ? ` · ${e.findingId}` : "";
      lines.push(`  ${e.fullName} — ${e.score} — ${badge}${id}`);
    }
  }

  return lines.join("\n");
}
