import type { ResearchRun, ScoredRepo } from "./types.ts";
import type { RunSummary } from "./cache.ts";
import { buildRepoReport } from "./evidence.ts";
import { shortlistTagCoverage } from "./diversify.ts";
import { githubRepoWebUrl, localRepoPath, ROUTES } from "./patterns.ts";
import { DEFAULT_MAX_PER_TAG, MAX_QUALITY_SCORE } from "./constants.ts";
import { escapeHtml } from "./bun-native.ts";

export { escapeHtml };

function reportFor(item: ScoredRepo) {
  return item.report ?? buildRepoReport(item);
}

export const STYLES = `
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
  .badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
  .badge.ok { background: #dafbe1; color: #1a7f37; }
  .badge.warn { background: #fff8c5; color: #9a6700; }
  .badge.bad { background: #ffebe9; color: #cf222e; }
  .badge.dim { background: #eaeef2; color: #57606a; }
  .dim { color: #57606a; font-size: 0.85rem; }
  form.ops { display: grid; gap: 0.5rem; max-width: 34rem; margin: 0.5rem 0 1rem; }
  form.ops textarea { font-family: monospace; }
  form.ops button { width: fit-content; padding: 0.3rem 1rem; }
  pre.diff.ok { border-color: #1a7f37; }
  pre.diff.bad { border-color: #cf222e; }
`;

export function pageLayout(title: string, body: string, opts?: { refreshSeconds?: number }): string {
  const refresh = opts?.refreshSeconds
    ? `  <meta http-equiv="refresh" content="${opts.refreshSeconds}" />\n`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
${refresh}  <title>${escapeHtml(title)}</title>
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
    · <a href="/ops">Ops</a>
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

// ── Ops dashboard (/ops) ──

export type OpsCronFlow = {
  label: string;
  logPath: string;
  lastFireAt: string | null; // log mtime ISO
  lastLines: string[];
  launchdLoaded: boolean | null; // null = launchd probe failed
  /** Expected cadence in minutes — drives staleness coloring when present. */
  periodMin?: number;
};

export type OpsDashboardData = {
  generatedAt: string;
  agents: Record<string, boolean>;
  ticks: Array<{
    slug: string;
    yesPrice: number;
    spread: number;
    volume24hr: number;
    timestamp: number;
  }>;
  lineMoves: Array<{
    slug: string;
    direction: string;
    oldPrice: number;
    newPrice: number;
    deltaBp: number;
    detectedAt: number;
  }>;
  canary: {
    at: string;
    exitCode: number;
    dryRun: boolean;
    watched: number;
    polled: number;
    upserted: number;
    live: number;
    errors: number;
    /** Expected canary cadence in minutes — drives staleness coloring when present. */
    periodMin?: number;
  } | null;
  store: {
    dbPath: string;
    counts: Record<string, number>; // table → rows; -1 = table missing
  } | null;
  /** Cached Kalshi credential probe (server-side, 5-min TTL). */
  kalshiAuth?: {
    state: "valid" | "invalid" | "unreachable" | "no-creds";
    status?: number;
    checkedAt: string;
    cacheTtlSec: number;
  };
  /** Process/service self-metrics; panel is skipped when absent. */
  server?: {
    bootAt: string;
    uptimeSec: number;
    bunVersion: string;
    rssMb: number;
    heapUsedMb: number;
    tickCount: number;
    lineMoveCount: number;
  };
  flows: OpsCronFlow[];
  runs: RunSummary[];
};

function fmtTs(ts: number): string {
  return ts > 0 ? new Date(ts).toISOString().replace("T", " ").slice(0, 19) + "Z" : "—";
}

/** Humanized age: "45s" · "4m" · "1h12m" · "2d3h". */
export function fmtAgeMs(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h${min % 60 > 0 ? `${min % 60}m` : ""}`;
  return `${Math.floor(hr / 24)}d${hr % 24 > 0 ? `${hr % 24}h` : ""}`;
}

type Staleness = "fresh" | "overdue" | "stale";

function stalenessOf(ageMs: number, periodMin: number): Staleness {
  const periodMs = periodMin * 60_000;
  if (ageMs <= 2 * periodMs) return "fresh";
  if (ageMs <= 4 * periodMs) return "overdue";
  return "stale";
}

const STALENESS_BADGE: Record<Staleness, string> = {
  fresh: "ok",
  overdue: "warn",
  stale: "bad",
};

/** Age badge for a periodic job: "fired 4m ago" colored by age vs expected period. */
function ageBadge(atIso: string | null, periodMin: number, nowMs: number): string {
  if (!atIso) return `<span class="badge bad">never fired</span>`;
  const ageMs = nowMs - Date.parse(atIso);
  const state = stalenessOf(ageMs, periodMin);
  return `<span class="badge ${STALENESS_BADGE[state]}">fired ${escapeHtml(fmtAgeMs(ageMs))} ago · ${state}</span>`;
}

function renderOpsAgents(agents: Record<string, boolean>): string {
  const rows = Object.entries(agents)
    .map(
      ([name, ok]) =>
        `<li class="${ok ? "" : "no"}">${escapeHtml(name)} ${ok ? "up" : "down"}</li>`,
    )
    .join("\n");
  return `<ul class="checks">${rows}</ul>`;
}

function renderOpsSignals(data: OpsDashboardData): string {
  const tickRows = data.ticks
    .map(
      (t) =>
        `<tr><td>${escapeHtml(t.slug)}</td><td>${t.yesPrice}</td><td>${t.spread}</td><td>${t.volume24hr}</td><td>${escapeHtml(fmtTs(t.timestamp))}</td></tr>`,
    )
    .join("\n");
  const moveRows = data.lineMoves
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.slug)}</td><td>${escapeHtml(m.direction)}</td><td>${m.oldPrice} → ${m.newPrice}</td><td>${m.deltaBp} bp</td><td>${escapeHtml(fmtTs(m.detectedAt))}</td></tr>`,
    )
    .join("\n");

  const ticksTable = data.ticks.length
    ? `<table>
    <thead><tr><th>Slug</th><th>Yes</th><th>Spread</th><th>Vol 24h</th><th>At</th></tr></thead>
    <tbody>${tickRows}</tbody>
  </table>`
    : `<p><em>No ticks yet — ingest via <code>POST /polymarket/ingest</code>.</em></p>`;

  const movesTable = data.lineMoves.length
    ? `<table>
    <thead><tr><th>Slug</th><th>Dir</th><th>Price</th><th>Δ</th><th>Detected</th></tr></thead>
    <tbody>${moveRows}</tbody>
  </table>`
    : `<p><em>No line moves recorded.</em></p>`;

  return `<h3>Ticks (latest per market)</h3>${ticksTable}
  <h3>Line moves</h3>${movesTable}
  <p><a href="/polymarket/ticks">ticks.json</a> · <a href="/polymarket/line-moves">line-moves.json</a></p>`;
}

/** exit 0 = OK · exit 2 = DRIFT (report loudly) · anything else = FAIL */
function canaryBadge(c: NonNullable<OpsDashboardData["canary"]>): string {
  if (c.exitCode === 2) return `<span class="badge bad">DRIFT — exit 2</span>`;
  if (c.exitCode === 0 && c.errors === 0) return `<span class="badge ok">OK</span>`;
  if (c.exitCode === 0) return `<span class="badge warn">OK · ${c.errors} errors</span>`;
  return `<span class="badge bad">FAIL — exit ${c.exitCode}</span>`;
}

function renderOpsStore(store: OpsDashboardData["store"]): string {
  if (!store) {
    return `<p><em>No event store at <code>research/cache/event-store.db</code> yet — run <code>bun run tennis:itf -- --sync</code>.</em></p>`;
  }
  const cells = Object.entries(store.counts)
    .map(([table, n]) => {
      const value = n < 0 ? "—" : n;
      const cls = n < 0 ? ` class="warn"` : "";
      return `<div class="stat"${cls}><strong>${value}</strong> ${escapeHtml(table)}</div>`;
    })
    .join("\n    ");
  return `<h3>Event store (data plane)</h3>
  <div class="stats">
    ${cells}
  </div>
  <p><code>${escapeHtml(store.dbPath)}</code></p>`;
}

function renderOpsServer(data: OpsDashboardData, nowMs: number): string {
  const s = data.server;
  if (!s) return "";
  const ages: string[] = [];
  if (data.canary?.periodMin != null) {
    ages.push(`canary ${ageBadge(data.canary.at, data.canary.periodMin, nowMs)}`);
  }
  for (const f of data.flows) {
    if (f.periodMin != null) {
      ages.push(`${escapeHtml(f.label)} ${ageBadge(f.lastFireAt, f.periodMin, nowMs)}`);
    }
  }
  return `<p>boot ${escapeHtml(s.bootAt)} · uptime <strong>${escapeHtml(fmtAgeMs(s.uptimeSec * 1000))}</strong> · Bun ${escapeHtml(s.bunVersion)}</p>
  <div class="stats">
    <div class="stat"><strong>${s.rssMb.toFixed(1)}</strong> rss MB</div>
    <div class="stat"><strong>${s.heapUsedMb.toFixed(1)}</strong> heap MB</div>
    <div class="stat"><strong>${s.tickCount}</strong> ticks in DB</div>
    <div class="stat"><strong>${s.lineMoveCount}</strong> line moves in DB</div>
  </div>
  ${ages.length ? `<p>data plane: ${ages.join(" · ")}</p>` : ""}`;
}

const KALSHI_AUTH_BADGE: Record<string, { cls: string; label: string }> = {
  valid: { cls: "ok", label: "valid" },
  invalid: { cls: "bad", label: "invalid (rotate key)" },
  unreachable: { cls: "warn", label: "unreachable" },
  "no-creds": { cls: "dim", label: "no creds" },
};

function kalshiAuthBadge(auth: NonNullable<OpsDashboardData["kalshiAuth"]>): string {
  const b = KALSHI_AUTH_BADGE[auth.state] ?? { cls: "warn", label: auth.state };
  const title = `checked ${auth.checkedAt} · cache ${auth.cacheTtlSec}s${auth.status != null ? ` · HTTP ${auth.status}` : ""}`;
  return `<span class="badge ${b.cls}" title="${escapeHtml(title)}">${escapeHtml(b.label)}</span>`;
}

function renderOpsData(data: OpsDashboardData, nowMs: number): string {
  const storeBlock = renderOpsStore(data.store);
  const authLine = data.kalshiAuth ? `<p>Kalshi auth: ${kalshiAuthBadge(data.kalshiAuth)} <a href="#ops-rotate">(rotate ↓)</a></p>\n  ` : "";
  if (!data.canary) {
    return `${authLine}${storeBlock}
  <p><em>No canary artifact at <code>research/cache/tennis-canary/latest.json</code> yet.</em></p>`;
  }
  const c = data.canary;
  const age = c.periodMin != null ? ` · ${ageBadge(c.at, c.periodMin, nowMs)}` : "";
  return `${authLine}${storeBlock}
  <h3>Live canary</h3>
  <p>${canaryBadge(c)} · ${escapeHtml(c.at)}${c.dryRun ? " · dry-run" : ""}${age}</p>
  <div class="stats">
    <div class="stat"><strong>${c.watched}</strong> watched</div>
    <div class="stat"><strong>${c.polled}</strong> polled</div>
    <div class="stat"><strong>${c.upserted}</strong> upserted</div>
    <div class="stat"><strong>${c.live}</strong> live</div>
    <div class="stat"><strong>${c.errors}</strong> errors</div>
  </div>`;
}

function renderOpsFlows(flows: OpsCronFlow[], nowMs: number): string {
  const blocks = flows
    .map((f) => {
      const launchd =
        f.launchdLoaded === null
          ? `<span class="badge warn">unknown (launchctl probe failed)</span>`
          : f.launchdLoaded
            ? `<span class="badge ok">loaded</span>`
            : `<span class="badge bad">not loaded</span>`;
      const age = f.periodMin != null ? ` · ${ageBadge(f.lastFireAt, f.periodMin, nowMs)}` : "";
      const lines = f.lastLines.length
        ? `<pre class="diff">${escapeHtml(f.lastLines.join("\n"))}</pre>`
        : `<p><em>No log output at <code>${escapeHtml(f.logPath)}</code>.</em></p>`;
      return `<h3>${escapeHtml(f.label)}</h3>
  <p>launchd: ${launchd} · last fire: ${f.lastFireAt ? escapeHtml(f.lastFireAt) : "never (no log)"}${age}</p>
  ${lines}`;
    })
    .join("\n");
  const legend = flows.some((f) => f.periodMin != null)
    ? `<p><em><span class="badge ok">fresh ≤2×</span> <span class="badge warn">overdue ≤4×</span> <span class="badge bad">stale &gt;4×</span> expected period</em></p>`
    : "";
  return `${blocks || `<p><em>No flows configured.</em></p>`}
  ${legend}`;
}

function renderOpsRuns(runs: RunSummary[]): string {
  const items = runs
    .map(
      (r) =>
        `<li><code>${escapeHtml(r.runId)}</code> · ${escapeHtml(r.dimension)} · shortlist ${r.shortlist} · <a href="/api/runs/${encodeURIComponent(r.runId)}">json</a></li>`,
    )
    .join("\n");
  return `<ul>${items || "<li>none</li>"}</ul>`;
}

// ── Actions panel (synthetic probes against existing endpoints) ──

const OPS_DISPATCH_TYPES = [
  "COMPLIANCE_CHECK",
  "SPIKE_DETECT",
  "MARKET_INGEST",
  "ADMIN_ACTION",
  "LINE_MOVE_EVAL",
] as const;

export function renderOpsActions(): string {
  const typeOptions = OPS_DISPATCH_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("");
  return `<h2>Actions</h2>
  <p class="dim">Synthetic probes against this server's own endpoints — the compliance bet check runs the regulatory pipeline and returns a synthetic playId; it is NOT a live Kalshi order. Form values persist across auto-refresh; confirmation resets deliberately.</p>
  <h3>Agent dispatch</h3>
  <form class="ops" id="ops-dispatch-form">
    <label>Task type
      <select id="ops-dispatch-type">${typeOptions}</select>
    </label>
    <label>Payload (JSON, optional)
      <textarea id="ops-dispatch-payload" rows="4" placeholder="{}"></textarea>
    </label>
    <label><input type="checkbox" id="ops-dispatch-confirm" /> I confirm dispatch</label>
    <button type="submit" id="ops-dispatch-submit" disabled>Dispatch</button>
  </form>
  <pre class="diff" id="ops-dispatch-result" hidden></pre>
  <h3>Compliance bet check</h3>
  <form class="ops" id="ops-bet-form">
    <label>State
      <select id="ops-bet-state">
        <option value="MA">MA</option>
        <option value="NJ">NJ</option>
        <option value="XX">OTHER (demo block path)</option>
      </select>
    </label>
    <label>Wager amount
      <input type="number" id="ops-bet-wager" min="0" step="0.01" value="10" />
    </label>
    <label>User ID
      <input type="text" id="ops-bet-user" value="ops-dashboard" />
    </label>
    <label><input type="checkbox" id="ops-bet-confirm" /> I confirm this compliance check</label>
    <button type="submit" id="ops-bet-submit" disabled>Run compliance check</button>
  </form>
  <pre class="diff" id="ops-bet-result" hidden></pre>
  <h3 id="ops-rotate">Rotate Kalshi key</h3>
  <form class="ops" id="ops-rotate-form">
    <label>Key ID
      <input type="text" id="ops-rotate-keyid" autocomplete="off" />
    </label>
    <label>Private key (PEM)
      <textarea id="ops-rotate-pem" rows="4" placeholder="BEGIN … PRIVATE KEY"></textarea>
    </label>
    <label><input type="checkbox" id="ops-rotate-confirm" /> I confirm key rotation</label>
    <div>
      <button type="button" id="ops-rotate-preview">Preview (dry-run)</button>
      <button type="submit" id="ops-rotate-submit" disabled>Apply rotation</button>
    </div>
  </form>
  <pre class="diff" id="ops-rotate-result" hidden></pre>
<script>
(function () {
  // Minimal working payload per task type, derived from the agents' run() payload usage.
  var PAYLOAD_EXAMPLES = {
    COMPLIANCE_CHECK: '{\\n  "nodeId": "node-1",\\n  "userId": "ops-dashboard",\\n  "stateCode": "MA",\\n  "sportId": "tennis",\\n  "marketId": "KXITF-1",\\n  "wagerAmount": 10,\\n  "betType": "single"\\n}',
    SPIKE_DETECT: '{\\n  "windowSeconds": 300,\\n  "threshold": 10\\n}',
    MARKET_INGEST: '{\\n  "fetchLimit": 5\\n}',
    ADMIN_ACTION: '{\\n  "action": "remove_exclusion",\\n  "nodeId": "node-1",\\n  "userId": "ops-dashboard"\\n}',
    LINE_MOVE_EVAL: '{\\n  "slug": "example-market",\\n  "oldPrice": 0.42,\\n  "newPrice": 0.47,\\n  "deltaBp": 500\\n}',
  };
  var PAYLOAD_PLACEHOLDERS = {
    COMPLIANCE_CHECK: "placeBetAtomic fields — all required",
    SPIKE_DETECT: "optional — defaults windowSeconds=300 threshold=10",
    MARKET_INGEST: "optional — { slugs?: string[], fetchLimit?: number }",
    ADMIN_ACTION: "action + nodeId + userId (+ action-specific payload)",
    LINE_MOVE_EVAL: "slug/oldPrice/newPrice/deltaBp (+ detectedAt)",
  };

  // Field values persist across the 60s auto-refresh via sessionStorage.
  // Confirm checkboxes are deliberately NOT restored — confirmation must be
  // re-asserted after every reload. Rotate-key fields are excluded on purpose:
  // PEM material must never touch storage.
  var STORAGE_KEY = "ops-actions-form-v1";
  var FIELD_IDS = ["ops-dispatch-type", "ops-dispatch-payload", "ops-bet-state", "ops-bet-wager", "ops-bet-user"];

  function saveFields() {
    try {
      var data = {};
      for (var i = 0; i < FIELD_IDS.length; i++) {
        var el = document.getElementById(FIELD_IDS[i]);
        if (el) data[FIELD_IDS[i]] = el.value;
      }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* storage unavailable — non-fatal */ }
  }

  function restoreFields() {
    var data;
    try { data = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}"); } catch (e) { data = {}; }
    for (var i = 0; i < FIELD_IDS.length; i++) {
      var el = document.getElementById(FIELD_IDS[i]);
      if (el && typeof data[FIELD_IDS[i]] === "string") el.value = data[FIELD_IDS[i]];
    }
  }

  var typeSelect = document.getElementById("ops-dispatch-type");
  var payloadBox = document.getElementById("ops-dispatch-payload");
  var prevExample = null;

  function syncPayloadExample() {
    var type = typeSelect.value;
    var example = PAYLOAD_EXAMPLES[type];
    payloadBox.placeholder = PAYLOAD_PLACEHOLDERS[type] || "{}";
    // Prefill only when the box is empty or still holds the previous type's
    // example — never clobber an operator's edit.
    if (example && (payloadBox.value.trim() === "" || payloadBox.value === prevExample)) {
      payloadBox.value = example;
    }
    prevExample = example || null;
  }

  function show(out, status, body) {
    out.hidden = false;
    out.textContent = "HTTP " + status + (status === 429 ? " (rate limited — wait a moment)" : "") + "\\n" + body;
    out.classList.toggle("ok", status >= 200 && status < 300);
    out.classList.toggle("bad", status >= 400);
  }
  function wire(formId, confirmId, submitId, resultId, build) {
    var form = document.getElementById(formId);
    var confirmBox = document.getElementById(confirmId);
    var submit = document.getElementById(submitId);
    var out = document.getElementById(resultId);
    confirmBox.addEventListener("change", function () { submit.disabled = !confirmBox.checked; });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var req = build(out);
      if (!req) return;
      submit.disabled = true;
      out.hidden = false;
      out.classList.remove("ok", "bad");
      out.textContent = "…";
      fetch(req.url, req.init).then(function (res) {
        return res.text().then(function (text) {
          var body = text;
          try { body = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* raw text */ }
          show(out, res.status, body);
        });
      }).catch(function (err) {
        show(out, 0, "request failed: " + (err && err.message ? err.message : String(err)));
        out.classList.add("bad");
      }).finally(function () {
        submit.disabled = !confirmBox.checked;
      });
    });
  }
  wire("ops-dispatch-form", "ops-dispatch-confirm", "ops-dispatch-submit", "ops-dispatch-result", function (out) {
    var raw = payloadBox.value.trim() || "{}";
    var payload;
    try { payload = JSON.parse(raw); } catch (e) {
      show(out, 0, "payload is not valid JSON: " + e.message);
      out.classList.add("bad");
      return null;
    }
    return {
      url: "/agent/dispatch",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: { type: typeSelect.value, payload: payload } }),
      },
    };
  });
  wire("ops-bet-form", "ops-bet-confirm", "ops-bet-submit", "ops-bet-result", function () {
    return {
      url: "/place-bet",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-state-code": document.getElementById("ops-bet-state").value,
        },
        body: JSON.stringify({
          wagerAmount: Number(document.getElementById("ops-bet-wager").value),
          userId: document.getElementById("ops-bet-user").value,
        }),
      },
    };
  });

  // ── Rotate key ──
  var rotateOut = document.getElementById("ops-rotate-result");
  var rotateConfirm = document.getElementById("ops-rotate-confirm");
  var rotateSubmit = document.getElementById("ops-rotate-submit");
  rotateConfirm.addEventListener("change", function () { rotateSubmit.disabled = !rotateConfirm.checked; });

  function postRotate(dryRun) {
    var body = {
      keyId: document.getElementById("ops-rotate-keyid").value.trim(),
      pem: document.getElementById("ops-rotate-pem").value,
      dryRun: dryRun,
    };
    if (!dryRun) body.confirm = true;
    rotateSubmit.disabled = true;
    rotateOut.hidden = false;
    rotateOut.classList.remove("ok", "bad");
    rotateOut.textContent = "…";
    fetch("/ops/kalshi-rotate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        var bodyText = text;
        try { data = JSON.parse(text); bodyText = JSON.stringify(data, null, 2); } catch (e) { /* raw */ }
        var head = "";
        if (data && data.probe) {
          if (data.probe.state === "valid") {
            head = dryRun ? "auth valid — apply would succeed\\n" : "auth valid — badge updated\\n";
          } else {
            head = "probe " + data.probe.state + " (HTTP " + data.probe.status + ")\\n";
          }
          if (dryRun && data.planned) head += "planned: " + data.planned.join(", ") + "\\n";
          if (!dryRun && data.written) head += "written: " + data.written.join(", ") + "\\n";
        }
        show(rotateOut, res.status, head + bodyText);
      });
    }).catch(function (err) {
      show(rotateOut, 0, "request failed: " + (err && err.message ? err.message : String(err)));
      rotateOut.classList.add("bad");
    }).finally(function () {
      rotateSubmit.disabled = !rotateConfirm.checked;
    });
  }

  document.getElementById("ops-rotate-preview").addEventListener("click", function () { postRotate(true); });
  document.getElementById("ops-rotate-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    postRotate(false);
  });

  restoreFields();
  syncPayloadExample();
  typeSelect.addEventListener("change", function () { syncPayloadExample(); saveFields(); });
  for (var i = 0; i < FIELD_IDS.length; i++) {
    var el = document.getElementById(FIELD_IDS[i]);
    if (el) {
      el.addEventListener("input", saveFields);
      el.addEventListener("change", saveFields);
    }
  }
})();
</script>`;
}

export function renderOps(data: OpsDashboardData): string {
  const nowMs = Date.parse(data.generatedAt);
  const body = `${navLinks()}
  <h1>Ops dashboard</h1>
  <p>Generated ${escapeHtml(data.generatedAt)} · <a href="/ops">Refresh</a> (auto 60s) · <a href="/ops.json">ops.json</a></p>
  <h2>Bot &amp; agents</h2>
  ${renderOpsAgents(data.agents)}
  <p><a href="/polymarket/status">status.json</a> · <a href="/regulatory/health">regulatory health</a></p>
  ${renderOpsActions()}
  ${data.server ? `<h2>Server</h2>\n  ${renderOpsServer(data, nowMs)}` : ""}
  <h2>Signals</h2>
  ${renderOpsSignals(data)}
  <h2>Data</h2>
  ${renderOpsData(data, nowMs)}
  <h2>Flows</h2>
  ${renderOpsFlows(data.flows, nowMs)}
  <h2>Research runs (last ${data.runs.length})</h2>
  ${renderOpsRuns(data.runs)}`;

  return pageLayout("Ops — Kalshi Bot Research", body, { refreshSeconds: 60 });
}
