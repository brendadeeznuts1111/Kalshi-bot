import type { ResearchRun } from "../research/types.ts";
import type { RunSummary } from "../research/cache.ts";
import type { PulseTick } from "./pulse-log.ts";
import type { DashboardState } from "./dashboard-state.ts";
import { resolveAuditExportTier } from "../research/audit-adapter.ts";
import { buildRepoReport } from "../research/evidence.ts";
import { shortlistTagCoverage } from "../research/diversify.ts";
import { escapeHtml, renderScoredTable } from "../research/views.ts";
import { formatGateMissHtml } from "../research/gate-miss.ts";
import { DEFAULT_MAX_PER_TAG, MAX_QUALITY_SCORE } from "../research/constants.ts";
import { localRepoPath } from "../research/patterns.ts";
import { pulseLogPath, pulseLogExists, resolveRotorRoot } from "./pulse-log.ts";
import { loadLatestDashboardScreenshot, renderAuditEvidenceSection } from "./dashboard-screenshot.ts";
import {
  readBlueprintMarkdown,
  readDimensionDiffMarkdown,
  readDimensionReportMarkdown,
  renderMarkdownBody,
} from "./dashboard-report.ts";
import {
  formatRateLimitFootprintLine,
  readCacheFallbackFootprint,
  type RateLimitFootprint,
} from "./dashboard-telemetry.ts";
import {
  renderMainFragment,
  renderOperatorShell,
  type DimensionOption,
} from "./dashboard-layout.ts";
import { DASHBOARD_ROUTES, type DashboardViewId } from "./dashboard-views-routes.ts";
import { loadLatestRunFromDb } from "../research/cache.ts";
import { loadDimensionsFile, listDimensionIds, runDimension } from "../research/dimensions.ts";
import { getDashboardState, isResearchBusy } from "./dashboard-state.ts";

export { DASHBOARD_ROUTES } from "./dashboard-views-routes.ts";
export type { DashboardViewId } from "./dashboard-views-routes.ts";

function renderPulseTable(ticks: PulseTick[], logExists: boolean): string {
  if (!logExists) {
    return `<p class="pulse-bad"><strong>Pulse daemon not detected.</strong> No <code>${escapeHtml(pulseLogPath())}</code> yet. Start it: <code>cd ${escapeHtml(resolveRotorRoot())} && bun run pulse:start</code></p>`;
  }
  if (!ticks.length) {
    return `<p><em>Pulse log exists but has no ticks yet. Waiting for first integrity pass…</em></p>`;
  }
  const rows = [...ticks]
    .reverse()
    .map((t) => {
      const cls = t.ok ? "pulse-ok" : "pulse-bad";
      const err = t.errorCount > 0 ? escapeHtml(t.errors.join("; ")) : "—";
      return `<tr>
        <td>${escapeHtml(t.ts)}</td>
        <td class="${cls}">${t.ok ? "ok" : "fail"}</td>
        <td>${t.findings}</td>
        <td>${t.concepts}</td>
        <td>${t.elapsedMs}ms</td>
        <td>${err}</td>
      </tr>`;
    })
    .join("\n");
  return `<p>Log: <code>${escapeHtml(pulseLogPath())}</code></p>
  <table>
    <thead><tr><th>Time (UTC)</th><th>Status</th><th>Findings</th><th>Concepts</th><th>Elapsed</th><th>Errors</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderGateMissSection(run: ResearchRun): string {
  if (!run.gateMiss) return "";
  return formatGateMissHtml(run.gateMiss, run.config.gate, {
    escapeHtml,
    screenshotRoute: DASHBOARD_ROUTES.screenshot,
  });
}

function renderShortlistWithAudit(run: ResearchRun): string {
  const items = run.shortlist
    .map((item, i) => {
      const report = item.report ?? buildRepoReport(item, run.generatedAt);
      const tier = resolveAuditExportTier(report);
      const lic = item.repo.license.unlicensed ? ' <span class="warn">UNLICENSED</span>' : "";
      const href = localRepoPath(item.repo.owner, item.repo.name);
      const tierLabel =
        tier === "high-value"
          ? `<span class="hv-yes">high-value export</span>`
          : tier === "watchlist"
            ? `<span class="hv-watchlist">watchlist export</span>`
            : `<span class="hv-no">below threshold</span>`;
      return `<li><a href="${href}">${i + 1}. ${escapeHtml(item.repo.fullName)}</a> — ${item.score.total}/${MAX_QUALITY_SCORE} · ${tierLabel}${lic}</li>`;
    })
    .join("\n");
  return `<ol>${items || "<li>empty</li>"}</ol>`;
}

function renderTagCoverage(run: ResearchRun): string {
  const rows = shortlistTagCoverage(run.shortlist, DEFAULT_MAX_PER_TAG);
  if (!rows.length) return "<p><em>No strategy tags in shortlist.</em></p>";
  const body = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.tag)}</td><td>${r.count}</td><td>${r.cap}</td><td>${r.atCap ? "yes" : "no"}</td></tr>`,
    )
    .join("\n");
  return `<table>
    <thead><tr><th>Tag</th><th>Count</th><th>Cap</th><th>At cap</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

/** Machine-readable SSOT for agent verify-dashboard (WebView evaluate). */
export function renderAgentDashboardMeta(run: ResearchRun): string {
  const payload = {
    runId: run.runId,
    generatedAt: run.generatedAt,
    shortlist: run.shortlist.length,
    stats: run.stats,
    dimension: runDimension(run),
  };
  return `<script type="application/json" id="agent-dashboard-meta">${JSON.stringify(payload)}</script>`;
}

export async function loadDimensionOptions(): Promise<DimensionOption[]> {
  const file = await loadDimensionsFile();
  return listDimensionIds(file).map((id) => ({
    id,
    label: file.dimensions[id]?.label ?? id,
  }));
}

export type DashboardRenderContext = {
  view: DashboardViewId;
  dimension: string;
  dimensions: DimensionOption[];
  state: DashboardState;
  run: ResearchRun | null;
  runs: RunSummary[];
  pulseTicks: PulseTick[];
  pulseLogPresent: boolean;
  rateLimit: RateLimitFootprint | null;
};

export async function buildDashboardRenderContext(options: {
  view: DashboardViewId;
  dimension: string;
  runs?: RunSummary[];
  pulseTicks?: PulseTick[];
  pulseLogPresent?: boolean;
  rateLimit?: RateLimitFootprint | null;
}): Promise<DashboardRenderContext> {
  const dimensions = await loadDimensionOptions();
  const run = loadLatestRunFromDb({ dimension: options.dimension, includeFixtures: false })
    ?? loadLatestRunFromDb({ includeFixtures: false });
  return {
    view: options.view,
    dimension: options.dimension,
    dimensions,
    state: getDashboardState(),
    run,
    runs: options.runs ?? [],
    pulseTicks: options.pulseTicks ?? [],
    pulseLogPresent: options.pulseLogPresent ?? false,
    rateLimit: options.rateLimit ?? null,
  };
}

function footerLines(ctx: DashboardRenderContext, pulseTicks: PulseTick[]): {
  rateLimitLine: string;
  pulseLine: string;
  cacheLine: string | null;
} {
  const cache = readCacheFallbackFootprint();
  const pulse = pulseTicks.at(-1);
  const pulseLine = pulse
    ? `Pulse: ${pulse.ok ? "ok" : "FAIL"} · ${pulse.findings} findings · ${pulse.ts}`
    : "Pulse: no ticks";
  return {
    rateLimitLine: formatRateLimitFootprintLine(ctx.rateLimit),
    pulseLine,
    cacheLine: cache.degradedHint,
  };
}

export function renderOverviewContent(
  ctx: DashboardRenderContext,
  auditEvidence: Awaited<ReturnType<typeof loadLatestDashboardScreenshot>>,
): string {
  const { run, runs, dimension } = ctx;
  if (!run) {
    return `<h2 class="view-heading">Overview</h2>
      <p>No research runs yet for dimension <code>${escapeHtml(dimension)}</code>. Click <strong>Run research</strong> or run <code>bun run research -- --dimension=${escapeHtml(dimension)}</code>.</p>
      <h2>Rotor pulse</h2>
      ${renderPulseTable(ctx.pulseTicks, ctx.pulseLogPresent)}
      ${renderAuditEvidenceSection(auditEvidence)}`;
  }

  const diffNote =
    runDimension(run) !== dimension
      ? `<p><em>Showing latest run for <code>${escapeHtml(runDimension(run))}</code> — no run stored for <code>${escapeHtml(dimension)}</code> yet.</em></p>`
      : "";

  const runHistory = runs
    .filter((r) => r.dimension === dimension)
    .map(
      (r) =>
        `<li><code>${escapeHtml(r.runId)}</code> · ${escapeHtml(r.generatedAt)} · shortlist ${r.shortlist}</li>`,
    )
    .join("\n");

  return `<h2 class="view-heading">Overview · ${escapeHtml(dimension)}</h2>
  ${diffNote}
  <p>Run <code>${escapeHtml(run.runId)}</code> · ${escapeHtml(run.generatedAt)}</p>
  <div class="stats">
    <div class="stat"><strong>${run.stats.discovered}</strong> discovered</div>
    <div class="stat"><strong>${run.stats.gated}</strong> gated</div>
    <div class="stat"><strong>${run.stats.inspected}</strong> inspected</div>
    <div class="stat"><strong>${run.stats.shortlist}</strong> shortlisted</div>
  </div>
  ${renderGateMissSection(run)}
  <h2>Shortlist (${run.shortlist.length})</h2>
  ${renderShortlistWithAudit(run)}
  <h2>Tag coverage</h2>
  ${renderTagCoverage(run)}
  <h2>All scored</h2>
  ${renderScoredTable(run)}
  <h2>Run history (${escapeHtml(dimension)})</h2>
  <ul>${runHistory || "<li>none</li>"}</ul>
  ${renderAgentDashboardMeta(run)}
  ${renderAuditEvidenceSection(auditEvidence)}`;
}

export async function renderReportContent(dimension: string): Promise<string> {
  const markdown = await readDimensionReportMarkdown(dimension);
  if (!markdown) {
    return `<h2 class="view-heading">Report · ${escapeHtml(dimension)}</h2>
<p><em>No report for this dimension yet.</em> Run research with <code>--dimension=${escapeHtml(dimension)}</code>.</p>`;
  }
  return `<h2 class="view-heading">Report · ${escapeHtml(dimension)}</h2>
${renderMarkdownBody(markdown)}`;
}

export async function renderDiffContent(dimension: string): Promise<string> {
  const markdown = await readDimensionDiffMarkdown(dimension);
  if (!markdown) {
    return `<h2 class="view-heading">Diff · ${escapeHtml(dimension)}</h2>
<p><em>No diff report for this dimension yet.</em></p>`;
  }
  return `<h2 class="view-heading">Diff · ${escapeHtml(dimension)}</h2>
${renderMarkdownBody(markdown)}`;
}

export async function renderBlueprintContent(): Promise<string> {
  const markdown = await readBlueprintMarkdown();
  if (!markdown) {
    return `<h2 class="view-heading">Blueprint</h2>
<p><em>No architecture blueprint yet.</em> Generate with <code>bun run agent blueprint</code>.</p>`;
  }
  return `<h2 class="view-heading">Architecture blueprint</h2>
${renderMarkdownBody(markdown)}`;
}

export function renderPulseContent(ctx: DashboardRenderContext): string {
  return `<h2 class="view-heading">Rotor pulse</h2>
${renderPulseTable(ctx.pulseTicks, ctx.pulseLogPresent)}`;
}

async function renderViewMain(ctx: DashboardRenderContext): Promise<string> {
  switch (ctx.view) {
    case "report":
      return renderReportContent(ctx.dimension);
    case "diff":
      return renderDiffContent(ctx.dimension);
    case "blueprint":
      return renderBlueprintContent();
    case "pulse":
      return renderPulseContent(ctx);
    default:
      return renderOverviewContent(ctx, await loadLatestDashboardScreenshot());
  }
}

export async function renderDashboardPage(
  ctx: DashboardRenderContext,
  options: { partial?: boolean } = {},
): Promise<string> {
  const mainHtml = await renderViewMain(ctx);
  const footer = footerLines(ctx, ctx.pulseTicks);
  const runLabel = ctx.run?.runId ?? null;

  if (options.partial) {
    return renderMainFragment(ctx.view, ctx.dimension, mainHtml);
  }

  return renderOperatorShell({
    activeView: ctx.view,
    dimension: ctx.dimension,
    dimensions: ctx.dimensions,
    state: ctx.state,
    runLabel,
    mainHtml,
    footer,
    busy: isResearchBusy(),
  });
}

/** @deprecated use dashboardLayout via renderDashboardPage */
export function dashboardLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body>${body}</body>
</html>`;
}
