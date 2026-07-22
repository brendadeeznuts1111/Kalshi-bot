// @see https://bun.com/docs/runtime/html-rewriter
import type { ResearchRun, ScoredRepo } from "./types.ts";
import type { RunSummary } from "./cache.ts";
import { buildRepoReport } from "./evidence.ts";
import { shortlistTagCoverage } from "./diversify.ts";
import { githubRepoWebUrl, localRepoPath, ROUTES } from "./patterns.ts";
import { DEFAULT_MAX_PER_TAG, MAX_QUALITY_SCORE } from "./constants.ts";

function reportFor(item: ScoredRepo) {
  return item.report ?? buildRepoReport(item);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const STYLES = `
  :root { font-family: system-ui, sans-serif; line-height: 1.5; color: #111; background: #fafafa; }
  body { max-width: 52rem; margin: 0 auto; padding: 1.5rem; }
  a { color: #0969da; }
  nav { margin-bottom: 1.5rem; font-size: 0.9rem; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; margin: 1rem 0; }
  .stat { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 0.75rem; }
  .stat strong { display: block; font-size: 1.25rem; }
  .warn { background: #fff8e1; border: 1px solid #f0c040; padding: 0.75rem; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; background: #fff; }
  th, td { border: 1px solid #ddd; padding: 0.4rem 0.6rem; text-align: left; }
  th { background: #f0f0f0; }
  pre.diff { background: #fff; border: 1px solid #ddd; padding: 1rem; overflow-x: auto; font-size: 0.85rem; }
  .score-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; }
  .score-grid div { background: #fff; border: 1px solid #eee; padding: 0.5rem; border-radius: 4px; }
  ul.checks { list-style: none; padding: 0; }
  ul.checks li::before { content: "✓ "; color: #1a7f37; }
  ul.checks li.no::before { content: "✗ "; color: #cf222e; }
`;

export function pageLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${STYLES}</style>
</head>
<body>${body}</body>
</html>`;
}

function navLinks(): string {
  return `<nav>
    <a href="${ROUTES.home}">Home</a>
    · <a href="${ROUTES.latestReport}">latest.md</a>
    · <a href="${ROUTES.runsList}">runs.json</a>
  </nav>`;
}

export function renderIndex(run: ResearchRun, runs: RunSummary[], diffMd: string | null): string {
  const shortlist = run.shortlist
    .map((item, i) => {
      const lic = item.repo.license.unlicensed ? ' <span class="warn">UNLICENSED</span>' : "";
      const href = localRepoPath(item.repo.owner, item.repo.name);
      return `<li><a href="${href}">${i + 1}. ${escapeHtml(item.repo.fullName)}</a> — ${item.score.total}/${MAX_QUALITY_SCORE}${lic}</li>`;
    })
    .join("\n");

  const runHistory = runs
    .map(
      (r) =>
        `<li><code>${escapeHtml(r.runId)}</code> · ${escapeHtml(r.generatedAt)} · shortlist ${r.shortlist} · <a href="/api/runs/${encodeURIComponent(r.runId)}">json</a></li>`,
    )
    .join("\n");

  const diffBlock = diffMd
    ? `<h2>Latest diff</h2><pre class="diff">${escapeHtml(diffMd)}</pre>`
    : "";

  const body = `${navLinks()}
  <h1>Kalshi Bot Research</h1>
  <p>Latest run <code>${escapeHtml(run.runId)}</code> · ${escapeHtml(run.generatedAt)}</p>
  <div class="stats">
    <div class="stat"><strong>${run.stats.discovered}</strong> discovered</div>
    <div class="stat"><strong>${run.stats.gated}</strong> gated</div>
    <div class="stat"><strong>${run.stats.inspected}</strong> inspected</div>
    <div class="stat"><strong>${run.stats.shortlist}</strong> shortlisted</div>
  </div>
  <h2>Shortlist (${run.shortlist.length})</h2>
  <ol>${shortlist || "<li>empty</li>"}</ol>
  <h2>Tag coverage</h2>
  ${renderTagCoverageTable(run)}
  <h2>All scored</h2>
  ${renderScoredTable(run)}
  ${diffBlock}
  <h2>Run history</h2>
  <ul>${runHistory || "<li>none</li>"}</ul>`;

  return pageLayout("Kalshi Bot Research", body);
}

function renderTagCoverageTable(run: ResearchRun): string {
  const rows = shortlistTagCoverage(run.shortlist, DEFAULT_MAX_PER_TAG);
  if (!rows.length) return "<p><em>No strategy tags in shortlist.</em></p>";
  const body = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.tag)}</td><td>${r.count}</td><td>${r.cap}</td><td>${r.atCap ? "yes" : "no"}</td></tr>`,
    )
    .join("\n");
  return `<p>Per-tag cap: <strong>${DEFAULT_MAX_PER_TAG}</strong> (multi-tag repos count toward each tag).</p>
  <table>
    <thead><tr><th>Tag</th><th>Count</th><th>Cap</th><th>At cap</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function signalChecks(item: ScoredRepo): string {
  const s = item.signals;
  const rows = [
    ["Official SDK", s.usesOfficialSdk],
    ["Auth in code", s.hasAuthInCode],
    ["V2 API", s.hasV2Api],
    ["RSA-PSS", s.hasRsaPss],
    ["Live order path", s.hasLiveOrderPath],
    ["Dry-run default", s.hasDryRunDefault],
    ["Tests", s.hasTests],
    ["CI", s.hasCi],
  ];
  return rows
    .map(([label, ok]) => `<li class="${ok ? "" : "no"}">${escapeHtml(String(label))}</li>`)
    .join("\n");
}

export function renderRepoPage(item: ScoredRepo, run: ResearchRun): string {
  const sc = item.score;
  const licWarn = item.repo.license.unlicensed
    ? `<div class="warn"><strong>License warning:</strong> no usable open-source license detected.</div>`
    : "";

  const body = `${navLinks()}
  <h1>${escapeHtml(item.repo.fullName)}</h1>
  <p>Score <strong>${sc.total}/${MAX_QUALITY_SCORE}</strong> · run <code>${escapeHtml(run.runId)}</code></p>
  ${licWarn}
  <p><a href="${escapeHtml(item.repo.htmlUrl)}">GitHub</a></p>
  ${item.repo.description ? `<p>${escapeHtml(item.repo.description)}</p>` : ""}
  <h2>Lift notes</h2>
  <p>${escapeHtml(reportFor(item).liftNotes)}</p>
  <h2>Detectors</h2>
  <ul>${reportFor(item).detectors.map((d) => `<li><strong>${escapeHtml(d.id)}</strong> ${d.pointsContributed}/${d.maxPoints} — ${escapeHtml(d.rationale)}</li>`).join("")}</ul>
  <ul>
    <li>Stars: ${item.repo.stars} · Forks: ${item.repo.forks}</li>
    <li>License: ${escapeHtml(item.repo.license.spdxId ?? item.repo.license.name ?? "unknown")}</li>
    <li>Stack: ${escapeHtml(item.signals.primaryLanguage ?? "unknown")}</li>
    <li>Strategy: ${escapeHtml(item.signals.strategyTags.join(", ") || "none")}</li>
    <li>Last commit: ${escapeHtml(item.signals.lastDefaultBranchCommitAt ?? "unknown")}</li>
  </ul>
  <h2>Score breakdown</h2>
  <div class="score-grid">
    <div>Auth/API: ${sc.authApi}</div>
    <div>Orders: ${sc.orderRealism}</div>
    <div>Tests/CI: ${sc.testsCi}</div>
    <div>Docs: ${sc.docsSetup}</div>
    <div>Maintenance: ${sc.maintenance}</div>
    <div>Risk: ${sc.riskControls}</div>
  </div>
  <h2>Signals</h2>
  <ul class="checks">${signalChecks(item)}</ul>`;

  return pageLayout(item.repo.fullName, body);
}

export function renderScoredTable(run: ResearchRun): string {
  const rows = run.scored
    .filter((s) => !s.signals.isSdkOnly)
    .sort((a, b) => b.score.total - a.score.total)
    .map((s, i) => {
      const local = localRepoPath(s.repo.owner, s.repo.name);
      const gh = githubRepoWebUrl(s.repo.owner, s.repo.name);
      return `<tr>
        <td>${i + 1}</td>
        <td><a href="${local}">${escapeHtml(s.repo.fullName)}</a></td>
        <td>${s.score.total}</td>
        <td><a href="${gh}">gh</a></td>
      </tr>`;
    })
    .join("\n");

  return `<table>
    <thead><tr><th>#</th><th>Repo</th><th>Score</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}
