import {
  normalizeTennisFilterKey,
  passesMinimumSurfaceEdge,
  surfaceEdgePresentation,
} from "./surface-edge.ts";

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * @type {{
 *   tooltips: Record<string,string>,
 *   entries: any[],
 *   categories: any[],
 *   filterCatalog: Record<string, { label: string, values: string[], valueLabels?: Record<string,string> }>,
 * }}
 */
let GLOSSARY = { tooltips: {}, entries: [], categories: [], filterCatalog: {} };
let TOOLTIPS = {};

function applyGlossaryPayload(payload) {
  if (!payload || typeof payload !== "object") return;
  // Back-compat: old API returned a flat tooltips map
  if (payload.tooltips) {
    GLOSSARY = {
      tooltips: payload.tooltips || {},
      entries: Array.isArray(payload.entries) ? payload.entries : [],
      categories: Array.isArray(payload.categories) ? payload.categories : [],
      filterCatalog: payload.filterCatalog && typeof payload.filterCatalog === "object"
        ? payload.filterCatalog
        : {},
    };
  } else {
    GLOSSARY = { tooltips: payload, entries: [], categories: [], filterCatalog: {} };
  }
  TOOLTIPS = GLOSSARY.tooltips;
  renderGlossaryBody();
}

fetch("/api/glossary")
  .then((r) => r.json())
  .then(applyGlossaryPayload)
  .catch(() => {});

/** Inline ? hint — title tooltip + click opens glossary panel at entry. */
const tip = (key) => {
  const desc = TOOLTIPS[key];
  if (!desc) return "";
  return (
    ' <span class="hint" role="button" tabindex="0" data-glossary="' +
    esc(key) +
    '" title="' +
    desc.replace(/"/g, "&quot;") +
    '">?</span>'
  );
};

/** Label + value with glossary-backed name (tooltip on label). */
function glossaryLabel(key, valueHtml) {
  const entry = (GLOSSARY.entries || []).find((e) => e.id === key);
  const label = entry?.label || key;
  const desc = TOOLTIPS[key] || entry?.description || "";
  return (
    '<span class="glossary-label">' +
    '<span class="gl-name" data-glossary="' +
    esc(key) +
    '" title="' +
    (desc || "").replace(/"/g, "&quot;") +
    '">' +
    esc(label) +
    ":</span> " +
    valueHtml +
    "</span>"
  );
}
const fmtCents = (c) => c == null ? "—" : "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
const fmtTime = (iso) => iso ? new Date(iso).toLocaleString() : "—";
const fmtMs = (ms) => ms ? new Date(ms).toLocaleString() : "—";
const badge = (cls, txt) => '<span class="badge ' + cls + '">' + esc(txt) + "</span>";

/**
 * Aligned bar chart (CSS grid: 72px | 1fr | 64px).
 * Tabular nums on values prevent jitter; width % locks relative scale.
 * @param {{ label: string, value: number, display?: string, color?: string }[]} data
 * @param {{ title: string, subtitle?: string }} opts
 */
function barChartHtml(data, { title, subtitle = "" } = {}) {
  if (!data.length) return "";
  const maxVal = Math.max(...data.map((d) => d.value), 0);
  const rows = data.map((d) => {
    const pct = maxVal > 0 ? (d.value / maxVal) * 100 : 0;
    const display = d.display ?? d.value.toLocaleString();
    const barStyle =
      "width:" + pct.toFixed(1) + "%" +
      (d.color ? ";background:" + d.color : "");
    return (
      '<div class="bar-chart-row">' +
      '<div class="bar-chart-label" title="' + esc(d.label) + '">' + esc(d.label) + "</div>" +
      '<div class="bar-chart-track"><div class="bar-chart-bar" style="' + barStyle + '"></div></div>' +
      '<div class="bar-chart-value">' + esc(display) + "</div>" +
      "</div>"
    );
  }).join("");
  return (
    '<div class="bar-chart">' +
    '<div class="bar-chart-header">' +
    '<div class="bar-chart-title">' + esc(title) + "</div>" +
    (subtitle ? '<div class="bar-chart-subtitle">' + esc(subtitle) + "</div>" : "") +
    "</div>" +
    '<div class="bar-chart-bars">' + rows + "</div>" +
    "</div>"
  );
}

/**
 * KPI card — strict three-tier structure:
 *   1. h3 label (+ optional badges)
 *   2. hero value (+ optional muted unit)
 *   3. secondary stats, one row each (label left, mono value right)
 * footer: mono caption line (run id, timestamp, …)
 */
const kpiCard = (label, { badges = "", value = "—", unit = "", stats = [], footer = "" } = {}) =>
  '<div class="card kpi"><h3>' + esc(label) + (badges ? " " + badges : "") + "</h3>" +
  '<div class="kpi-value">' + value + (unit ? '<span class="unit">' + esc(unit) + "</span>" : "") + "</div>" +
  (stats.length
    ? '<div class="kpi-stats">' + stats.map(([k, v]) =>
        '<div class="kpi-stat"><span>' + esc(k) + '</span><span class="mono">' + v + "</span></div>").join("") + "</div>"
    : "") +
  (footer ? '<div class="kpi-foot">' + footer + "</div>" : "") +
  "</div>";

function authBadge(a) {
  if (!a) return badge("dim", "auth ?");
  const map = { valid: ["ok", "kalshi auth ✓"], invalid: ["bad", "auth invalid"],
    unreachable: ["warn", "api unreachable"], "no-creds": ["warn", "no creds"] };
  const [cls, txt] = map[a.state] ?? ["dim", a.state];
  return badge(cls, txt);
}

function renderOverview(hq, ops) {
  const r = hq.research.latest, t = hq.trading;
  const tradingBadge = t.state === "ok"
    ? badge("ok", "connected") : badge("warn", t.state === "unavailable" ? "unavailable" : t.state);
  $("#tab-overview").innerHTML =
    '<div class="grid">' +
    (r
      ? kpiCard("Research — latest run", {
          value: esc(r.shortlisted), unit: "shortlisted",
          stats: [["Discovered", r.discovered], ["Gated", r.gated], ["Inspected", r.inspected]],
          footer: esc(r.runId),
        })
      : kpiCard("Research — latest run", { value: '<span class="muted">—</span>', footer: "no production runs" })) +
    (t.state === "ok"
      ? kpiCard("Trading", {
          badges: tradingBadge,
          value: fmtCents(t.balanceCents),
          stats: [["Positions", t.positions.length], ["Open orders", t.openOrders.length], ["Fills", t.fillCount]],
          footer: authBadge(ops && ops.kalshiAuth),
        })
      : kpiCard("Trading", {
          badges: tradingBadge,
          value: '<span class="muted">—</span>',
          footer: esc(t.reason ?? "credentials not configured or API unreachable") + " · " + authBadge(ops && ops.kalshiAuth),
        })) +
    kpiCard("Alpha programs", {
      value: hq.alpha.length,
      stats: hq.alpha.map((p) => [p.name, badge(p.status === "shadow" ? "warn" : "dim", p.status)]),
    }) +
    (hq.calibration
      ? kpiCard("Calibration", {
          value: hq.calibration.totalRuns, unit: "runs",
          footer: esc(hq.calibration.runId),
        })
      : kpiCard("Calibration", { value: '<span class="muted">—</span>', footer: "no calibration artifacts" })) +
    (ops && ops.server
      ? kpiCard("Server", {
          value: Math.round(ops.server.uptimeSec / 60), unit: "min up",
          stats: [["Bun", esc(ops.server.bunVersion)], ["RSS", ops.server.rssMb.toFixed(0) + " MB"], ["Ticks", ops.server.tickCount]],
        })
      : kpiCard("Server", { value: '<span class="muted">—</span>', footer: "ops unavailable" })) +
    (ops && ops.store
      ? kpiCard("Event store", {
          value: ops.store.counts.events ?? 0, unit: "events",
          stats: Object.entries(ops.store.counts)
            .filter(([k]) => k !== "events").slice(0, 5)
            .map(([k, v]) => [k.replace(/_/g, " "), v]),
        })
      : kpiCard("Event store", { value: '<span class="muted">—</span>', footer: "event store absent" })) +
    "</div>" +
    renderOverviewCharts(hq);
}

/** Volume / mid distribution panels when tennis board data is present. */
function renderOverviewCharts(hq) {
  const board = hq.tennis?.board ?? hq.board ?? null;
  const series = board?.series;
  if (!Array.isArray(series) || !series.length) {
    // Demo-aligned sample so layout is always verifiable in HQ
    return (
      '<div class="cols" style="margin-top:0.9rem">' +
      barChartHtml(
        [
          { label: "ATP", value: 3_200_000, display: "3.2M" },
          { label: "WTA", value: 1_800_000, display: "1.8M" },
          { label: "ITF W", value: 950_000, display: "950K" },
          { label: "ITF M", value: 420_000, display: "420K" },
        ],
        { title: "Volume by series", subtitle: "sample layout — live board when tennis events load" },
      ) +
      barChartHtml(
        [
          { label: "1–20¢", value: 124, display: "124" },
          { label: "21–40¢", value: 89, display: "89" },
          { label: "41–60¢", value: 67, display: "67" },
          { label: "61–80¢", value: 45, display: "45" },
          { label: "81–99¢", value: 28, display: "28" },
        ],
        { title: "Mid distribution", subtitle: "latest book_ticks mid cents (sample)" },
      ) +
      "</div>"
    );
  }

  const volRows = series.map((s) => {
    const events = s.events ?? [];
    const vol = events.reduce(
      (sum, e) =>
        sum +
        (e.markets ?? []).reduce((mSum, m) => mSum + (m.volume24h ?? 0), 0),
      0,
    );
    return { label: s.series || "—", value: vol, display: fmtVol(vol) };
  }).filter((r) => r.value > 0);
  if (!volRows.length) return "";

  return (
    '<div style="margin-top:0.9rem">' +
    barChartHtml(volRows, {
      title: "Volume by series",
      subtitle: "24h volume across tennis board series",
    }) +
    "</div>"
  );
}

function renderResearch(hq) {
  const r = hq.research;
  const topRows = r.latest ? r.latest.top.map((s) =>
    "<tr><td><a href='/repo/" + esc(s.fullName) + "'>" + esc(s.fullName) + "</a></td>" +
    "<td class='num'>" + s.stars + "</td><td class='num'>" + (s.qualityScore ?? "—") + "</td>" +
    "<td>" + (s.strategyTags || []).map((t) => '<span class="tag">' + esc(t) + "</span>").join("") + "</td></tr>").join("") : "";
  const runRows = r.runs.map((run) =>
    "<tr><td class='mono'><a href='/api/run/" + esc(run.runId) + "'>" + esc(run.runId) + "</a></td>" +
    "<td class='num'>" + (run.discovered ?? "—") + "</td><td class='num'>" + (run.gated ?? "—") + "</td>" +
    "<td class='num'>" + (run.inspected ?? "—") + "</td><td class='num'>" + (run.shortlisted ?? "—") + "</td></tr>").join("");
  $("#tab-research").innerHTML =
    '<div class="panel"><h2>Top candidates — latest run</h2>' +
    (topRows ? "<table><tr><th>Repo</th><th class='num'>Stars</th><th class='num'>Score</th><th>Strategy tags</th></tr>" + topRows + "</table>"
      : '<div class="muted">No production run yet — <code>bun run research</code></div>') + "</div>" +
    '<div class="panel"><h2>Run history</h2>' +
    (runRows ? "<table><tr><th>Run</th><th class='num'>Discovered</th><th class='num'>Gated</th><th class='num'>Inspected</th><th class='num'>Shortlisted</th></tr>" + runRows + "</table>"
      : '<div class="muted">none</div>') + "</div>" +
    '<div class="panel"><h2>Actions</h2><div class="muted">Run discovery: <code>bun run research</code> · Export audit: <code>bun run export-audit</code> · Terminal report: <code>bun run report:term</code></div></div>';
}

function renderTrading(hq) {
  const t = hq.trading;
  if (t.state !== "ok") {
    $("#tab-trading").innerHTML = '<div class="panel"><h2>Trading</h2><div class="err">' +
      esc(t.reason ?? "Trading API unavailable") + '</div><div class="muted" style="margin-top:.5rem">' +
      "Configure Kalshi credentials (see .env.example / docs/PROTONPASS.md) and restart the server.</div></div>";
    return;
  }
  const posRows = t.positions.slice(0, 25).map((p) =>
    "<tr><td class='mono'>" + esc(p.ticker) + "</td>" +
    "<td class='num'>" + esc(p.position) + (p.fractional ? " <span class='tag'>fp</span>" : "") + "</td>" +
    "<td class='num'>" + fmtCents(p.exposureCents) + "</td>" +
    "<td class='num'>" + fmtCents(p.realizedPnlCents) + "</td></tr>").join("");
  const ordRows = t.openOrders.slice(0, 25).map((o) => {
    const oid = esc(o.orderId ?? "");
    return "<tr><td class='mono'>" + esc(o.ticker) + "</td><td>" + esc(o.side ?? "") + "</td>" +
    "<td class='num'>" + esc(o.remainingCount ?? "—") + "</td>" +
    "<td class='num'>" + (o.yesPriceCents != null ? o.yesPriceCents + "¢" : "—") + "</td>" +
    (oid ? "<td><button class='cancel' data-order='" + oid + "'>cancel</button></td>" : "<td></td>") + "</tr>";
  }).join("");
  const fillRows = t.recentFills.slice(0, 25).map((f) =>
    "<tr><td class='mono'>" + esc(f.ticker) + "</td><td>" + esc(f.side ?? "") + "</td>" +
    "<td class='num'>" + esc(f.count) + "</td>" +
    "<td class='num'>" + (f.yesPriceCents != null ? f.yesPriceCents + "¢" : "—") + "</td>" +
    "<td>" + (f.isTaker == null ? "—" : f.isTaker ? "taker" : "maker") + "</td>" +
    "<td class='muted'>" + fmtMs(f.createdAtMs) + "</td></tr>").join("");
  $("#tab-trading").innerHTML =
    '<div class="grid">' +
    kpiCard("Balance", { value: fmtCents(t.balanceCents), badges: tip("balanceCents") }) +
    kpiCard("Positions", { value: t.positions.length, badges: tip("position") }) +
    kpiCard("Open orders", { value: t.openOrders.length }) +
    kpiCard("Fills", { value: t.fillCount }) +
    "</div>" +
    '<div class="panel" style="margin-top:.9rem"><h2>Balance & exposure history' + tip("balanceCents") + "</h2>" +
    '<canvas id="history-chart" width="900" height="180" style="width:100%;height:180px"></canvas>' +
    '<div class="muted" id="history-caption"></div></div>' +
    '<div class="panel" style="margin-top:.9rem"><h2>Order entry ' + badge("warn", "dry-run default") + "</h2>" +
    '<form class="order" id="order-form">' +
    '<label>Ticker<input name="ticker" required placeholder="KXNBA-…" /></label>' +
    '<label>Side<select name="side"><option value="yes">yes</option><option value="no">no</option></select></label>' +
    '<label>Contracts<input name="count" type="number" min="1" max="10000" value="1" required /></label>' +
    '<label>Limit ¢' + tip("yesPriceCents") + '<input name="priceCents" type="number" min="1" max="99" required /></label>' +
    '<label>Post-only' + tip("postOnly") + '<input name="postOnly" type="checkbox" checked /></label>' +
    '<label>Live (uncheck = dry-run)' + tip("dryRun") + '<input name="live" type="checkbox" /></label>' +
    '<button type="submit">Place order</button>' +
    "</form>" +
    '<div id="book-preview" class="muted" style="margin-top:.6rem">type a ticker to preview the book</div>' +
    '<div id="order-result"></div></div>' +
    '<div class="cols">' +
    '<div class="panel"><h2>Positions</h2>' + (posRows ? "<table><tr><th>Ticker</th><th class='num'>Count" + tip("position") + "</th><th class='num'>Exposure" + tip("exposureCents") + "</th><th class='num'>Realized P&L" + tip("realizedPnlCents") + "</th></tr>" + posRows + "</table>" : '<div class="muted">no positions</div>') + "</div>" +
    '<div class="panel"><h2>Open orders</h2>' + (ordRows ? "<table><tr><th>Ticker</th><th>Side</th><th class='num'>Remaining" + tip("remainingCount") + "</th><th class='num'>Price" + tip("yesPriceCents") + "</th><th></th></tr>" + ordRows + "</table>" : '<div class="muted">no open orders</div>') + "</div>" +
    "</div>" +
    '<div class="panel"><h2>Recent fills</h2>' + (fillRows ? "<table><tr><th>Ticker</th><th>Side</th><th class='num'>Count</th><th class='num'>Price</th><th>Role" + tip("isTaker") + "</th><th>Time</th></tr>" + fillRows + "</table>" : '<div class="muted">no fills</div>') + "</div>" +
    '<div class="muted">Snapshot cached 15s · checked ' + fmtTime(t.checkedAt) + "</div>";

  const form = $("#order-form");
  if (form) {
    form.addEventListener("submit", submitOrder);
    let debounce = null;
    form.ticker.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => previewBook(form.ticker.value.trim()), 400);
    });
  }
  document.querySelectorAll("#tab-trading button.cancel").forEach((b) =>
    b.addEventListener("click", () => cancelOrderById(b.dataset.order, b)));
  drawHistoryChart(window.__hqHistory ?? []);
}

function drawHistoryChart(history) {
  const cv = $("#history-chart");
  if (!cv) return;
  const cap = $("#history-caption");
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
  const pts = history.filter((h) => h.balanceCents != null);
  if (pts.length < 2) {
    if (cap) cap.textContent = pts.length
      ? "1 snapshot — chart appears after the next refresh"
      : "no snapshots yet — history builds as the dashboard refreshes";
    return;
  }
  const W = cv.width, H = cv.height, pad = 8;
  const series = [
    { key: "balanceCents", color: "#4da3ff", label: "balance" },
    { key: "portfolioValueCents", color: "#3fb27f", label: "portfolio" },
    { key: "exposureCents", color: "#e0a93e", label: "exposure" },
  ];
  const all = pts.flatMap((p) => series.map((s) => p[s.key]).filter((v) => v != null));
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const x = (i) => pad + (i / (pts.length - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - ((v - min) / span) * (H - 2 * pad);
  for (const s of series) {
    ctx.beginPath();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.5;
    let started = false;
    pts.forEach((p, i) => {
      const v = p[s.key];
      if (v == null) return;
      if (!started) { ctx.moveTo(x(i), y(v)); started = true; }
      else ctx.lineTo(x(i), y(v));
    });
    ctx.stroke();
  }
  if (cap) cap.innerHTML = series.map((s) =>
    '<span style="color:' + s.color + '">●</span> ' + s.label).join(" · ") +
    " · " + pts.length + " snapshots · " + new Date(pts[0].atMs).toLocaleTimeString() +
    " → " + new Date(pts[pts.length - 1].atMs).toLocaleTimeString();
}

function renderMonitor(hq, ops) {
  const m = hq.monitor ?? { kalshi: [], crossSite: [] };
  const posRows = m.kalshi.slice(0, 25).map((p) =>
    "<tr><td class='mono'>" + esc(p.ticker) + "</td>" +
    "<td class='mono muted'>" + esc(p.eventTicker) + "</td>" +
    "<td class='num'>" + esc(p.position) + "</td>" +
    "<td class='num'>" + fmtCents(p.exposureCents) + "</td>" +
    "<td>" + (p.hasOpenOrders ? badge("ok", "working") : badge("dim", "flat")) + "</td>" +
    "<td class='num' data-book='" + esc(p.ticker) + "'>…</td></tr>").join("");
  const evtRows = m.crossSite.slice(0, 15).map((e) =>
    "<tr><td class='mono'>" + esc(e.eventTicker) + "</td>" +
    "<td class='num'>" + e.markets + "</td>" +
    "<td class='num'>" + fmtCents(e.exposureCents) + "</td></tr>").join("");
  const polyRows = ((ops && ops.ticks) || []).slice(0, 15).map((t) =>
    "<tr><td class='mono'>" + esc(t.slug ?? t.market ?? "?") + "</td>" +
    "<td class='num'>" + esc(t.price ?? t.last ?? "—") + "</td></tr>").join("");
  $("#tab-monitor").innerHTML =
    '<div class="panel"><h2>Kalshi positions — live book' + tip("position") + "</h2>" +
    (posRows ? "<table><tr><th>Market</th><th>Event</th><th class='num'>Pos</th><th class='num'>Exposure</th><th>Orders</th><th class='num'>Mid</th></tr>" + posRows + "</table>"
      : '<div class="muted">no Kalshi positions</div>') + "</div>" +
    '<div class="cols">' +
    '<div class="panel"><h2>Exposure by event</h2>' +
    (evtRows ? "<table><tr><th>Event</th><th class='num'>Markets</th><th class='num'>Exposure</th></tr>" + evtRows + "</table>"
      : '<div class="muted">no event exposure</div>') + "</div>" +
    '<div class="panel"><h2>Polymarket — cross-site ticks</h2>' +
    (polyRows ? "<table><tr><th>Slug</th><th class='num'>Price</th></tr>" + polyRows + "</table>"
      : '<div class="muted">no ticks — POST /polymarket/ingest</div>') + "</div>" +
    "</div>";
  // Fill live book mids for monitored tickers (max 10, sequential to be polite)
  (async () => {
    for (const cell of document.querySelectorAll("#tab-monitor [data-book]").values()) {
      const ticker = cell.dataset.book;
      try {
        const res = await fetch("/api/trading/book?ticker=" + encodeURIComponent(ticker) + "&depth=1");
        const b = await res.json();
        cell.textContent = b.ok ? (b.mid != null ? b.mid + "¢" : "—") : "err";
      } catch { cell.textContent = "err"; }
    }
  })();
}

async function previewBook(ticker) {
  const out = $("#book-preview");
  if (!out) return;
  if (!ticker) { out.innerHTML = '<span class="muted">type a ticker to preview the book</span>'; return; }
  out.innerHTML = '<span class="muted">loading book…</span>';
  try {
    const res = await fetch("/api/trading/book?ticker=" + encodeURIComponent(ticker) + "&depth=10");
    const b = await res.json();
    if (!b.ok) { out.innerHTML = '<span class="err">' + esc(b.error) + "</span>"; return; }
    const lvl = (l) => l ? l.priceCents + "¢ × " + l.size : "—";
    const rows = (levels, side) => levels.slice(0, 5).map((l) =>
      "<tr><td class='mono'>" + side + "</td><td class='num'>" + l.priceCents + "¢</td><td class='num'>" + l.size + "</td></tr>").join("");
    const ladder = (b.bids.length || b.asks.length)
      ? "<table style='max-width:22rem'><tr><th></th><th class='num'>Price</th><th class='num'>Size</th></tr>" +
        rows(b.asks.slice(0, 5).reverse(), "ask") + rows(b.bids.slice(0, 5), "bid") + "</table>"
      : '<span class="muted">empty book</span>';
    out.innerHTML =
      "<div style='margin-bottom:.3rem'>mid <strong class='mono'>" + (b.mid != null ? b.mid + "¢" : "—") + "</strong>" +
      " · spread <strong class='mono'>" + (b.spreadCents != null ? b.spreadCents + "¢" : "—") + "</strong>" +
      " · best bid <strong class='mono'>" + lvl(b.bids[0]) + "</strong> · best ask <strong class='mono'>" + lvl(b.asks[0]) + "</strong>" +
      (b.crossed ? " " + badge("warn", "crossed") : "") + "</div>" + ladder;
  } catch (e) {
    out.innerHTML = '<span class="err">book fetch failed: ' + esc(e.message) + "</span>";
  }
}

async function submitOrder(ev) {
  ev.preventDefault();
  const form = ev.target;
  const btn = form.querySelector("button[type=submit]");
  const out = $("#order-result");
  const live = form.live.checked;
  if (live && !confirm("Place a LIVE order with real funds?")) return;
  btn.disabled = true;
  out.innerHTML = '<span class="muted">submitting…</span>';
  try {
    const res = await fetch("/api/trading/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker: form.ticker.value.trim(),
        side: form.side.value,
        count: Number(form.count.value),
        priceCents: Number(form.priceCents.value),
        postOnly: form.postOnly.checked,
        dryRun: !live,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      out.innerHTML = badge("ok", (data.dryRun ? "dry-run " : "LIVE ") + "accepted") +
        ' <span class="mono muted">' + esc(data.orderId) + "</span>";
      setTimeout(refresh, 1_500);
    } else {
      out.innerHTML = badge("bad", "rejected") + ' <span class="err">' + esc(data.error) + "</span>";
    }
  } catch (e) {
    out.innerHTML = '<span class="err">request failed: ' + esc(e.message) + "</span>";
  } finally {
    btn.disabled = false;
  }
}

async function cancelOrderById(orderId, btn) {
  if (!orderId) return;
  if (!confirm("Cancel order " + orderId + "?")) return;
  btn.disabled = true;
  try {
    const res = await fetch("/api/trading/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    const data = await res.json();
    if (!data.ok) alert("Cancel failed: " + (data.error ?? res.status));
    setTimeout(refresh, 1_000);
  } catch (e) {
    alert("Cancel failed: " + e.message);
    btn.disabled = false;
  }
}

const px = (c) => c == null ? "—" : c + "¢";
const fmtVol = (v) => v == null ? "—" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : String(Math.round(v));

function tradeTicker(ticker) {
  document.querySelector('nav.tabs button[data-tab="trading"]').click();
  const form = $("#order-form");
  if (form) {
    form.ticker.value = ticker;
    previewBook(ticker);
    form.priceCents.focus();
  }
}

let __board = null;
const __filters = {
  q: "", league: "", tournament: "", country: "", round: "", surface: "", tier: "",
  when: "all",        // all | live | today | 24h | week
  liquidity: "all",   // all | priced | active
  minVol: 0,          // min 24h volume (contracts)
  maxAsk: 0,          // only show markets with ask ≤ N¢ (0 = off)
  minSurfaceEdge: 0,  // Player A surface edge floor (0 = off)
  sort: "time",       // time | volume | alpha
};
let __filtersHydrated = false;

const FILTER_KEYS = ["q", "league", "tournament", "country", "round", "surface", "tier", "when",
  "liquidity", "minVol", "maxAsk", "minSurfaceEdge", "sort"];
const NUMERIC_FILTER_KEYS = new Set(["minVol", "maxAsk", "minSurfaceEdge"]);

function filtersFromHash() {
  if (!location.hash.startsWith("#events")) return;
  const params = new URLSearchParams(location.hash.slice(location.hash.indexOf("?") + 1));
  for (const [rawKey, v] of params) {
    const k = normalizeTennisFilterKey(rawKey);
    if (!FILTER_KEYS.includes(k)) continue;
    __filters[k] = NUMERIC_FILTER_KEYS.has(k) ? Number(v) || 0 : v;
  }
}

function filtersToHash() {
  const params = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = __filters[k];
    const empty = v === "" || v === 0 || v == null ||
      (k === "when" && v === "all") || (k === "liquidity" && v === "all") || (k === "sort" && v === "time");
    if (!empty) params.set(k, String(v));
  }
  const s = params.toString();
  history.replaceState(null, "", s ? "#events?" + s : location.pathname);
}

function eventVol(e) {
  return e.markets.reduce((s, m) => s + (m.volume24h ?? 0), 0);
}

function surfaceEdgeBadge(event) {
  const presentation = surfaceEdgePresentation(event);
  return `<span class="surface-edge ${presentation.tone}" title="${esc(presentation.title)}">${presentation.label}</span>`;
}

function eventMatches(e, nowMs) {
  const f = __filters;
  if (f.league && e.league !== f.league) return false;
  if (f.tournament && (e.tournament ?? e.competition) !== f.tournament) return false;
  if (f.round && e.round !== f.round) return false;
  if (f.surface && e.surface !== f.surface) return false;
  if (f.tier && e.tier !== f.tier) return false;
  if (f.country && e.country !== f.country &&
      !e.markets.some((m) => m.playerCountry === f.country)) return false;
  if (f.liquidity === "priced" && !e.markets.some((m) => m.yesBidCents != null && m.yesAskCents != null)) return false;
  if (f.liquidity === "active" && !e.markets.some((m) => m.status === "active")) return false;
  if (f.minVol > 0 && eventVol(e) < f.minVol) return false;
  if (f.maxAsk > 0 && !e.markets.some((m) => m.yesAskCents != null && m.yesAskCents <= f.maxAsk)) return false;
  if (!passesMinimumSurfaceEdge(e, f.minSurfaceEdge)) return false;
  if (f.when !== "all") {
    const DAY = 86_400_000;
    if (f.when === "live") {
      // trading now: any leg active and start time passed (or unknown)
      if (!e.markets.some((m) => m.status === "active")) return false;
      if (e.occurrenceMs != null && e.occurrenceMs > nowMs + 6 * 3_600_000) return false;
    } else {
      if (e.occurrenceMs == null) return false;
      const startOfDay = new Date(nowMs); startOfDay.setHours(0, 0, 0, 0);
      if (f.when === "today" && (e.occurrenceMs < startOfDay.getTime() || e.occurrenceMs >= startOfDay.getTime() + DAY)) return false;
      if (f.when === "24h" && (e.occurrenceMs < nowMs || e.occurrenceMs > nowMs + DAY)) return false;
      if (f.when === "week" && (e.occurrenceMs < nowMs - DAY || e.occurrenceMs > nowMs + 7 * DAY)) return false;
    }
  }
  if (f.q) {
    const hay = [e.title, e.eventTicker, e.tournament, e.competition, e.city, e.country, e.round,
      ...e.markets.map((m) => m.player)].filter(Boolean).join(" ").toLowerCase();
    if (!f.q.toLowerCase().split(/s+/).every((tok) => hay.includes(tok))) return false;
  }
  return true;
}

function sortEvents(events) {
  const f = __filters;
  const arr = events.slice();
  if (f.sort === "volume") arr.sort((a, b) => eventVol(b) - eventVol(a));
  else if (f.sort === "alpha") arr.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
  else arr.sort((a, b) => (a.occurrenceMs ?? Infinity) - (b.occurrenceMs ?? Infinity));
  return arr;
}

function renderEventList() {
  const el = $("#events-list");
  if (!el || !__board) return;
  const nowMs = Date.now();
  let shown = 0, total = 0;
  const seriesPanels = __board.series.map((s) => {
    if (s.state !== "ok") {
      return '<div class="panel"><h2>' + esc(s.series) + " " + badge("bad", "unavailable") + "</h2>" +
        '<div class="err">' + esc(s.reason ?? "fetch failed") + "</div></div>";
    }
    total += s.events.length;
    const events = sortEvents(s.events.filter((e) => eventMatches(e, nowMs)));
    shown += events.length;
    if (events.length === 0) return "";
    const rows = events.map((e) => {
      const geo = [e.city, e.country].filter(Boolean).join(", ");
      const legs = e.markets.map((m) =>
        "<tr><td style='padding-left:1.2rem'><button class='linklike' data-ticker='" + esc(m.ticker) + "'>" + esc(m.player ?? m.ticker) + "</button>" +
        (m.playerCountry ? ' <span class="muted" style="font-size:.75rem">' + esc(m.playerCountry) + "</span>" : "") + "</td>" +
        "<td class='num'>" + px(m.yesBidCents) + "</td><td class='num'>" + px(m.yesAskCents) + "</td>" +
        "<td class='num'>" + px(m.lastCents) + "</td><td class='num'>" + fmtVol(m.volume24h) + "</td>" +
        "<td></td>" +
        "<td>" + (m.status === "active" ? badge("ok", "live") : badge("dim", m.status)) + "</td></tr>").join("");
      return "<tr class='event-summary'><td colspan='5' style='padding-top:.7rem'><strong>" + esc(e.title ?? e.eventTicker) + "</strong> " +
        (e.round ? badge("dim", e.round) + " " : "") +
        (e.tier ? badge("dim", e.tier) + " " : "") +
        (e.surface ? badge("dim", e.surface) + " " : "") +
        "<span class='muted'>" + esc(e.tournament ?? e.competition ?? "") + (geo ? " · " + esc(geo) : "") + " · " + fmtMs(e.occurrenceMs) + " · </span>" +
        "<span class='mono muted' style='font-size:.75rem'>" + esc(e.eventTicker) + "</span></td>" +
        "<td class='num'>" + surfaceEdgeBadge(e) + "</td><td></td></tr>" + legs;
    }).join("");
    return '<div class="panel"><h2>' + esc(s.series) + " " + badge("ok", events.length + " events") + "</h2>" +
      "<table><tr><th>Player</th><th class='num'>Bid</th><th class='num'>Ask</th><th class='num'>Last</th><th class='num'>24h Vol</th><th class='num'>SrfE</th><th>Status</th></tr>" + rows + "</table></div>";
  }).filter(Boolean).join("");
  const countEl = $("#events-count");
  if (countEl) countEl.textContent = shown + " of " + total + " events";
  el.innerHTML = seriesPanels || '<div class="panel"><div class="muted">no events match the current filters</div></div>';
  el.querySelectorAll("[data-ticker]").forEach((b) =>
    b.addEventListener("click", () => tradeTicker(b.dataset.ticker)));
}

async function renderEvents() {
  const el = $("#tab-events");
  if (!__filtersHydrated) { __filtersHydrated = true; filtersFromHash(); }
  let profiles = null, metaAudit = null, tennisHq = null;
  try { __board = await (await fetch("/api/events")).json(); } catch (e) {}
  try { tennisHq = await (await fetch("/api/hq/tennis")).json(); } catch (e) {}
  try { profiles = await (await fetch("/api/profiles?limit=15")).json(); } catch (e) {}
  try { metaAudit = await (await fetch("/api/meta/audit")).json(); } catch (e) {}
  if (!__board) { el.innerHTML = '<div class="panel"><div class="err">/api/events unavailable</div></div>'; return; }

  const enrichmentByTicker = new Map(
    (tennisHq?.liveBoard ?? []).map((event) => [event.eventTicker, event]),
  );
  for (const series of __board.series) {
    for (const event of series.events) {
      const enriched = enrichmentByTicker.get(event.eventTicker);
      event.surfaceEdge = enriched?.surfaceEdge ?? 0;
      event.surfaceEdgePlayers = enriched?.surfaceEdgePlayers ?? [
        event.markets[0]?.player ?? null,
        event.markets[1]?.player ?? null,
      ];
      event.surfaceEdgeSamples = enriched?.surfaceEdgeSamples ?? [0, 0];
      event.surfaceEdgeReliable = enriched?.surfaceEdgeReliable ?? false;
      event.surfaceEdgeEvidence = enriched?.surfaceEdgeEvidence ?? (
        event.surface ? "insufficient-sample" : "missing-surface"
      );
      event.surfaceEdgeScaling = enriched?.surfaceEdgeScaling ?? "dampened";
      event.surface ??= enriched?.surface ?? null;
    }
  }

  const allEvents = __board.series.flatMap((s) => s.events);
  const liveLeagues = [...new Set(allEvents.map((e) => e.league).filter(Boolean))];
  const tournaments = [...new Set(allEvents.map((e) => e.tournament ?? e.competition).filter(Boolean))].sort();
  const countries = [...new Set(allEvents.flatMap((e) =>
    [e.country, ...e.markets.map((m) => m.playerCountry)]).filter(Boolean))].sort();
  const rounds = [...new Set(allEvents.map((e) => e.round).filter(Boolean))].sort((a, b) => {
    const order = (r) => (/Round [Oo]f (d+)/.exec(r)?.[1] ?? (r.startsWith("Quarter") ? 8 : r.startsWith("Semi") ? 4 : r.startsWith("Final") ? 2 : 999));
    return Number(order(b)) - Number(order(a));
  });
  const liveSurfaces = [...new Set(allEvents.map((e) => e.surface).filter(Boolean))];
  const liveTiers = [...new Set(allEvents.map((e) => e.tier).filter(Boolean))];
  // Single write path: GLOSSARY.filterCatalog (API) ∩ live board values — no TIER_ORDER mirror
  const catalogOf = (conceptId) => GLOSSARY.filterCatalog?.[conceptId]
    || (() => {
      const e = (GLOSSARY.entries || []).find((x) => x.id === conceptId);
      return e ? { label: e.label, values: e.values || [], valueLabels: e.valueLabels || {} } : null;
    })();
  const orderByCatalog = (conceptId, live) => {
    const cat = catalogOf(conceptId);
    const preferred = cat?.values || [];
    if (!preferred.length) return [...live].sort((a, b) => a.localeCompare(b));
    const set = new Set(live);
    const out = [];
    for (const v of preferred) {
      if (set.has(v)) { out.push(v); set.delete(v); }
    }
    return [...out, ...[...set].sort((a, b) => a.localeCompare(b))];
  };
  const choicesFromCatalog = (conceptId, live) => {
    const cat = catalogOf(conceptId);
    const preferred = cat?.values || [];
    const labels = cat?.valueLabels || {};
    const ordered = orderByCatalog(conceptId, live);
    const pairs = ordered.map((v) => [v, labels[v] || v]);
    if (preferred.includes("all") || ordered.includes("all")) return pairs;
    return [["", "all"], ...pairs];
  };
  const leagueChoices = choicesFromCatalog("league", liveLeagues);
  const surfaceChoices = choicesFromCatalog("surface", liveSurfaces);
  const tierChoices = choicesFromCatalog("tier", liveTiers);
  const whenChoices = choicesFromCatalog("ui.events.filter.when", ["all", "live", "today", "24h", "week"]);
  const liqChoices = choicesFromCatalog("ui.events.filter.liquidity", ["all", "priced", "active"]);
  const glossLabel = (id, fallback) => {
    const cat = GLOSSARY.filterCatalog?.[id];
    if (cat?.label) return cat.label;
    const e = (GLOSSARY.entries || []).find((x) => x.id === id);
    return e?.label || fallback;
  };
  /** Ungoverned select — prefer selGloss for controlled labels */
  const sel = (name, cur, choices) =>
    '<label>' + esc(name) + '<select name="' + name.toLowerCase() + '">' +
    choices.map(([v, lbl]) => "<option value='" + v + "'" + (v === cur ? " selected" : "") + ">" + lbl + "</option>").join("") +
    "</select></label>";
  /** Governed select — label from glossary when possible + tip(glossaryId) */
  const selGloss = (glossaryId, name, cur, choices) =>
    '<label>' + esc(glossLabel(glossaryId, name)) + tip(glossaryId) +
    '<select name="' + name.toLowerCase() + '">' +
    choices.map(([v, lbl]) => "<option value='" + v + "'" + (v === cur ? " selected" : "") + ">" + lbl + "</option>").join("") +
    "</select></label>";
  const pair = (list) => list.map((v) => [v, v]);

  el.innerHTML =
    '<div class="panel"><h2>' + esc(glossLabel("ui.live_board.title", "Tennis board")) + tip("ui.live_board.title") + " " +
    badge("ok", __board.eventCount + " events · " + __board.marketCount + " markets") +
    ' <span class="muted" id="events-count" style="font-size:.8rem;font-weight:400"></span></h2>' +
    (metaAudit
      ? '<div style="margin:.3rem 0">metadata ' +
        badge(metaAudit.completeness >= 0.99 ? "ok" : metaAudit.completeness >= 0.9 ? "warn" : "bad",
          (metaAudit.completeness * 100).toFixed(1) + "% complete") +
        ' <span class="muted" title="Events pass only with player nationality + tournament country + tier. Gaps are excluded from research/model use.">' +
        metaAudit.completeEvents + "/" + metaAudit.totalEvents + " events pass the enrichment lock" +
        (metaAudit.unknownPlayerFrequency.length
          ? " · unknown: " + metaAudit.unknownPlayerFrequency.slice(0, 4).map((p) => esc(p.player)).join(", ") +
            (metaAudit.unknownPlayerFrequency.length > 4 ? "…" : "")
          : "") + "</span></div>"
      : "") +
    '<div class="muted">open match markets across ATP/WTA/Challenger/ITF · click a player to load the order ticket · updated ' + fmtTime(__board.generatedAt) + "</div>" +
    '<form class="order" id="events-filter" style="margin-top:.6rem">' +
    '<label>Search<input name="q" placeholder="player, event, city…" value="' + esc(__filters.q) + '" /></label>' +
    selGloss("league", "League", __filters.league, leagueChoices) +
    selGloss("ui.events.filter.tournament", "Tournament", __filters.tournament, [["", "all"], ...pair(tournaments)]) +
    selGloss("ui.events.filter.country", "Country", __filters.country, [["", "all"], ...pair(countries)]) +
    selGloss("round", "Round", __filters.round, [["", "all"], ...pair(rounds)]) +
    selGloss("surface", "Surface", __filters.surface, surfaceChoices) +
    selGloss("tier", "Tier", __filters.tier, tierChoices) +
    selGloss("ui.events.filter.when", "When", __filters.when, whenChoices) +
    selGloss("ui.events.filter.liquidity", "Liquidity", __filters.liquidity, liqChoices) +
    '<label>Min 24h vol' + tip("ui.events.filter.min_vol") +
    '<input name="minVol" type="number" min="0" step="1000" value="' + __filters.minVol + '" /></label>' +
    '<label>Max ask ¢' + tip("yesPriceCents") +
    '<input name="maxAsk" type="number" min="0" max="99" value="' + __filters.maxAsk + '" /></label>' +
    '<label>Min surface edge' + tip("ui.events.filter.min_surface_edge") +
    '<input name="minSurfaceEdge" type="number" min="0" max="100" step="1" value="' + __filters.minSurfaceEdge + '" /></label>' +
    selGloss("ui.sort.events", "Sort", __filters.sort, [["time", "start time"], ["volume", "24h volume"], ["alpha", "A–Z"]]) +
    '<button type="button" id="events-clear" class="cancel" style="align-self:flex-end" title="' +
    esc(TOOLTIPS["ui.events.filter.reset"] || "clear") + '">clear' + tip("ui.events.filter.reset") + "</button>" +
    '<button type="button" id="events-preset-value" style="align-self:flex-end">value ≤ 25¢</button>' +
    '<button type="button" id="events-preset-live" style="align-self:flex-end">live & liquid</button>' +
    "</form></div>" +
    '<div id="events-list"></div>' +
    '<div class="panel"><h2>Player profiles' + tip("playerProfiles") + "</h2><div id='profiles-table'></div></div>";

  // Meta: avgKalshiVolumeFp + lastSeenAtMs + profilesSource (docs/PLAYER_PROFILES_META.md)
  const profilesSource = (profiles && profiles.profilesSource) || (profiles && profiles.state === "ok" ? "warehouse" : "seed");
  const sourceBadge = '<span class="badge ' + (profilesSource === "warehouse" ? "ok" : "dim") + '" title="profilesSource">' +
    (profilesSource === "warehouse" ? "warehouse" : "seed") + "</span>";
  const lastSeenDate = (p) => {
    const ms = p.lastSeenAtMs;
    if (ms == null || !(ms > 0)) return "—";
    try { return esc(new Date(ms).toISOString().slice(0, 10)); } catch { return "—"; }
  };
  const fmtSurfaces = (s) => {
    if (!s || typeof s !== "object") return "—";
    return Object.entries(s).map(([k, v]) => {
      if (v != null && typeof v === "object") {
        const apps = v.apps != null ? v.apps : (v.wins || 0) + (v.losses || 0);
        if ((v.wins || 0) + (v.losses || 0) > 0) return k + " " + apps + " (" + v.wins + "–" + v.losses + ")";
        return k + " " + apps;
      }
      return k + " " + v;
    }).join(" · ");
  };
  const profRows = profiles && profiles.state === "ok" ? profiles.players.map((p) =>
    "<tr><td>" + esc(p.name) + (p.country ? ' <span class="muted" style="font-size:.75rem">' + esc(p.country) + "</span>" : "") + "</td><td class='num'>" + p.appearances + "</td>" +
    "<td class='num'>" + p.wins + "–" + p.losses + "</td>" +
    "<td class='num'>" + (p.winRate != null ? (p.winRate * 100).toFixed(0) + "%" : "—") + "</td>" +
    "<td class='muted'>" + esc(fmtSurfaces(p.surfaces)) + "</td>" +
    "<td class='num'>" + fmtVol(p.avgKalshiVolumeFp) + "</td>" +
    "<td class='muted' style='font-size:.75rem'>" + lastSeenDate(p) + "</td></tr>").join("") : "";
  $("#profiles-table").innerHTML = profRows
    ? "<div style='margin-bottom:.4rem;font-size:.8rem' class='muted'>Source " + sourceBadge +
      " · sorted by avgKalshiVolumeFp · rebuild: <code>bun run tennis:profiles:build</code></div>" +
      "<table><tr><th>Player</th><th class='num'>Apps</th><th class='num'>W–L</th><th class='num'>Win%</th><th>Surfaces</th>" +
      "<th class='num'>Avg Vol (Fp)" + tip("avgKalshiVolumeFp") + "</th>" +
      "<th>Last seen" + tip("lastSeenAtMs") + "</th></tr>" +
      profRows + "</table>"
    : '<div class="muted">' + esc(profiles && profiles.reason ? profiles.reason : "profiles unavailable — run bun run tennis:profiles:build") +
      ' · source ' + sourceBadge + tip("profilesSource") + "</div>";

  const filterForm = $("#events-filter");
  const readForm = () => {
    __filters.q = filterForm.q.value.trim();
    __filters.league = filterForm.league.value;
    __filters.tournament = filterForm.tournament.value;
    __filters.country = filterForm.country.value;
    __filters.round = filterForm.round.value;
    __filters.surface = filterForm.surface.value;
    __filters.tier = filterForm.tier.value;
    __filters.when = filterForm.when.value;
    __filters.liquidity = filterForm.liquidity.value;
    __filters.minVol = Number(filterForm.minvol?.value ?? filterForm.minVol?.value ?? 0) || 0;
    __filters.maxAsk = Number(filterForm.maxask?.value ?? filterForm.maxAsk?.value ?? 0) || 0;
    __filters.minSurfaceEdge = Number(filterForm.minSurfaceEdge?.value ?? 0) || 0;
    __filters.sort = filterForm.sort.value;
  };
  let debounce = null;
  filterForm.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { readForm(); filtersToHash(); renderEventList(); }, 200);
  });
  $("#events-clear").addEventListener("click", () => {
    Object.assign(__filters, { q: "", league: "", tournament: "", country: "", round: "",
      surface: "", tier: "", when: "all", liquidity: "all", minVol: 0, maxAsk: 0,
      minSurfaceEdge: 0, sort: "time" });
    filtersToHash();
    renderEvents();
  });
  $("#events-preset-value").addEventListener("click", () => {
    Object.assign(__filters, { maxAsk: 25, liquidity: "priced", sort: "volume" });
    filtersToHash();
    renderEvents();
  });
  $("#events-preset-live").addEventListener("click", () => {
    Object.assign(__filters, { when: "live", liquidity: "active", sort: "volume" });
    filtersToHash();
    renderEvents();
  });
  renderEventList();
}

function renderAlpha(hq) {  const cards = hq.alpha.map((p) => {
    const hasGate = Boolean(p.gates.shadowMinSignals);
    const signals = p.shadow ? p.shadow.signals : 0;
    return '<div class="panel"><h2>' + esc(p.name) + " " +
      badge(p.status === "shadow" ? "warn" : "dim", p.status) + " " + badge("dim", p.role) + "</h2>" +
      (p.hypothesis ? '<div class="muted" style="margin-bottom:.5rem">' + esc(p.hypothesis) + "</div>" : "") +
      '<div class="grid">' +
      kpiCard("Shadow progress", {
        value: hasGate ? signals : "—",
        unit: hasGate ? "of " + p.gates.shadowMinSignals + " signals" : "",
        stats: p.shadow
          ? [["Resolutions", p.shadow.resolutions], ["Last signal", fmtTime(p.shadow.lastAt)]]
          : [],
        footer: p.shadow ? "" : "no shadow log",
      }) +
      kpiCard("Gates", {
        value: Object.keys(p.gates).length, unit: "rules",
        stats: Object.entries(p.gates).map(([k, v]) => [k, esc(v)]),
      }) +
      "</div></div>";
  }).join("");
  const cal = hq.calibration;
  $("#tab-alpha").innerHTML = (cards || '<div class="panel"><div class="muted">No alpha programs under alpha/</div></div>') +
    '<div class="panel"><h2>Calibration</h2>' +
    (cal ? '<div class="mono">' + esc(cal.runId) + ' <span class="muted">' + fmtTime(cal.at) + "</span></div>" +
      '<div class="muted">' + cal.totalRuns + " artifact runs</div>"
      : '<div class="muted">no calibration runs</div>') + "</div>";
}

function renderOps(ops) {
  if (!ops) { $("#tab-ops").innerHTML = '<div class="panel"><div class="err">/ops.json unavailable</div></div>'; return; }
  const agents = Object.entries(ops.agents || {}).map(([k, v]) =>
    badge(v ? "ok" : "bad", k)).join(" ");
  const flows = (ops.flows || []).map((f) =>
    "<tr><td class='mono'>" + esc(f.label) + "</td>" +
    "<td>" + (f.launchdLoaded == null ? badge("dim", "?") : f.launchdLoaded ? badge("ok", "loaded") : badge("bad", "not loaded")) + "</td>" +
    "<td class='mono'>" + fmtTime(f.lastFireAt) + "</td>" +
    "<td class='num'>" + f.periodMin + " min</td></tr>").join("");
  const ticks = (ops.ticks || []).slice(0, 10).map((t) =>
    "<tr><td class='mono'>" + esc(t.slug ?? t.market ?? "?") + "</td>" +
    "<td class='num'>" + esc(t.price ?? t.last ?? "—") + "</td></tr>").join("");
  $("#tab-ops").innerHTML =
    '<div class="panel"><h2>Agents</h2>' + agents + "</div>" +
    '<div class="cols">' +
    '<div class="panel"><h2>Cron flows</h2>' + (flows ? "<table><tr><th>Flow</th><th>launchd</th><th>Last fire</th><th class='num'>Period</th></tr>" + flows + "</table>" : '<div class="muted">none</div>') + "</div>" +
    '<div class="panel"><h2>Latest ticks</h2>' + (ticks ? "<table><tr><th>Market</th><th class='num'>Price</th></tr>" + ticks + "</table>" : '<div class="muted">no ticks — POST /polymarket/ingest</div>') + "</div>" +
    "</div>" +
    '<div class="panel"><h2>Canary</h2>' +
    (ops.canary ? '<div class="mono">' + esc(ops.canary.at) + " · exit " + ops.canary.exitCode + " · watched " + ops.canary.watched + " · live " + ops.canary.live + "</div>"
      : '<div class="muted">no canary artifact</div>') +
    ' · <a href="/ops">full ops page →</a></div>';
}

function fmtAge(min) {
  if (min == null) return "no data";
  if (min < 60) return min + "m ago";
  if (min < 60 * 24) return Math.round(min / 60) + "h ago";
  return Math.round(min / 60 / 24) + "d ago";
}

function renderFreshness(f) {
  if (!f) return;
  $("#freshness").innerHTML = Object.entries(f).map(([section, e]) => {
    const cls = e.stale ? "bad" : "ok";
    const label = section + ": " + fmtAge(e.ageMinutes) + (e.stale ? " · stale" : "");
    const title = e.at ? "data at " + e.at + " · cadence " + (e.staleAfterMinutes / 60) + "h" : "no data yet";
    return '<span class="badge ' + cls + '" title="' + title + '" style="cursor:help">' + esc(label) + "</span>";
  }).join("");
}

async function refresh() {
  let hq = null, ops = null;
  try { hq = await (await fetch("/api/hq")).json(); } catch (e) {}
  try { ops = await (await fetch("/ops.json")).json(); } catch (e) {}
  if (!hq) { $("#stamp").textContent = "API unavailable"; return; }
  $("#stamp").textContent = "updated " + new Date().toLocaleTimeString();
  renderFreshness(hq.freshness);
  window.__hqHistory = hq.history ?? [];
  renderOverview(hq, ops);
  renderResearch(hq);
  renderTrading(hq);
  renderEvents();
  renderMonitor(hq, ops);
  renderAlpha(hq);
  renderOps(ops);
}

document.querySelectorAll("nav.tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("nav.tabs button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll("section.tab").forEach((s) =>
      s.classList.toggle("active", s.id === "tab-" + b.dataset.tab));
  }));

// ── Glossary panel (slide-over) + #glossary:id deeplinks ──

function glossaryQuery() {
  return ($("#glossary-search")?.value || "").trim().toLowerCase();
}

function renderGlossaryBody(highlightId) {
  const body = $("#glossary-body");
  if (!body) return;
  const q = glossaryQuery();
  const entries = GLOSSARY.entries || [];
  const cats = GLOSSARY.categories?.length
    ? GLOSSARY.categories
    : [...new Set(entries.map((e) => e.category))].map((id) => ({
        id,
        label: id,
      }));

  if (!entries.length) {
    body.innerHTML =
      '<div class="glossary-empty">Loading glossary… (or GET /api/glossary failed)</div>';
    return;
  }

  let html = "";
  let any = false;
  for (const cat of cats) {
    const list = entries.filter((e) => {
      if (e.category !== cat.id) return false;
      if (!q) return true;
      const hay = [e.id, e.label, e.description, ...(e.synonyms || [])]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    if (!list.length) continue;
    any = true;
    html += '<div class="glossary-cat">' + esc(cat.label) + "</div>";
    for (const e of list) {
      const hi = highlightId && e.id === highlightId ? " highlight" : "";
      html +=
        '<div class="glossary-entry' +
        hi +
        '" id="glossary-entry-' +
        esc(e.id) +
        '" data-id="' +
        esc(e.id) +
        '">' +
        "<h3>" +
        esc(e.label) +
        ' <span class="gid">' +
        esc(e.id) +
        "</span></h3>" +
        "<p>" +
        esc(e.description) +
        "</p>" +
        (e.synonyms?.length
          ? '<div class="syn">also: ' + esc(e.synonyms.join(", ")) + "</div>"
          : "") +
        (e.values?.length
          ? '<div class="syn">values: ' + esc(e.values.join(" · ")) + "</div>"
          : "") +
        "</div>";
    }
  }
  body.innerHTML = any
    ? html
    : '<div class="glossary-empty">No terms match “' + esc(q) + '”.</div>';

  if (highlightId) {
    const el = document.getElementById("glossary-entry-" + highlightId);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function openGlossary(focusId) {
  const panel = $("#glossary-panel");
  const backdrop = $("#glossary-backdrop");
  if (!panel) return;
  panel.hidden = false;
  if (backdrop) backdrop.hidden = false;
  renderGlossaryBody(focusId || undefined);
  if (focusId) {
    const next = "#glossary:" + focusId;
    if (location.hash !== next) history.replaceState(null, "", next);
  } else if (!location.hash.startsWith("#glossary")) {
    history.replaceState(null, "", "#glossary");
  }
  $("#glossary-search")?.focus();
}

function closeGlossary() {
  const panel = $("#glossary-panel");
  const backdrop = $("#glossary-backdrop");
  if (panel) panel.hidden = true;
  if (backdrop) backdrop.hidden = true;
  if (location.hash.startsWith("#glossary")) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

function parseGlossaryHash() {
  const h = location.hash || "";
  if (h === "#glossary") return { open: true, id: null };
  const m = /^#glossary:([A-Za-z0-9_]+)$/.exec(h);
  if (m) return { open: true, id: m[1] };
  return { open: false, id: null };
}

$("#glossary-open")?.addEventListener("click", () => openGlossary());
$("#glossary-close")?.addEventListener("click", closeGlossary);
$("#glossary-backdrop")?.addEventListener("click", closeGlossary);
$("#glossary-search")?.addEventListener("input", () => renderGlossaryBody());

document.addEventListener("click", (ev) => {
  const t = ev.target;
  if (!(t instanceof Element)) return;
  const el = t.closest("[data-glossary]");
  if (!el) return;
  const id = el.getAttribute("data-glossary");
  if (id) {
    ev.preventDefault();
    openGlossary(id);
  }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && $("#glossary-panel") && !$("#glossary-panel").hidden) {
    closeGlossary();
  }
});

// Deep link: #events?… opens the Events tab with filters hydrated
if (location.hash.startsWith("#events")) {
  const btn = document.querySelector('nav.tabs button[data-tab="events"]');
  if (btn) btn.click();
}

// Deep link: #glossary or #glossary:mid
{
  const g = parseGlossaryHash();
  if (g.open) openGlossary(g.id || undefined);
}
window.addEventListener("hashchange", () => {
  const g = parseGlossaryHash();
  if (g.open) openGlossary(g.id || undefined);
  else if ($("#glossary-panel") && !$("#glossary-panel").hidden) closeGlossary();
});

// Profiles column headers use glossary-backed tips
// (tip already used on playerProfiles panel title)

refresh();
setInterval(refresh, 30_000);
