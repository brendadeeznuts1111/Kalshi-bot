/**
 * Phase 3 — cross-dimension agent summary for architecture decisions.
 */
import type { ResearchRun } from "../research/types.ts";
import { loadResearchRun } from "../research/cache.ts";
import {
  loadDimensionsFile,
  listDimensionIds,
  runDimension,
  type DimensionsFile,
} from "../research/dimensions.ts";
import { buildRotorVerificationIndex, lookupRepoVerification } from "./audit-list.ts";
import { formatVerificationBadge } from "./audit-list.ts";
import { resolveAuditExportTier } from "../research/audit-adapter.ts";
import { buildRepoReport } from "../research/evidence.ts";
import { loadPatternReport, formatPatternSummary } from "./pattern-extract.ts";
import { joinPath, RESEARCH_ROOT } from "../research/paths.ts";

export type DimensionSummary = {
  dimension: string;
  label: string;
  runId: string | null;
  generatedAt: string | null;
  stats: ResearchRun["stats"] | null;
  shortlist: Array<{
    fullName: string;
    total: number;
    verification: string;
    auditTier: string | null;
    topPattern: string | null;
  }>;
  notes: string[];
};

export type AgentReport = {
  generatedAt: string;
  dimensions: DimensionSummary[];
  architectureNotes: string[];
};

const ARCHITECTURE_DIMENSIONS = [
  "market-making",
  "arbitrage",
  "price-data",
  "wallet-track",
  "tracking",
  "sports-nba",
  "sports-elections",
  "sports-macro",
] as const;

export function selectReportDimensions(
  file: DimensionsFile,
  filter?: string,
): Array<{ id: string; label: string }> {
  if (filter?.trim()) {
    const id = filter.trim();
    const def = file.dimensions[id];
    if (!def) throw new Error(`Unknown dimension: ${id}`);
    return [{ id, label: def.label }];
  }
  const ids = listDimensionIds(file).filter(
    (id) => id !== "all" && (ARCHITECTURE_DIMENSIONS as readonly string[]).includes(id),
  );
  return ids.map((id) => ({ id, label: file.dimensions[id]!.label }));
}

async function topPatternForRepo(
  dimension: string,
  fullName: string,
): Promise<string | null> {
  const report = await loadPatternReport(dimension);
  const repo = report?.repos.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
  if (!repo) return null;
  const labels = [
    ...repo.summary.auth,
    ...repo.summary.orders,
    ...repo.summary.dryRun,
  ].slice(0, 4);
  return labels.length ? formatPatternSummary(labels) : null;
}

export async function buildAgentReport(options?: {
  dimension?: string;
  runId?: string;
}): Promise<AgentReport> {
  const file = await loadDimensionsFile();
  const dims = selectReportDimensions(file, options?.dimension);
  const rotor = await buildRotorVerificationIndex();
  const dimensions: DimensionSummary[] = [];
  const architectureNotes: string[] = [];

  for (const { id, label } of dims) {
    const run = loadResearchRun({ dimension: id, runId: options?.runId });
    const notes: string[] = [];
    if (!run) {
      dimensions.push({
        dimension: id,
        label,
        runId: null,
        generatedAt: null,
        stats: null,
        shortlist: [],
        notes: ["No cached run — run: bun run research -- --dimension=" + id],
      });
      continue;
    }

    if (!run.shortlist.length) {
      notes.push(
        run.stats.discovered > 0
          ? "Discovered repos but none passed gate/shortlist — try --min-stars=2 or refine queries"
          : "Zero discovery — broaden dimension queries",
      );
    }

    const shortlist = await Promise.all(
      run.shortlist.slice(0, 3).map(async (item) => {
        const report = item.report ?? buildRepoReport(item, run.generatedAt);
        const tier = resolveAuditExportTier(report);
        const rotorStatus = lookupRepoVerification(rotor, item.repo.fullName);
        const badge = formatVerificationBadge({
          verified: rotorStatus.verified,
          verification: rotorStatus.verification,
          auditTier: tier,
        });
        const topPattern = await topPatternForRepo(id, item.repo.fullName);
        return {
          fullName: item.repo.fullName,
          total: item.score.total,
          verification: badge,
          auditTier: tier,
          topPattern,
        };
      }),
    );

    dimensions.push({
      dimension: id,
      label,
      runId: run.runId,
      generatedAt: run.generatedAt,
      stats: run.stats,
      shortlist,
      notes,
    });

    if (shortlist.length && shortlist[0]!.auditTier === "watchlist") {
      architectureNotes.push(
        `${label}: lift candidate ${shortlist[0]!.fullName} (${shortlist[0]!.total}) — watchlist tier`,
      );
    }
  }

  const withCandidates = dimensions.filter((d) => d.shortlist.length);
  if (withCandidates.length >= 2) {
    architectureNotes.push(
      "Composite bot: mix component lifts across dimensions (see suggest-lift per dimension).",
    );
  }

  if (rotor.warning) architectureNotes.push(rotor.warning);

  return {
    generatedAt: new Date().toISOString(),
    dimensions,
    architectureNotes,
  };
}

export function formatAgentReportMarkdown(report: AgentReport): string {
  const lines: string[] = [
    "# Kalshi agent report — dimension architecture",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "Cross-dimension summary for bot architecture decisions. Pair with `agent suggest-lift` and `agent patterns` per dimension.",
    "",
  ];

  for (const dim of report.dimensions) {
    lines.push(`## ${dim.label} (\`${dim.dimension}\`)`, "");
    if (!dim.runId) {
      for (const n of dim.notes) lines.push(`_${n}_`, "");
      continue;
    }
    lines.push(
      `Run: \`${dim.runId}\` · ${dim.generatedAt ?? "—"}`,
      `Discovered ${dim.stats?.discovered ?? 0} → gated ${dim.stats?.gated ?? 0} → shortlist ${dim.stats?.shortlist ?? 0}`,
      "",
    );
    if (!dim.shortlist.length) {
      for (const n of dim.notes) lines.push(`_${n}_`, "");
      continue;
    }
    for (const s of dim.shortlist) {
      lines.push(`- **${s.fullName}** — ${s.total} — ${s.verification}`);
      if (s.topPattern) lines.push(`  - pattern: ${s.topPattern}`);
    }
    lines.push("");
  }

  if (report.architectureNotes.length) {
    lines.push("## Architecture notes", "");
    for (const n of report.architectureNotes) lines.push(`- ${n}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function writeAgentReport(
  report: AgentReport,
  dimension?: string,
): Promise<string> {
  const base = dimension?.trim()
    ? `agent-report-${dimension.trim()}`
    : "agent-report";
  const mdPath = joinPath(RESEARCH_ROOT, "reports", `${base}.md`);
  const jsonPath = joinPath(RESEARCH_ROOT, "reports", `${base}.json`);
  await Bun.write(mdPath, formatAgentReportMarkdown(report));
  await Bun.write(jsonPath, JSON.stringify(report, null, 2));
  return mdPath;
}

export async function runAgentReport(options: {
  json?: boolean;
  dimension?: string;
  runId?: string;
  write?: boolean;
}): Promise<AgentReport> {
  const report = await buildAgentReport({
    dimension: options.dimension,
    runId: options.runId,
  });
  if (options.write !== false && !options.json) {
    await writeAgentReport(report, options.dimension);
  }
  return report;
}
