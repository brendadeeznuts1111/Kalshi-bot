#!/usr/bin/env bun
/**
 * Bake inventory coverage board HTML.
 *
 * Sports are **columns**. Rows include inventory metrics, id planes (feed /
 * widget / api), period unit, and a market-type × sport matrix (known catalog
 * + live.sports flags + wagerType counts).
 *
 *   bun run inventory:coverage-board
 *   bun tools/bake-inventory-coverage-board.ts -- --out=docs/artifacts/inventory-coverage-board.html
 */
import { argValue } from '../src/cli/argv.ts';
import { openEventStore } from '../src/institutions/event-store/open-db.ts';
import { DEFAULT_EVENT_STORE_DB } from '../src/institutions/event-store/paths.ts';
import {
  defaultWidgetDomainCachePath,
  type WidgetDomainSnapshot,
} from '../src/domain/widget-domain-extract.ts';
import { listCompetitions } from '../src/domain/competitions.ts';
import {
  buildMarketMatrix,
  buildSportColumns,
  buildWagerFamilyRows,
  pandoraLeaguesBySport,
} from '../src/inventory/coverage-board.ts';


async function main(): Promise<void> {
  const out =
    argValue('out') ?? 'docs/artifacts/inventory-coverage-board.html';
  const bookId = argValue('book') ?? 'fantasy402';
  const snapPath = argValue('snapshot') ?? defaultWidgetDomainCachePath();

  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });

  const eventRows = db
    .query(
      `SELECT sport AS sport,
              COUNT(*) AS n,
              SUM(CASE WHEN odds_event_id IS NOT NULL AND TRIM(odds_event_id) != '' THEN 1 ELSE 0 END) AS linked
       FROM skin_events WHERE book_id = $book
       GROUP BY sport ORDER BY n DESC`
    )
    .all({ $book: bookId }) as Array<{ sport: string; n: number; linked: number }>;

  const leagueRows = db
    .query(
      `SELECT inventory_bucket AS sport,
              COUNT(*) AS n,
              SUM(CASE WHEN competition_id IS NOT NULL THEN 1 ELSE 0 END) AS mapped
       FROM inventory_leagues WHERE book_id = $book
       GROUP BY inventory_bucket ORDER BY n DESC`
    )
    .all({ $book: bookId }) as Array<{ sport: string; n: number; mapped: number }>;

  const topUnmapped = db
    .query(
      `SELECT inventory_bucket AS sport, league_key AS league,
              peak_event_count AS peak, event_count_live AS live
       FROM inventory_leagues
       WHERE book_id = $book AND competition_id IS NULL
       ORDER BY peak_event_count DESC, event_count_live DESC
       LIMIT 20`
    )
    .all({ $book: bookId }) as Array<{
    sport: string;
    league: string;
    peak: number;
    live: number;
  }>;

  const sampleLinked = db
    .query(
      `SELECT sport, league, home, away, odds_event_id AS odds, inventory_id AS inv
       FROM skin_events
       WHERE book_id = $book
         AND odds_event_id IS NOT NULL AND TRIM(odds_event_id) != ''
       ORDER BY last_updated DESC
       LIMIT 12`
    )
    .all({ $book: bookId }) as Array<{
    sport: string;
    league: string | null;
    home: string | null;
    away: string | null;
    odds: string;
    inv: string;
  }>;

  let snap: WidgetDomainSnapshot | null = null;
  const snapFile = Bun.file(snapPath);
  if (await snapFile.exists()) {
    snap = (await snapFile.json()) as WidgetDomainSnapshot;
  }

  const pandoraBySport = snap ? pandoraLeaguesBySport(snap) : {};
  const sports = buildSportColumns({
    eventRows,
    leagueRows,
    pandoraLeagueBySport: pandoraBySport,
  });

  const marketMatrix = snap
    ? buildMarketMatrix({
        liveSports: snap.liveSports ?? [],
        sportOrder: sports.map(s => s.sport),
        wagerTypes: snap.wagerTypes ?? [],
      })
    : {
        marketIds: [],
        sports: [],
        cells: {},
        labels: {},
        wagerTypeCounts: {},
      };

  const wagerFamilies = snap
    ? buildWagerFamilyRows(snap.wagerTypes ?? [], 18)
    : [];

  const totalEvents = sports.reduce((s, r) => s + r.events, 0);
  const totalLinked = sports.reduce((s, r) => s + r.linked, 0);
  const totalLeagues = sports.reduce((s, r) => s + r.leagues, 0);
  const totalMapped = sports.reduce((s, r) => s + r.mapped, 0);
  const linkedPct = totalEvents
    ? Math.round((totalLinked / totalEvents) * 100)
    : 0;

  const data = {
    generatedAt: new Date().toISOString(),
    identity: {
      skinId: 'buckeye',
      bookId,
      inventoryLiveProduct: 'plive',
    },
    coversLiveProducts: ['plive', 'ezlive'],
    odds: {
      bookId,
      total: totalEvents,
      linked: totalLinked,
      unlinked: totalEvents - totalLinked,
      linkedPct,
    },
    leagues: {
      total: totalLeagues,
      unmapped: totalLeagues - totalMapped,
      liveNow: 0,
      pandoraTotal: snap?.liveLeagues?.length ?? 0,
    },
    competitions: listCompetitions().length,
    wagerTypeTotal: snap?.wagerTypes?.length ?? 0,
    sports: sports.map(s => s.sport),
    bySportCols: Object.fromEntries(sports.map(s => [s.sport, s])),
    marketMatrix,
    wagerFamilies,
    topUnmapped,
    sampleLinked: sampleLinked.map(r => ({
      sport: r.sport,
      league: r.league ?? '—',
      home: r.home ?? '?',
      away: r.away ?? '?',
      odds: r.odds,
      inv: r.inv,
    })),
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Inventory coverage board · sports as columns</title>
  <style>
    :root {
      --bg: #0c0f14; --panel: #141a22; --panel2: #1a222d; --border: #2a3544;
      --text: #e8eef6; --muted: #8b9bb0; --accent: #5b9fd4; --ok: #3dba7a;
      --warn: #e0a44c; --bad: #e05a5a; --plive: #6c9ef8; --ezlive: #c084fc;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --sans: "IBM Plex Sans", system-ui, -apple-system, Segoe UI, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: var(--sans); color: var(--text); line-height: 1.45; min-height: 100vh;
      background: radial-gradient(1200px 600px at 10% -10%, #1a2740 0%, transparent 50%),
                  radial-gradient(900px 500px at 100% 0%, #2a1a40 0%, transparent 45%), var(--bg);
    }
    header {
      padding: 1.75rem 1.5rem 1rem; border-bottom: 1px solid var(--border);
      background: rgba(12,15,20,0.75); backdrop-filter: blur(8px); position: sticky; top: 0; z-index: 10;
    }
    header h1 { margin: 0 0 0.35rem; font-size: 1.35rem; font-weight: 650; letter-spacing: -0.02em; }
    header p { margin: 0; color: var(--muted); font-size: 0.92rem; max-width: 78rem; }
    .meta { margin-top: 0.65rem; display: flex; flex-wrap: wrap; gap: 0.5rem 1rem;
      font-family: var(--mono); font-size: 0.78rem; color: var(--muted); }
    main { padding: 1.25rem 1.5rem 3rem; max-width: 1500px; margin: 0 auto; display: grid; gap: 1rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; }
    .card {
      background: linear-gradient(180deg, var(--panel2), var(--panel));
      border: 1px solid var(--border); border-radius: 12px; padding: 1rem 1.05rem; overflow-x: auto;
    }
    .card h2 {
      margin: 0 0 0.75rem; font-size: 0.78rem; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--muted); font-weight: 600;
    }
    .stat { font-size: 1.65rem; font-weight: 650; letter-spacing: -0.03em; }
    .stat small { display: block; font-size: 0.72rem; color: var(--muted); font-weight: 500; margin-top: 0.2rem; }
    .stat.ok { color: var(--ok); } .stat.warn { color: var(--warn); }
    .stat.bad { color: var(--bad); } .stat.accent { color: var(--accent); }
    .badge {
      display: inline-block; padding: 0.12rem 0.45rem; border-radius: 999px;
      font-family: var(--mono); font-size: 0.72rem; border: 1px solid var(--border);
    }
    .badge.plive { color: var(--plive); border-color: #3a5a90; }
    .badge.ezlive { color: var(--ezlive); border-color: #6b4a90; }
    table.matrix { width: 100%; border-collapse: collapse; font-size: 0.8rem; min-width: 720px; }
    table.matrix th, table.matrix td {
      border: 1px solid var(--border); padding: 0.4rem 0.45rem; text-align: center; white-space: nowrap;
    }
    table.matrix th { background: rgba(0,0,0,0.25); font-weight: 600; font-size: 0.7rem; }
    table.matrix th.row-h, table.matrix td.row-h {
      text-align: left; font-weight: 600; color: var(--muted);
      position: sticky; left: 0; background: var(--panel); z-index: 1; min-width: 8.5rem;
    }
    table.matrix th.sport {
      color: var(--accent); font-family: var(--mono); font-size: 0.68rem; max-width: 6.5rem;
      overflow: hidden; text-overflow: ellipsis;
    }
    table.matrix td.num { font-family: var(--mono); font-variant-numeric: tabular-nums; }
    table.matrix tr.section td { background: rgba(91,159,212,0.08); color: var(--accent);
      text-align: left; font-size: 0.72rem; letter-spacing: 0.04em; text-transform: uppercase; }
    .cell-primary { color: var(--ok); font-weight: 650; }
    .cell-secondary { color: var(--warn); }
    .cell-yes { color: var(--text); }
    .cell-empty { color: #3a4555; }
    .callout {
      border-radius: 10px; padding: 0.85rem 1rem; border: 1px solid var(--border);
      background: rgba(224,164,76,0.08); font-size: 0.9rem; color: var(--muted);
    }
    .callout strong { color: var(--warn); }
    .bar { height: 6px; background: #243040; border-radius: 3px; overflow: hidden; }
    .bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), var(--ok)); }
    .legend { display: flex; flex-wrap: wrap; gap: 0.75rem; font-size: 0.78rem; color: var(--muted); margin-bottom: 0.65rem; }
    pre {
      margin: 0; padding: 0.85rem 1rem; background: #0a0d12; border-radius: 8px;
      font-family: var(--mono); font-size: 0.78rem; overflow-x: auto; color: var(--muted);
    }
    footer { margin-top: 0.75rem; font-size: 0.78rem; color: var(--muted); }
    .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .chip {
      border: 1px solid var(--border); border-radius: 8px; padding: 0.35rem 0.55rem;
      font-size: 0.75rem; background: rgba(0,0,0,0.2);
    }
    .chip b { color: var(--accent); font-family: var(--mono); }
    .chip .n { color: var(--muted); font-family: var(--mono); }
  </style>
</head>
<body>
  <header>
    <h1>Inventory coverage board</h1>
    <p>
      <strong>Each sport is a column.</strong>
      Inventory metrics · feed/widget/api planes · period units · market-type flags
      (Pandora <code>live.sports.m</code>) · wager-type catalog depth.
    </p>
    <div class="meta">
      <span id="gen">generated —</span>
      <span>skin=<strong style="color:var(--text)">buckeye</strong></span>
      <span>book=<strong style="color:var(--text)">fantasy402</strong></span>
      <span class="badge plive">plive</span>
      <span class="badge ezlive">ezlive shared</span>
    </div>
  </header>

  <main>
    <section class="grid" id="kpis"></section>

    <div class="callout">
      <strong>Odds link is the main gap.</strong>
      Only <span id="linkPct">—</span>% of board events have <code>odds_event_id</code>.
      Stream-list has no prices; enrich stamps Statscore client id by name match only.
    </div>

    <section class="card">
      <h2>Coverage · sport columns</h2>
      <div class="legend">
        <span>Rows = metrics / planes · columns = sports (event count order)</span>
      </div>
      <table class="matrix" id="sportMatrix"></table>
    </section>

    <section class="card">
      <h2>Market type × sport</h2>
      <div class="legend">
        <span class="cell-primary">● primary</span>
        <span class="cell-secondary">● secondary</span>
        <span class="cell-yes">● offered</span>
        <span class="cell-empty">— not flagged</span>
        <span>catalog n = live.wagerTypes with that typeId</span>
      </div>
      <p style="margin:0 0 0.65rem;color:var(--muted);font-size:0.82rem">
        Known Pandora/ticket market ids always listed. Flags merge all feed shells for a sport
        (e.g. Soccer + Top Soccer + WC). <code>n=…</code> is wagerTypes catalog size for that family.
      </p>
      <table class="matrix" id="marketMatrix"></table>
    </section>

    <section class="card">
      <h2>Wager type families (catalog depth)</h2>
      <div class="chips" id="wagerChips"></div>
    </section>

    <section class="card">
      <h2>Unmapped leagues</h2>
      <table class="matrix" style="min-width:0">
        <thead><tr><th class="row-h">Sport</th><th class="row-h">League</th><th>Peak</th><th>Live</th></tr></thead>
        <tbody id="unmapped"></tbody>
      </table>
    </section>

    <section class="card">
      <h2>Sample linked events</h2>
      <table class="matrix" style="min-width:0">
        <thead><tr><th class="row-h">Sport</th><th class="row-h">Matchup</th><th>odds_event_id</th><th>inv</th></tr></thead>
        <tbody id="linked"></tbody>
      </table>
    </section>

    <section class="card">
      <h2>Operator commands</h2>
      <pre>bun run inventory:coverage-board
bun run domain:sports -- --feed
bun run domain:sports -- --periods
bun run domain:widget-extract -- --write   # refresh market flags + leagues
bun run inventory:sync -- --sport=all --dry-run
bun run inventory:enrich</pre>
      <footer>Board: <code>${out}</code> · builders: <code>src/inventory/coverage-board.ts</code></footer>
    </section>
  </main>

  <script>
    const DATA = ${JSON.stringify(data)};

    const o = DATA.odds;
    const L = DATA.leagues;
    const mapPct = L.total ? Math.round(((L.total - L.unmapped) / L.total) * 100) : 0;
    document.getElementById("gen").textContent = "generated " + DATA.generatedAt;
    document.getElementById("linkPct").textContent = String(o.linkedPct);

    document.getElementById("kpis").innerHTML = \`
      <div class="card"><h2>Board events</h2><div class="stat accent">\${o.total}<small>skin_events</small></div></div>
      <div class="card"><h2>Odds linked</h2><div class="stat \${o.linkedPct < 10 ? "bad" : o.linkedPct < 50 ? "warn" : "ok"}">\${o.linked}<small>\${o.linkedPct}% · \${o.unlinked} unlinked</small></div>
        <div class="bar" style="margin-top:0.55rem"><i style="width:\${o.linkedPct}%"></i></div></div>
      <div class="card"><h2>Durable leagues</h2><div class="stat">\${L.total}<small>\${L.unmapped} unmapped</small></div></div>
      <div class="card"><h2>Pandora leagues</h2><div class="stat accent">\${L.pandoraTotal || 0}<small>live.leagues snapshot</small></div></div>
      <div class="card"><h2>COMPETITIONS</h2><div class="stat">\${DATA.competitions}<small>\${mapPct}% league map</small></div></div>
      <div class="card"><h2>Wager types</h2><div class="stat">\${DATA.wagerTypeTotal}<small>catalog products</small></div></div>
    \`;

    const sports = DATA.sports || [];
    const cols = DATA.bySportCols || {};

    function cell(v) {
      if (v == null || v === "") return "—";
      return String(v);
    }

    const rowDefs = [
      { section: "Inventory" },
      { key: "events", label: "Events", num: true },
      { key: "linked", label: "Odds linked", num: true },
      { key: "fillPct", label: "Link fill %", num: true },
      { key: "leagues", label: "Inv. leagues", num: true },
      { key: "mapped", label: "Mapped", num: true },
      { key: "mapPct", label: "Map %", num: true },
      { key: "pandoraLeagues", label: "Pandora leagues", num: true },
      { section: "Id planes" },
      { key: "feedSportId", label: "feedSportId", num: true },
      { key: "widgetSportId", label: "widgetSportId", num: true },
      { key: "apiSportId", label: "apiSportId", num: true },
      { section: "Periods (baked)" },
      { key: "periodUnit", label: "Unit (s1…)" },
      { key: "periodS1", label: "s1 label" },
      { key: "bindingStatus", label: "Binding status" },
    ];

    let sportHtml = "<thead><tr><th class=\\"row-h\\">Metric</th>" +
      sports.map(s => \`<th class="sport" title="\${s}">\${s}</th>\`).join("") +
      "</tr></thead><tbody>";
    for (const row of rowDefs) {
      if (row.section) {
        sportHtml += \`<tr class="section"><td class="row-h" colspan="\${sports.length + 1}">\${row.section}</td></tr>\`;
        continue;
      }
      sportHtml += \`<tr><td class="row-h">\${row.label}</td>\`;
      for (const s of sports) {
        const v = cols[s] ? cols[s][row.key] : null;
        sportHtml += \`<td class="\${row.num ? "num" : ""}">\${cell(v)}</td>\`;
      }
      sportHtml += "</tr>";
    }
    sportHtml += "</tbody>";
    document.getElementById("sportMatrix").innerHTML = sportHtml;

    const mm = DATA.marketMatrix || { marketIds: [], sports: [], cells: {}, labels: {}, wagerTypeCounts: {} };
    let mktHtml = "<thead><tr><th class=\\"row-h\\">Market type</th>" +
      (mm.sports || []).map(s => \`<th class="sport" title="\${s}">\${s}</th>\`).join("") +
      "</tr></thead><tbody>";
    for (const mid of mm.marketIds || []) {
      const lab = (mm.labels && mm.labels[mid]) || ("market:" + mid);
      const n = (mm.wagerTypeCounts && mm.wagerTypeCounts[mid]) || 0;
      const nLab = n ? \` <span style="color:var(--muted);font-family:var(--mono);font-weight:500">n=\${n}</span>\` : "";
      mktHtml += \`<tr><td class="row-h"><span style="color:var(--accent);font-family:var(--mono)">\${mid}</span> · \${lab}\${nLab}</td>\`;
      for (const s of mm.sports || []) {
        const c = (mm.cells[mid] && mm.cells[mid][s]) || "—";
        let cls = "cell-empty", text = c;
        if (c === "primary") { cls = "cell-primary"; text = "primary"; }
        else if (c === "secondary") { cls = "cell-secondary"; text = "secondary"; }
        else if (c === "yes") { cls = "cell-yes"; text = "yes"; }
        mktHtml += \`<td class="\${cls}">\${text}</td>\`;
      }
      mktHtml += "</tr>";
    }
    if (!(mm.marketIds || []).length) {
      mktHtml += '<tr><td class="row-h" colspan="99">No snapshot — run domain:widget-extract -- --write</td></tr>';
    }
    mktHtml += "</tbody>";
    document.getElementById("marketMatrix").innerHTML = mktHtml;

    document.getElementById("wagerChips").innerHTML = (DATA.wagerFamilies || []).map(f => {
      const id = f.typeId == null ? "?" : String(f.typeId);
      const known = f.knownLabel ? \` · \${f.knownLabel}\` : "";
      return \`<div class="chip"><b>tp=\${id}</b>\${known}<div class="n">\${f.count} · \${f.sampleName}</div></div>\`;
    }).join("") || "<span style='color:var(--muted)'>no wagerTypes in snapshot</span>";

    document.getElementById("unmapped").innerHTML = (DATA.topUnmapped || []).map(r =>
      \`<tr><td class="row-h">\${r.sport}</td><td class="row-h">\${r.league}</td><td class="num">\${r.peak}</td><td class="num">\${r.live}</td></tr>\`
    ).join("");

    document.getElementById("linked").innerHTML = (DATA.sampleLinked || []).map(r =>
      \`<tr>
        <td class="row-h">\${r.sport}</td>
        <td class="row-h">\${r.home} vs \${r.away}<div style="color:var(--muted);font-size:0.78rem">\${r.league}</div></td>
        <td class="num">\${r.odds}</td>
        <td class="num">\${r.inv}</td>
      </tr>\`
    ).join("");
  </script>
</body>
</html>
`;

  await Bun.write(out, html);
  console.error(
    `wrote ${out} · sports=${sports.length} events=${totalEvents} linked=${totalLinked} ` +
      `markets=${marketMatrix.marketIds.length} wagerFamilies=${wagerFamilies.length}`
  );
}

await main();
