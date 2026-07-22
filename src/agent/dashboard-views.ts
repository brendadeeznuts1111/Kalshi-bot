import type { ResearchRun } from "../research/types.ts";
import type { RunSummary } from "../research/cache.ts";
import type { PulseTick } from "./pulse-log.ts";
import type { DashboardState } from "./dashboard-state.ts";
import { resolveAuditExportTier } from "../research/audit-adapter.ts";
import { buildRepoReport } from "../research/evidence.ts";
import { shortlistTagCoverage } from "../research/diversify.ts";
import { escapeHtml, renderScoredTable, STYLES } from "../research/views.ts";
import { DEFAULT_MAX_PER_TAG, MAX_QUALITY_SCORE } from "../research/constants.ts";
import { localRepoPath, ROUTES } from "../research/patterns.ts";
import { pulseLogPath, readPulseLog, pulseLogExists, resolveRotorRoot } from "./pulse-log.ts";

export const DASHBOARD_ROUTES = {
  home: "/",
  status: "/api/status",
  runResearch: "/api/research/run",
  pulse: "/api/pulse",
} as const;

const DASHBOARD_STYLES = `
  ${STYLES}
  .toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin: 1rem 0; }
  button.action { font: inherit; padding: 0.45rem 0.9rem; border-radius: 6px; border: 1px solid #0969da; background: #0969da; color: #fff; cursor: pointer; }
  button.action:disabled { opacity: 0.55; cursor: wait; }
  button.action.secondary { background: #fff; color: #0969da; }
  .banner { padding: 0.75rem; border-radius: 6px; margin: 0.75rem 0; }
  .banner.busy { background: #eef6ff; border: 1px solid #54aeff; }
  .banner.error { background: #ffebe9; border: 1px solid #ff8182; }
  .banner.ok { background: #dafbe1; border: 1px solid #4ac26b; }
  .pulse-ok { color: #1a7f37; }
  .pulse-bad { color: #cf222e; }
  .hv-yes { color: #1a7f37; font-weight: 600; }
  .hv-watchlist { color: #9a6700; font-weight: 600; }
  .hv-no { color: #656d76; }
  iframe.report { width: 100%; height: 28rem; border: 1px solid #ddd; border-radius: 6px; background: #fff; }
`;

function navLinks(): string {
  return `<nav>
    <a href="${DASHBOARD_ROUTES.home}">Dashboard</a>
    · <a href="${ROUTES.latestReport}" target="_blank">latest.md</a>
    · <a href="${ROUTES.runsList}">runs.json</a>
  </nav>`;
}

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

function statusBanner(state: DashboardState): string {
  if (state.phase === "running-research") {
    return `<div class="banner busy" id="status-banner"><strong>Running research…</strong> ${escapeHtml(state.message ?? "")}</div>`;
  }
  if (state.phase === "error") {
    return `<div class="banner error" id="status-banner"><strong>Error</strong> — ${escapeHtml(state.message ?? "unknown")}</div>`;
  }
  if (state.message) {
    return `<div class="banner ok" id="status-banner">${escapeHtml(state.message)}</div>`;
  }
  return `<div class="banner ok" id="status-banner">Ready.</div>`;
}

/** Machine-readable SSOT for agent verify-dashboard (WebView evaluate). */
export function renderAgentDashboardMeta(run: ResearchRun): string {
  const payload = {
    runId: run.runId,
    generatedAt: run.generatedAt,
    shortlist: run.shortlist.length,
    stats: run.stats,
  };
  return `<script type="application/json" id="agent-dashboard-meta">${JSON.stringify(payload)}</script>`;
}

export function renderDashboardPage(
  run: ResearchRun | null,
  runs: RunSummary[],
  diffMd: string | null,
  state: DashboardState,
  pulseTicks: PulseTick[],
  pulseLogPresent: boolean,
): string {
  if (!run) {
    const body = `${navLinks()}
      <h1>Kalshi Agent Dashboard</h1>
      ${statusBanner(state)}
      <div class="toolbar">
        <button class="action" id="run-research" type="button">Run research</button>
        <button class="action secondary" id="refresh-status" type="button">Refresh</button>
      </div>
      <p>No research runs yet. Click <strong>Run research</strong> or run <code>bun run research</code>.</p>
      <h2>Rotor pulse</h2>
      ${renderPulseTable(pulseTicks, pulseLogPresent)}
      ${dashboardClientScript(state.phase === "running-research")}`;
    return dashboardLayout("Kalshi Agent Dashboard", body);
  }

  const diffBlock = diffMd
    ? `<h2>Latest diff</h2><pre class="diff">${escapeHtml(diffMd)}</pre>`
    : "";

  const runHistory = runs
    .map(
      (r) =>
        `<li><code>${escapeHtml(r.runId)}</code> · ${escapeHtml(r.generatedAt)} · shortlist ${r.shortlist}</li>`,
    )
    .join("\n");

  const body = `${navLinks()}
  <h1>Kalshi Agent Dashboard</h1>
  <p>Latest run <code>${escapeHtml(run.runId)}</code> · ${escapeHtml(run.generatedAt)}</p>
  ${statusBanner(state)}
  <div class="toolbar">
    <button class="action" id="run-research" type="button"${state.phase === "running-research" ? " disabled" : ""}>${state.phase === "running-research" ? "Running research…" : "Run research"}</button>
    <button class="action secondary" id="refresh-status" type="button">Refresh</button>
    <a class="action secondary" href="${ROUTES.latestReport}" target="_blank" style="text-decoration:none;display:inline-block;">Open latest.md</a>
  </div>
  <div class="stats">
    <div class="stat"><strong>${run.stats.discovered}</strong> discovered</div>
    <div class="stat"><strong>${run.stats.gated}</strong> gated</div>
    <div class="stat"><strong>${run.stats.inspected}</strong> inspected</div>
    <div class="stat"><strong>${run.stats.shortlist}</strong> shortlisted</div>
  </div>
  <h2>Shortlist (${run.shortlist.length})</h2>
  ${renderShortlistWithAudit(run)}
  <h2>Tag coverage</h2>
  ${renderTagCoverage(run)}
  <h2>All scored</h2>
  ${renderScoredTable(run)}
  <h2>Report preview</h2>
  <iframe class="report" src="${ROUTES.latestReport}" title="latest report"></iframe>
  ${diffBlock}
  <h2>Run history</h2>
  <ul>${runHistory || "<li>none</li>"}</ul>
  <h2>Rotor pulse</h2>
  ${renderPulseTable(pulseTicks, pulseLogPresent)}
  ${renderAgentDashboardMeta(run)}
  ${dashboardClientScript(state.phase === "running-research")}`;

  return dashboardLayout("Kalshi Agent Dashboard", body);
}

function dashboardClientScript(busy: boolean): string {
  return `<script>
(function () {
  const busy = ${busy ? "true" : "false"};
  const runBtn = document.getElementById("run-research");
  const refreshBtn = document.getElementById("refresh-status");

  async function pollWhileBusy() {
    while (true) {
      const res = await fetch("${DASHBOARD_ROUTES.status}");
      const data = await res.json();
      if (data.state?.phase !== "running-research") {
        location.reload();
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  if (busy) pollWhileBusy();

  runBtn?.addEventListener("click", async () => {
    runBtn.disabled = true;
    runBtn.textContent = "Running research…";
    const banner = document.getElementById("status-banner");
    if (banner) {
      banner.className = "banner busy";
      banner.innerHTML = "<strong>Running research…</strong> This may take several minutes.";
    }
    try {
      const res = await fetch("${DASHBOARD_ROUTES.runResearch}", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || res.statusText);
      location.reload();
    } catch (err) {
      if (banner) {
        banner.className = "banner error";
        banner.innerHTML = "<strong>Error</strong> — " + String(err.message || err);
      }
      runBtn.disabled = false;
      runBtn.textContent = "Run research";
    }
  });

  refreshBtn?.addEventListener("click", () => location.reload());
})();
</script>`;
}

export function dashboardLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${DASHBOARD_STYLES}</style>
</head>
<body>${body}</body>
</html>`;
}
