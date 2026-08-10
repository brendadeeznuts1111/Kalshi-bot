#!/usr/bin/env bun
/**
 * Bake inventory coverage board HTML.
 *
 * Sports are **columns** (not rows). Market-type matrix shows live.sports `m`
 * flags (primary/secondary) × sport.
 *
 *   bun tools/bake-inventory-coverage-board.ts
 *   bun tools/bake-inventory-coverage-board.ts -- --out=docs/artifacts/inventory-coverage-board.html
 */
import { openEventStore } from '../src/institutions/event-store/open-db.ts';
import { DEFAULT_EVENT_STORE_DB } from '../src/institutions/event-store/paths.ts';
import { KNOWN_MARKET_LABELS } from '../src/domain/odds-selection.ts';
import {
  defaultWidgetDomainCachePath,
  type WidgetDomainSnapshot,
} from '../src/domain/widget-domain-extract.ts';
import { sportIdFromFeedSportId } from '../src/domain/pandora-feed-sports.ts';
import { listCompetitions } from '../src/domain/competitions.ts';

function argValue(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

type SportCol = {
  sport: string;
  events: number;
  linked: number;
  leagues: number;
  mapped: number;
};

type MarketCell = 'primary' | 'secondary' | 'yes' | '—';

function flagRole(v: unknown): MarketCell | null {
  if (v === 'primary') return 'primary';
  if (v === 'secondary') return 'secondary';
  if (v === true || v === 1 || v === '1' || v === 'true') return 'yes';
  if (v == null || v === false) return null;
  return 'yes';
}

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

  const bySport = new Map<string, SportCol>();
  for (const r of eventRows) {
    const sport = r.sport || '?';
    bySport.set(sport, {
      sport,
      events: Number(r.n) || 0,
      linked: Number(r.linked) || 0,
      leagues: 0,
      mapped: 0,
    });
  }
  for (const r of leagueRows) {
    const sport = r.sport || '?';
    const cur = bySport.get(sport) ?? {
      sport,
      events: 0,
      linked: 0,
      leagues: 0,
      mapped: 0,
    };
    cur.leagues = Number(r.n) || 0;
    cur.mapped = Number(r.mapped) || 0;
    bySport.set(sport, cur);
  }

  // Column order: highest event count first
  const sports = [...bySport.values()].sort(
    (a, b) => b.events - a.events || a.sport.localeCompare(b.sport)
  );

  const totalEvents = sports.reduce((s, r) => s + r.events, 0);
  const totalLinked = sports.reduce((s, r) => s + r.linked, 0);
  const totalLeagues = sports.reduce((s, r) => s + r.leagues, 0);
  const totalMapped = sports.reduce((s, r) => s + r.mapped, 0);
  const linkedPct = totalEvents
    ? Math.round((totalLinked / totalEvents) * 100)
    : 0;

  // Market-type × sport from widget snapshot marketFlags
  let marketMatrix: {
    marketIds: string[];
    sports: string[];
    cells: Record<string, Record<string, MarketCell>>;
    labels: Record<string, string>;
  } = { marketIds: [], sports: [], cells: {}, labels: {} };

  const snapFile = Bun.file(snapPath);
  if (await snapFile.exists()) {
    const snap = (await snapFile.json()) as WidgetDomainSnapshot;
    const sportKeys = new Set<string>();
    const mIds = new Set<string>();
    const cells: Record<string, Record<string, MarketCell>> = {};

    for (const s of snap.liveSports ?? []) {
      const canon =
        s.sportIdCanonical ??
        sportIdFromFeedSportId(s.id) ??
        s.name.toLowerCase().replace(/\s+/g, '_');
      if (!canon || canon === 'sports_channels') continue;
      // Prefer columns we already show from inventory when possible
      const col =
        sports.find(x => x.sport === canon)?.sport ??
        (sports.some(x => x.sport === s.name.toLowerCase().replace(/\s+/g, '_'))
          ? s.name.toLowerCase().replace(/\s+/g, '_')
          : null);
      // Only include sports that appear in inventory columns OR primary board sports
      const key =
        col ??
        (['table_tennis', 'tennis', 'soccer', 'basketball', 'baseball', 'ice_hockey'].includes(
          String(canon)
        )
          ? String(canon)
          : null);
      if (!key) continue;
      sportKeys.add(key);
      const flags = s.marketFlags ?? {};
      for (const [mid, val] of Object.entries(flags)) {
        mIds.add(mid);
        cells[mid] ??= {};
        const role = flagRole(val);
        if (!role) continue;
        // Prefer primary over secondary if multiple feed shells map to same sport
        const prev = cells[mid]![key];
        if (!prev || prev === '—') cells[mid]![key] = role;
        else if (role === 'primary') cells[mid]![key] = 'primary';
        else if (role === 'secondary' && prev === 'yes') cells[mid]![key] = 'secondary';
      }
    }

    // Align market-matrix sport columns with inventory sports order, then extras
    const mSports = [
      ...sports.map(s => s.sport).filter(s => sportKeys.has(s)),
      ...[...sportKeys].filter(s => !sports.some(x => x.sport === s)).sort(),
    ];
    const marketIds = [...mIds].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
    const labels: Record<string, string> = {};
    for (const id of marketIds) {
      labels[id] =
        KNOWN_MARKET_LABELS[id as keyof typeof KNOWN_MARKET_LABELS] ??
        `market:${id}`;
    }
    // Fill blanks
    for (const mid of marketIds) {
      cells[mid] ??= {};
      for (const sp of mSports) {
        if (cells[mid]![sp] == null) {
          cells[mid]![sp] = '—';
        }
      }
    }
    marketMatrix = { marketIds, sports: mSports, cells, labels };
  }

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
    },
    competitions: listCompetitions().length,
    /** Column-oriented sports (order = display columns). */
    sports: sports.map(s => s.sport),
    bySportCols: Object.fromEntries(
      sports.map(s => [
        s.sport,
        {
          events: s.events,
          linked: s.linked,
          fillPct: s.events ? Math.round((s.linked / s.events) * 100) : 0,
          leagues: s.leagues,
          mapped: s.mapped,
          mapPct: s.leagues ? Math.round((s.mapped / s.leagues) * 100) : 0,
        },
      ])
    ),
    marketMatrix,
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
  <title>Inventory coverage board · plive shell + ezlive</title>
  <style>
    :root {
      --bg: #0c0f14;
      --panel: #141a22;
      --panel2: #1a222d;
      --border: #2a3544;
      --text: #e8eef6;
      --muted: #8b9bb0;
      --accent: #5b9fd4;
      --ok: #3dba7a;
      --warn: #e0a44c;
      --bad: #e05a5a;
      --plive: #6c9ef8;
      --ezlive: #c084fc;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --sans: "IBM Plex Sans", system-ui, -apple-system, Segoe UI, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--sans);
      background: radial-gradient(1200px 600px at 10% -10%, #1a2740 0%, transparent 50%),
                  radial-gradient(900px 500px at 100% 0%, #2a1a40 0%, transparent 45%),
                  var(--bg);
      color: var(--text);
      line-height: 1.45;
      min-height: 100vh;
    }
    header {
      padding: 1.75rem 1.5rem 1rem;
      border-bottom: 1px solid var(--border);
      background: rgba(12, 15, 20, 0.7);
      backdrop-filter: blur(8px);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    header h1 { margin: 0 0 0.35rem; font-size: 1.35rem; font-weight: 650; letter-spacing: -0.02em; }
    header p { margin: 0; color: var(--muted); font-size: 0.92rem; max-width: 70rem; }
    .meta {
      margin-top: 0.65rem;
      display: flex; flex-wrap: wrap; gap: 0.5rem 1rem;
      font-family: var(--mono); font-size: 0.78rem; color: var(--muted);
    }
    main { padding: 1.25rem 1.5rem 3rem; max-width: 1400px; margin: 0 auto; display: grid; gap: 1rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.75rem; }
    .card {
      background: linear-gradient(180deg, var(--panel2), var(--panel));
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem 1.05rem;
      overflow-x: auto;
    }
    .card h2 {
      margin: 0 0 0.75rem;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      font-weight: 600;
    }
    .stat { font-size: 1.75rem; font-weight: 650; letter-spacing: -0.03em; }
    .stat small { display: block; font-size: 0.72rem; color: var(--muted); font-weight: 500; margin-top: 0.2rem; letter-spacing: 0; }
    .stat.ok { color: var(--ok); } .stat.warn { color: var(--warn); } .stat.bad { color: var(--bad); } .stat.accent { color: var(--accent); }
    .badge {
      display: inline-block; padding: 0.12rem 0.45rem; border-radius: 999px;
      font-family: var(--mono); font-size: 0.72rem; border: 1px solid var(--border);
    }
    .badge.plive { color: var(--plive); border-color: #3a5a90; }
    .badge.ezlive { color: var(--ezlive); border-color: #6b4a90; }
    table.matrix {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
      min-width: 640px;
    }
    table.matrix th, table.matrix td {
      border: 1px solid var(--border);
      padding: 0.45rem 0.5rem;
      text-align: center;
      white-space: nowrap;
    }
    table.matrix th {
      background: rgba(0,0,0,0.25);
      font-weight: 600;
      font-size: 0.72rem;
    }
    table.matrix th.row-h, table.matrix td.row-h {
      text-align: left;
      font-weight: 600;
      color: var(--muted);
      position: sticky;
      left: 0;
      background: var(--panel);
      z-index: 1;
    }
    table.matrix th.sport {
      writing-mode: horizontal-tb;
      max-width: 7rem;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--accent);
      font-family: var(--mono);
      font-size: 0.7rem;
    }
    table.matrix td.num { font-family: var(--mono); font-variant-numeric: tabular-nums; }
    .cell-primary { color: var(--ok); font-weight: 650; }
    .cell-secondary { color: var(--warn); }
    .cell-yes { color: var(--text); }
    .cell-empty { color: #3a4555; }
    .callout {
      border-radius: 10px;
      padding: 0.85rem 1rem;
      border: 1px solid var(--border);
      background: rgba(224, 164, 76, 0.08);
      font-size: 0.9rem;
      color: var(--muted);
    }
    .callout strong { color: var(--warn); }
    .bar {
      height: 6px; background: #243040; border-radius: 3px; overflow: hidden;
    }
    .bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), var(--ok)); }
    pre {
      margin: 0; padding: 0.85rem 1rem; background: #0a0d12; border-radius: 8px;
      font-family: var(--mono); font-size: 0.78rem; overflow-x: auto; color: var(--muted);
    }
    footer { margin-top: 0.75rem; font-size: 0.78rem; color: var(--muted); }
    .legend { display: flex; flex-wrap: wrap; gap: 0.75rem; font-size: 0.78rem; color: var(--muted); margin-bottom: 0.65rem; }
    .legend span { display: inline-flex; align-items: center; gap: 0.3rem; }
  </style>
</head>
<body>
  <header>
    <h1>Inventory coverage board</h1>
    <p>
      Live snapshot of the <strong>plive SportsWidgets shell</strong> (also covers
      <strong>ezlive</strong> on Buckeye). <strong>Each sport is a column.</strong>
      Market-type grid uses Pandora <code>live.sports</code> flags.
    </p>
    <div class="meta">
      <span id="gen">generated —</span>
      <span>skin=<strong style="color:var(--text)">buckeye</strong></span>
      <span>book=<strong style="color:var(--text)">fantasy402</strong></span>
      <span class="badge plive">plive shell stamp</span>
      <span class="badge ezlive">ezlive covered (shared)</span>
    </div>
  </header>

  <main>
    <section class="grid" id="kpis"></section>

    <div class="callout">
      <strong>Odds link is the main gap.</strong>
      Only <span id="linkPct">—</span>% of board events have <code>odds_event_id</code>.
      Stream-list has <em>no prices</em>; enrich only stamps a Statscore client id when names match.
    </div>

    <section class="card">
      <h2>Coverage by sport · columns</h2>
      <div class="legend">
        <span>Metrics as rows · sports as columns</span>
      </div>
      <table class="matrix" id="sportMatrix"></table>
    </section>

    <section class="card">
      <h2>Market type × sport</h2>
      <div class="legend">
        <span class="cell-primary">● primary</span>
        <span class="cell-secondary">● secondary</span>
        <span class="cell-yes">● offered</span>
        <span class="cell-empty">— not flagged on live.sports</span>
      </div>
      <p style="margin:0 0 0.65rem;color:var(--muted);font-size:0.82rem">
        Wire market type ids (Pandora coefficient / ticket share these). From widget snapshot
        <code>live.sports[id].m</code> — not priced line counts.
      </p>
      <table class="matrix" id="marketMatrix"></table>
    </section>

    <section class="card">
      <h2>Unmapped leagues (promote junk or feed noise)</h2>
      <table class="matrix" style="min-width:0">
        <thead><tr><th class="row-h">Sport</th><th class="row-h">League</th><th>Peak</th><th>Live</th></tr></thead>
        <tbody id="unmapped"></tbody>
      </table>
    </section>

    <section class="card">
      <h2>Sample linked events (odds_event_id set)</h2>
      <table class="matrix" style="min-width:0">
        <thead><tr><th class="row-h">Sport</th><th class="row-h">Matchup</th><th>odds_event_id</th><th>inv</th></tr></thead>
        <tbody id="linked"></tbody>
      </table>
    </section>

    <section class="card">
      <h2>Operator commands</h2>
      <pre>bun tools/bake-inventory-coverage-board.ts
bun run inventory:sync -- --sport=all --dry-run
bun run inventory:leagues -- --report
bun run inventory:enrich
bun run domain:sports -- --feed
bun run domain:sports -- --periods</pre>
      <footer>
        SSOT: <code>docs/INVENTORY.md</code> · board: <code>${out}</code>
      </footer>
    </section>
  </main>

  <script>
    const DATA = ${JSON.stringify(data, null, 2)};

    const o = DATA.odds;
    const L = DATA.leagues;
    const mapPct = L.total ? Math.round(((L.total - L.unmapped) / L.total) * 100) : 0;

    document.getElementById("gen").textContent = "generated " + DATA.generatedAt;
    document.getElementById("linkPct").textContent = String(o.linkedPct);

    document.getElementById("kpis").innerHTML = \`
      <div class="card"><h2>Board events</h2><div class="stat accent">\${o.total}<small>skin_events rows</small></div></div>
      <div class="card"><h2>Odds linked</h2><div class="stat \${o.linkedPct < 10 ? "bad" : o.linkedPct < 50 ? "warn" : "ok"}">\${o.linked}<small>\${o.linkedPct}% · \${o.unlinked} unlinked</small></div>
        <div class="bar" style="margin-top:0.6rem"><i style="width:\${o.linkedPct}%"></i></div></div>
      <div class="card"><h2>Durable leagues</h2><div class="stat">\${L.total}<small>\${L.unmapped} unmapped</small></div></div>
      <div class="card"><h2>League → COMPETITIONS</h2><div class="stat \${mapPct > 70 ? "ok" : "warn"}">\${mapPct}%<small>\${L.total - L.unmapped} of \${L.total} mapped</small></div>
        <div class="bar" style="margin-top:0.6rem"><i style="width:\${mapPct}%"></i></div></div>
      <div class="card"><h2>COMPETITIONS seeds</h2><div class="stat accent">\${DATA.competitions}<small>hand-seeded + promote</small></div></div>
      <div class="card"><h2>Live products</h2><div class="stat" style="font-size:1.05rem;padding-top:0.35rem">
        \${DATA.coversLiveProducts.map(p => \`<span class="badge \${p}">\${p}</span>\`).join(" ")}
      </div></div>
    \`;

    // Sport columns matrix
    const sports = DATA.sports || [];
    const cols = DATA.bySportCols || {};
    const metrics = [
      { key: "events", label: "Events" },
      { key: "linked", label: "Odds linked" },
      { key: "fillPct", label: "Link fill %" },
      { key: "leagues", label: "Leagues" },
      { key: "mapped", label: "Mapped" },
      { key: "mapPct", label: "Map %" },
    ];
    let sportHtml = "<thead><tr><th class=\\"row-h\\">Metric</th>" +
      sports.map(s => \`<th class="sport" title="\${s}">\${s}</th>\`).join("") +
      "</tr></thead><tbody>";
    for (const m of metrics) {
      sportHtml += \`<tr><td class="row-h">\${m.label}</td>\`;
      for (const s of sports) {
        const v = (cols[s] && cols[s][m.key]) != null ? cols[s][m.key] : "—";
        sportHtml += \`<td class="num">\${v}</td>\`;
      }
      sportHtml += "</tr>";
    }
    sportHtml += "</tbody>";
    document.getElementById("sportMatrix").innerHTML = sportHtml;

    // Market type × sport
    const mm = DATA.marketMatrix || { marketIds: [], sports: [], cells: {}, labels: {} };
    let mktHtml = "<thead><tr><th class=\\"row-h\\">Market type</th>" +
      (mm.sports || []).map(s => \`<th class="sport" title="\${s}">\${s}</th>\`).join("") +
      "</tr></thead><tbody>";
    for (const mid of mm.marketIds || []) {
      const lab = (mm.labels && mm.labels[mid]) || ("market:" + mid);
      mktHtml += \`<tr><td class="row-h"><span style="color:var(--accent);font-family:var(--mono)">\${mid}</span> · \${lab}</td>\`;
      for (const s of mm.sports || []) {
        const cell = (mm.cells[mid] && mm.cells[mid][s]) || "—";
        let cls = "cell-empty";
        let text = cell;
        if (cell === "primary") { cls = "cell-primary"; text = "primary"; }
        else if (cell === "secondary") { cls = "cell-secondary"; text = "secondary"; }
        else if (cell === "yes") { cls = "cell-yes"; text = "yes"; }
        else if (cell === "—" || cell === "") { cls = "cell-empty"; text = "—"; }
        mktHtml += \`<td class="\${cls}">\${text}</td>\`;
      }
      mktHtml += "</tr>";
    }
    if (!(mm.marketIds || []).length) {
      mktHtml += '<tr><td class="row-h" colspan="99">No market flags — run domain:widget-extract -- --write</td></tr>';
    }
    mktHtml += "</tbody>";
    document.getElementById("marketMatrix").innerHTML = mktHtml;

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
    `wrote ${out} · sports=${sports.length} events=${totalEvents} linked=${totalLinked} markets=${marketMatrix.marketIds.length}`
  );
}

await main();
