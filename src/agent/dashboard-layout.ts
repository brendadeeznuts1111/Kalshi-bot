import type { DashboardState } from "./dashboard-state.ts";
import { escapeHtml, STYLES } from "../research/views.ts";
import { DASHBOARD_ROUTES, type DashboardViewId } from "./dashboard-views-routes.ts";

export type DimensionOption = { id: string; label: string };

export const OPERATOR_STYLES = `
  ${STYLES}
  .operator-shell { display: grid; grid-template-rows: auto 1fr auto; min-height: 100vh; }
  .operator-header { border-bottom: 1px solid #d0d7de; padding: 0.75rem 1rem; background: #f6f8fa; }
  .operator-header h1 { margin: 0 0 0.5rem; font-size: 1.25rem; }
  .operator-body { display: grid; grid-template-columns: 11rem 1fr; min-height: 0; }
  .operator-nav { border-right: 1px solid #d0d7de; padding: 0.75rem; background: #fafbfc; }
  .operator-nav a { display: block; padding: 0.35rem 0.5rem; border-radius: 4px; text-decoration: none; color: #0969da; margin-bottom: 0.15rem; }
  .operator-nav a.active { background: #ddf4ff; font-weight: 600; color: #0550ae; }
  .operator-main { padding: 1rem 1.25rem; overflow: auto; }
  .operator-footer { border-top: 1px solid #d0d7de; padding: 0.45rem 1rem; font-size: 0.85rem; color: #656d76; background: #f6f8fa; display: flex; flex-wrap: wrap; gap: 0.75rem 1.5rem; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin: 0.5rem 0 0; }
  .dim-switch { font: inherit; padding: 0.35rem 0.5rem; border-radius: 6px; border: 1px solid #d0d7de; background: #fff; }
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
  .audit-evidence { display: flex; flex-wrap: wrap; gap: 1.25rem; align-items: flex-start; margin: 0.75rem 0; }
  .audit-evidence img { max-width: 320px; border: 1px solid #ddd; border-radius: 6px; background: #f6f8fa; }
  .audit-meta { margin: 0; flex: 1; min-width: 16rem; }
  .audit-meta dt { font-weight: 600; margin-top: 0.5rem; color: #656d76; font-size: 0.85rem; }
  .audit-meta dd { margin: 0.15rem 0 0; word-break: break-all; }
  .audit-hint { color: #656d76; font-size: 0.9rem; }
  .gate-miss { background: #fff8c5; border: 1px solid #d4a72c; border-radius: 6px; padding: 0.75rem 1rem; margin: 0.75rem 0; }
  .gate-miss ol { margin: 0.5rem 0 0; padding-left: 1.25rem; }
  .gate-miss pre { background: #f6f8fa; padding: 0.5rem; border-radius: 4px; overflow-x: auto; }
  .markdown-body { line-height: 1.6; max-width: none; }
  .markdown-body pre { background: #f6f8fa; padding: 0.75rem; overflow-x: auto; border-radius: 6px; }
  .markdown-body code { background: #f6f8fa; padding: 0.1em 0.3em; border-radius: 4px; font-size: 0.9em; }
  .markdown-body pre code { background: transparent; padding: 0; }
  .markdown-body h1, .markdown-body h2, .markdown-body h3 { margin-top: 1.25rem; }
  .markdown-body table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; }
  .markdown-body th, .markdown-body td { border: 1px solid #d0d7de; padding: 0.35rem 0.6rem; text-align: left; }
  .view-heading { margin: 0 0 0.75rem; font-size: 1.1rem; }
`;

const VIEW_LABELS: Record<DashboardViewId, string> = {
  overview: "Overview",
  report: "Report",
  diff: "Diff",
  blueprint: "Blueprint",
  pulse: "Pulse",
};

export function renderLeftRail(activeView: DashboardViewId, dimension: string): string {
  const links = (Object.keys(VIEW_LABELS) as DashboardViewId[])
    .map((view) => {
      const href = `${DASHBOARD_ROUTES[view]}?dimension=${encodeURIComponent(dimension)}`;
      const cls = view === activeView ? ' class="active"' : "";
      return `<a href="${href}" data-view="${view}"${cls}>${VIEW_LABELS[view]}</a>`;
    })
    .join("\n");
  return `<nav class="operator-nav" aria-label="Dashboard views">${links}</nav>`;
}

export function renderDimensionSwitcher(
  dimensions: DimensionOption[],
  activeDimension: string,
): string {
  const options = dimensions
    .map(
      (d) =>
        `<option value="${escapeHtml(d.id)}"${d.id === activeDimension ? " selected" : ""}>${escapeHtml(d.label)} (${escapeHtml(d.id)})</option>`,
    )
    .join("\n");
  return `<label class="dim-switch-wrap">Dimension <select id="dimension-switch" class="dim-switch" aria-label="Active dimension">${options}</select></label>`;
}

export function statusBanner(state: DashboardState): string {
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

export function renderTopBar(
  state: DashboardState,
  dimensions: DimensionOption[],
  activeDimension: string,
  runLabel: string | null,
): string {
  const busy = state.phase === "running-research";
  return `<header class="operator-header">
  <h1>Kalshi Agent Dashboard</h1>
  <p class="dim-switch-wrap">${runLabel ? `Latest run <code>${escapeHtml(runLabel)}</code> · ` : ""}dimension <code id="active-dimension-label">${escapeHtml(activeDimension)}</code></p>
  ${statusBanner(state)}
  <div class="toolbar">
    ${renderDimensionSwitcher(dimensions, activeDimension)}
    <button class="action" id="run-research" type="button"${busy ? " disabled" : ""}>${busy ? "Running research…" : "Run research"}</button>
    <button class="action secondary" id="verify-dashboard" type="button"${busy ? " disabled" : ""}>Verify dashboard</button>
    <button class="action secondary" id="capture-screenshot" type="button"${busy ? " disabled" : ""}>Screenshot</button>
    <button class="action secondary" id="refresh-status" type="button">Refresh</button>
  </div>
</header>`;
}

export function renderFooterTelemetry(initial: {
  rateLimitLine: string;
  pulseLine: string;
  cacheLine: string | null;
}): string {
  const cache = initial.cacheLine
    ? `<span id="footer-cache">${escapeHtml(initial.cacheLine)}</span>`
    : `<span id="footer-cache"></span>`;
  return `<footer class="operator-footer">
  <span id="footer-rate-limit">${escapeHtml(initial.rateLimitLine)}</span>
  <span id="footer-pulse">${escapeHtml(initial.pulseLine)}</span>
  ${cache}
</footer>`;
}

export function renderOperatorShell(options: {
  activeView: DashboardViewId;
  dimension: string;
  dimensions: DimensionOption[];
  state: DashboardState;
  runLabel: string | null;
  mainHtml: string;
  footer: { rateLimitLine: string; pulseLine: string; cacheLine: string | null };
  busy: boolean;
}): string {
  const body = `<div class="operator-shell">
  ${renderTopBar(options.state, options.dimensions, options.dimension, options.runLabel)}
  <div class="operator-body">
    ${renderLeftRail(options.activeView, options.dimension)}
    <main class="operator-main" id="main-content" data-view="${options.activeView}" data-dimension="${escapeHtml(options.dimension)}">
      ${options.mainHtml}
    </main>
  </div>
  ${renderFooterTelemetry(options.footer)}
</div>
${operatorClientScript(options.busy, options.activeView)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Kalshi Agent Dashboard</title>
  <style>${OPERATOR_STYLES}</style>
</head>
<body>${body}</body>
</html>`;
}

export function renderMainFragment(
  view: DashboardViewId,
  dimension: string,
  innerHtml: string,
): string {
  return `<main class="operator-main" id="main-content" data-view="${view}" data-dimension="${escapeHtml(dimension)}">${innerHtml}</main>`;
}

export function operatorClientScript(busy: boolean, activeView: DashboardViewId): string {
  const views = JSON.stringify(Object.keys(VIEW_LABELS));
  return `<script>
(function () {
  const busy = ${busy ? "true" : "false"};
  const activeView = ${JSON.stringify(activeView)};
  const STORAGE_KEY = "kalshi-dashboard-dimension";

  function currentDimension() {
    const main = document.getElementById("main-content");
    return main?.dataset.dimension || document.getElementById("dimension-switch")?.value || "all";
  }

  function syncDimensionFromStorage() {
    const select = document.getElementById("dimension-switch");
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!select || !stored || select.value === stored) return;
    if ([...select.options].some((o) => o.value === stored)) {
      select.value = stored;
      navigateView(activeView, stored);
    }
  }

  function persistDimension(dimension) {
    sessionStorage.setItem(STORAGE_KEY, dimension);
    const label = document.getElementById("active-dimension-label");
    if (label) label.textContent = dimension;
  }

  async function navigateView(view, dimension) {
    persistDimension(dimension);
    const routes = ${JSON.stringify(DASHBOARD_ROUTES)};
    const path = routes[view] || routes.overview;
    const url = path + "?dimension=" + encodeURIComponent(dimension) + "&partial=1";
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.statusText);
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const next = doc.getElementById("main-content");
    const current = document.getElementById("main-content");
    if (!next || !current) {
      location.href = path + "?dimension=" + encodeURIComponent(dimension);
      return;
    }
    current.replaceWith(next);
    document.querySelectorAll(".operator-nav a").forEach((a) => {
      a.classList.toggle("active", a.dataset.view === view);
    });
    history.replaceState({ view, dimension }, "", path + "?dimension=" + encodeURIComponent(dimension));
  }

  document.getElementById("dimension-switch")?.addEventListener("change", (e) => {
    navigateView(document.getElementById("main-content")?.dataset.view || activeView, e.target.value).catch(() => location.reload());
  });

  document.querySelector(".operator-nav")?.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-view]");
    if (!a) return;
    e.preventDefault();
    navigateView(a.dataset.view, currentDimension()).catch(() => { location.href = a.href; });
  });

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

  async function pollFooter() {
    try {
      const res = await fetch("${DASHBOARD_ROUTES.status}");
      const data = await res.json();
      const rl = document.getElementById("footer-rate-limit");
      const pl = document.getElementById("footer-pulse");
      const cl = document.getElementById("footer-cache");
      if (rl && data.telemetry?.rateLimitLine) rl.textContent = data.telemetry.rateLimitLine;
      if (pl && data.telemetry?.pulseLine) pl.textContent = data.telemetry.pulseLine;
      if (cl && data.telemetry?.cacheLine) cl.textContent = data.telemetry.cacheLine;
    } catch (_) {}
  }
  pollFooter();
  setInterval(pollFooter, 30000);

  const runBtn = document.getElementById("run-research");
  runBtn?.addEventListener("click", async () => {
    runBtn.disabled = true;
    runBtn.textContent = "Running research…";
    const banner = document.getElementById("status-banner");
    if (banner) {
      banner.className = "banner busy";
      banner.innerHTML = "<strong>Running research…</strong> This may take several minutes.";
    }
    try {
      const dimension = currentDimension();
      const res = await fetch("${DASHBOARD_ROUTES.runResearch}", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dimension }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || data.message || res.statusText);
      sessionStorage.setItem(STORAGE_KEY, dimension);
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

  document.getElementById("verify-dashboard")?.addEventListener("click", async () => {
    const btn = document.getElementById("verify-dashboard");
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Verifying…";
    try {
      const res = await fetch("${DASHBOARD_ROUTES.verify}", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.summary || data.error || res.statusText);
      alert(data.summary || "Dashboard verify: PASS");
    } catch (err) {
      alert(String(err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  document.querySelectorAll("#capture-screenshot, [data-capture-screenshot]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = "Capturing…";
      try {
        const res = await fetch("${DASHBOARD_ROUTES.screenshot}", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || res.statusText);
        location.reload();
      } catch (err) {
        alert(String(err.message || err));
        btn.disabled = false;
        btn.textContent = label;
      }
    });
  });

  document.getElementById("refresh-status")?.addEventListener("click", () => location.reload());

  syncDimensionFromStorage();
})();
</script>`;
}
