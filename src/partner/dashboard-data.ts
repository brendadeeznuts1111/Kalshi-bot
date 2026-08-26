/**
 * Build a secret-safe partner ops snapshot for static HTML / JSON boards.
 */
// @see https://bun.com/docs/runtime/sqlite
import type { Database } from "bun:sqlite";
import { buildOpsStatusReport } from "./architecture.ts";
import {
  computeProviderCapacity,
  ensurePartnerRegistrySchema,
  listActiveBettingAccounts,
} from "./registry.ts";
import {
  checkPartnersEnvPresence,
  diffPartnersTomlVsDb,
  loadPartnersTomlFile,
  loadRegistrySnapshot,
} from "./toml-config.ts";
import { listLedgerFreshness } from "./ledger.ts";
import {
  evaluateRiskHealth,
  parseRiskThreshold,
  riskOkUnderThreshold,
  toRiskHealthJsonSnapshot,
  type RiskThreshold,
} from "./risk-health.ts";
import { getPartnerVisual } from "./visuals.ts";
import { parseOutMeta } from "./out-capacity.ts";
import { sumTicketTotalsForDay } from "./ledger.ts";
// Design tokens: the desk board uses TOKENS values so the baked HTML is
// token-compliant (design:check audits it as an ENFORCED surface). Only the
// per-partner identity hexes (getPartnerVisual) remain data-driven — those
// are allowlisted by the gate via state.json.
import { TOKENS } from "../institutions/design-tokens.ts";

export type PartnerDashboardSnapshot = {
  generatedAt: string;
  ok: boolean;
  registry: {
    partners: number;
    outs: number;
    activeOuts: number;
  };
  capacity: Array<{
    provider: string;
    totalMaxStake: number;
    outCount: number;
    capacityPairCount: number;
  }>;
  env: {
    ok: boolean;
    missingCount: number;
    outs: Array<{
      outId: string;
      envPrefix: string;
      missing: string[];
      present: string[];
    }>;
  };
  risk: {
    ok: boolean;
    threshold: RiskThreshold;
    errorCount: number;
    warnCount: number;
    findings: Array<{
      severity: string;
      code: string;
      outId: string;
      message: string;
    }>;
    snapshot: ReturnType<typeof toRiskHealthJsonSnapshot>;
  };
  ledger: Array<{
    outId: string;
    lastDeskSnapshotAt: string | null;
    lastOddsBookAt: string | null;
    lastTicketAt: string | null;
    oddsLinesToday: number;
    ticketsToday: number;
  }>;
  tickets?: {
    dayUtc: string;
    ticketCount: number;
    totalRisk: number;
    totalToWin: number;
  } | undefined;
  partners: Array<{
    code: string;
    hex: string;
    hsl: string;
    initials: string;
  }>;
  outs: Array<{
    id: string;
    partnerCode: string;
    provider: string;
    capacity: number;
    hex: string;
  }>;
  /** Seat-ops maturity (ops:status), not desk matrix. */
  ops: { built: number; partial: number; planned: number };
  toml?: {
    path: string;
    drift: { added: number; changed: number; removed: number } | null;
    error: string | null;
  } | undefined;
  commands: Array<{ cmd: string; purpose: string }>;
};

export const PARTNER_OPERATOR_COMMANDS: Array<{
  cmd: string;
  purpose: string;
}> = [
  {
    cmd: "bun run ops:status",
    purpose: "Seat-ops five-layer maturity map",
  },
  {
    cmd: "bun run partner:toml -- --diff",
    purpose: "TOML vs SQLite plan (no write)",
  },
  {
    cmd: "bun run partner:toml -- --check-env",
    purpose: "Secret presence per env_prefix",
  },
  {
    cmd: "bun run partner:toml -- --seed",
    purpose: "Upsert partners + outs from TOML",
  },
  {
    cmd: "bun run partner:capacity",
    purpose: "Out × live-product capacity tree",
  },
  {
    cmd: "bun run partner:health",
    purpose: "Registry + env + risk + ledger freshness",
  },
  {
    cmd: "bun run partner:health -- --json",
    purpose: "Machine snapshot (alert payload)",
  },
  {
    cmd: "bun run partner:desk-smoke",
    purpose: "Per-out secret readiness (no secret echo)",
  },
  {
    cmd: "bun run partner:desk-smoke -- --login",
    purpose: "Signed login probe when secrets present",
  },
  {
    cmd: "bun run partner:vault:provision -- --out=out-SPEN-1 --print-uris",
    purpose: "pass:// URI map for .env.protonpass",
  },
  {
    cmd: "bun run partner:test-fantasy -- --out=out-SPEN-1",
    purpose: "Live Ultra session smoke (prefix-aware)",
  },
  {
    cmd: "bun run partner:placebet-har -- --har=export.har",
    purpose: "Chrome HAR → PlaceBet URL map (no invented paths)",
  },
  {
    cmd: "bun run partner:ingest-tickets -- --json=research/tickets/sample-betGroups.json --out-id=out-SPEN-1",
    purpose: "betGroups JSON → ticket ledger",
  },
  {
    cmd: "bun run partner:finance-cron",
    purpose: "Desk report + optional Telegram",
  },
  {
    cmd: "bun run partner:ws-ingest -- --capture",
    purpose: "WebView Pandora odds → odds_book",
  },
  {
    cmd: "bun run partner:webview-ws-capture",
    purpose: "Raw CDP JSONL only",
  },
  {
    cmd: "bun run domain:sports",
    purpose: "Domain sport map + live stream-list coverage",
  },
  {
    cmd: "bun run inventory:sync -- --sport=all",
    purpose: "Inventory → skin_events",
  },
  {
    cmd: "bun run partner:profile -- --codes=SPEN,ASH --png",
    purpose: "Bun.color avatars",
  },
  {
    cmd: "bun run partner:dashboard",
    purpose: "Bake this static board",
  },
  {
    cmd: "bun run serve",
    purpose: "Serve public/ (open /partner-dashboard/)",
  },
];

export async function buildPartnerDashboardSnapshot(
  db: Database,
  options?: {
    riskThreshold?: RiskThreshold;
    tomlPath?: string | null;
  },
): Promise<PartnerDashboardSnapshot> {
  ensurePartnerRegistrySchema(db);
  const threshold =
    options?.riskThreshold ??
    parseRiskThreshold(process.env.PARTNER_FINANCE_RISK_THRESHOLD, "warn");

  const snap = loadRegistrySnapshot(db);
  const accounts = listActiveBettingAccounts(db);
  const capacity = computeProviderCapacity(accounts);
  const env = checkPartnersEnvPresence(accounts);
  const opsStatus = buildOpsStatusReport();
  const ledgerFreshness = listLedgerFreshness(db);
  const risk = evaluateRiskHealth(db, accounts);
  const riskOk = riskOkUnderThreshold(risk, threshold);
  const tickets = sumTicketTotalsForDay(db);

  let tomlPath =
    options?.tomlPath === undefined
      ? (await Bun.file("config/partners.toml").exists())
        ? "config/partners.toml"
        : (await Bun.file("config/partners.example.toml").exists())
          ? "config/partners.example.toml"
          : null
      : options.tomlPath;

  let toml:
    | PartnerDashboardSnapshot["toml"]
    | undefined;
  if (tomlPath) {
    try {
      const loaded = await loadPartnersTomlFile(tomlPath);
      const drift = diffPartnersTomlVsDb(loaded.doc, db);
      toml = {
        path: tomlPath,
        drift: {
          added: drift.added,
          changed: drift.changed,
          removed: drift.removed,
        },
        error: null,
      };
    } catch (e) {
      toml = {
        path: tomlPath,
        drift: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const partnerCodes = new Set<string>();
  const outs = accounts.map((a) => {
    const meta = parseOutMeta(a.metaJson);
    const code =
      (typeof meta.partnerCode === "string" && meta.partnerCode.toUpperCase()) ||
      a.id.replace(/^out-/, "").split("-")[0]?.toUpperCase() ||
      "UNKNOWN";
    partnerCodes.add(code);
    const cap = computeProviderCapacity([a])[0];
    const vis = getPartnerVisual(code);
    return {
      id: a.id,
      partnerCode: code,
      provider: a.provider,
      capacity: cap?.totalMaxStake ?? a.maxStake,
      hex: vis.hex,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    ok:
      env.ok &&
      riskOk &&
      !toml?.error &&
      (toml?.drift == null ||
        (toml.drift.added === 0 && toml.drift.changed === 0)),
    registry: {
      partners: snap.partners.length,
      outs: snap.accounts.length,
      activeOuts: accounts.length,
    },
    capacity: capacity.map((c) => ({
      provider: c.provider,
      totalMaxStake: c.totalMaxStake,
      outCount: c.accountCount,
      capacityPairCount: c.capacityPairCount,
    })),
    env: {
      ok: env.ok,
      missingCount: env.missingCount,
      outs: env.outs.map((o) => ({
        outId: o.outId,
        envPrefix: o.envPrefix,
        missing: o.missing,
        present: o.present,
      })),
    },
    risk: {
      ok: riskOk,
      threshold,
      errorCount: risk.errorCount,
      warnCount: risk.warnCount,
      findings: risk.findings.map((f) => ({
        severity: f.severity,
        code: f.code,
        outId: f.outId,
        message: f.message,
      })),
      snapshot: toRiskHealthJsonSnapshot(risk, threshold),
    },
    ledger: ledgerFreshness.map((f) => ({
      outId: f.outId,
      lastDeskSnapshotAt: f.lastDeskSnapshotAt
        ? new Date(f.lastDeskSnapshotAt).toISOString()
        : null,
      lastOddsBookAt: f.lastOddsBookAt
        ? new Date(f.lastOddsBookAt).toISOString()
        : null,
      lastTicketAt: f.lastTicketAt
        ? new Date(f.lastTicketAt).toISOString()
        : null,
      oddsLinesToday: f.oddsLinesToday,
      ticketsToday: f.ticketsToday,
    })),
    tickets:
      tickets.ticketCount > 0
        ? {
            dayUtc: tickets.dayUtc,
            ticketCount: tickets.ticketCount,
            totalRisk: tickets.totalRisk,
            totalToWin: tickets.totalToWin,
          }
        : undefined,
    partners: [...partnerCodes].sort().map((code) => {
      const v = getPartnerVisual(code);
      return {
        code,
        hex: v.hex,
        hsl: v.hsl,
        initials: v.initials,
      };
    }),
    outs,
    ops: {
      built: opsStatus.totals.built,
      partial: opsStatus.totals.partial,
      planned: opsStatus.totals.planned,
    },
    toml,
    commands: PARTNER_OPERATOR_COMMANDS,
  };
}

export function renderPartnerDashboardHtml(
  data: PartnerDashboardSnapshot,
): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const statusColor = data.ok ? TOKENS.color.ok : TOKENS.color.bad;
  const findings = data.risk.findings
    .map(
      (f) =>
        `<tr class="sev-${esc(f.severity)}"><td>${esc(f.severity)}</td><td><code>${esc(f.code)}</code></td><td>${esc(f.outId)}</td><td>${esc(f.message)}</td></tr>`,
    )
    .join("\n");

  const outRows = data.outs
    .map(
      (o) =>
        `<tr><td><span class="dot" style="background:${esc(o.hex)}"></span> ${esc(o.id)}</td><td>${esc(o.partnerCode)}</td><td>${esc(o.provider)}</td><td>$${o.capacity}</td></tr>`,
    )
    .join("\n");

  const ledgerRows = data.ledger
    .map(
      (l) =>
        `<tr><td>${esc(l.outId)}</td><td>${esc(l.lastDeskSnapshotAt ?? "—")}</td><td>${esc(l.lastOddsBookAt ?? "—")}</td><td>${l.oddsLinesToday}</td><td>${l.ticketsToday}</td></tr>`,
    )
    .join("\n");

  const cmdRows = data.commands
    .map(
      (c) =>
        `<tr><td><code>${esc(c.cmd)}</code></td><td>${esc(c.purpose)}</td></tr>`,
    )
    .join("\n");

  const partnerChips = data.partners
    .map(
      (p) =>
        `<span class="chip" style="background:${esc(p.hex)};color:${p.hex === "#cce64d" || p.hex.startsWith("#cc") || p.hex.startsWith("#ee") ? TOKENS.color.palette.onLight : TOKENS.color.palette.onDark}">${esc(p.initials)} ${esc(p.code)}</span>`,
    )
    .join(" ");

  const capBits = data.capacity
    .map(
      (c) =>
        `<div class="kpi"><div class="k">${esc(c.provider)}</div><div class="v">$${c.totalMaxStake}</div><div class="s">${c.outCount} outs · ${c.capacityPairCount} products</div></div>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Partner desk</title>
  <style>
    :root { --bg:${TOKENS.color.bg}; --panel:${TOKENS.color.panel}; --panel2:${TOKENS.color.panel2}; --text:${TOKENS.color.fg}; --muted:${TOKENS.color.dim}; --border:${TOKENS.color.line}; --acc:${TOKENS.color.acc}; --warn:${TOKENS.color.warn}; --err:${TOKENS.color.bad}; --ok:${TOKENS.color.ok}; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background:var(--bg); color:var(--text); line-height:1.45; }
    header { padding:1.25rem 1.5rem; border-bottom:1px solid var(--border); display:flex; flex-wrap:wrap; gap:1rem; align-items:center; justify-content:space-between; }
    h1 { font-size:1.15rem; margin:0; font-weight:650; letter-spacing:.02em; }
    .badge { display:inline-flex; align-items:center; gap:.4rem; padding:.25rem .65rem; border-radius:999px; font-size:.8rem; font-weight:600; background:var(--panel2); border:1px solid var(--border); }
    .badge .dot { width:.55rem; height:.55rem; border-radius:50%; background:${statusColor}; box-shadow:0 0 8px ${statusColor}; }
    main { padding:1.25rem 1.5rem 3rem; max-width:1100px; margin:0 auto; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:.75rem; margin:1rem 0 1.5rem; }
    .kpi { background:var(--panel); border:1px solid var(--border); border-radius:${TOKENS.radius.lg}; padding:.9rem 1rem; }
    .kpi .k { color:var(--muted); font-size:.75rem; text-transform:uppercase; letter-spacing:.06em; }
    .kpi .v { font-size:1.35rem; font-weight:700; margin-top:.2rem; }
    .kpi .s { color:var(--muted); font-size:.8rem; margin-top:.15rem; }
    section { margin:1.75rem 0; }
    h2 { font-size:.95rem; margin:0 0 .75rem; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; font-weight:600; }
    table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--border); border-radius:${TOKENS.radius.lg}; overflow:hidden; font-size:.88rem; }
    th, td { text-align:left; padding:.55rem .75rem; border-bottom:1px solid var(--border); vertical-align:top; }
    th { color:var(--muted); font-weight:600; font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; background:var(--bg); }
    tr:last-child td { border-bottom:none; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:.8rem; color:var(--acc); }
    .sev-error td:first-child { color:var(--err); font-weight:700; }
    .sev-warn td:first-child { color:var(--warn); font-weight:700; }
    .sev-info td:first-child { color:var(--muted); }
    .chip { display:inline-block; padding:.2rem .55rem; border-radius:8px; font-size:.75rem; font-weight:700; margin:.15rem; }
    .dot { display:inline-block; width:.55rem; height:.55rem; border-radius:50%; margin-right:.35rem; vertical-align:middle; }
    footer { color:var(--muted); font-size:.75rem; margin-top:2rem; }
    a { color:#7dd3fc; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Partner desk</h1>
      <div style="color:var(--muted);font-size:.8rem;margin-top:.25rem">${esc(data.generatedAt)}</div>
    </div>
    <div class="badge"><span class="dot"></span>${data.ok ? "OK" : "DEGRADED"}</div>
  </header>
  <main>
    <div class="grid">
      <div class="kpi"><div class="k">Partners</div><div class="v">${data.registry.partners}</div></div>
      <div class="kpi"><div class="k">Active outs</div><div class="v">${data.registry.activeOuts}</div></div>
      <div class="kpi"><div class="k">Risk errors</div><div class="v" style="color:${data.risk.errorCount ? "var(--err)" : "var(--ok)"}">${data.risk.errorCount}</div><div class="s">warns ${data.risk.warnCount} · thr ${esc(data.risk.threshold)}</div></div>
      <div class="kpi"><div class="k">Env gaps</div><div class="v" style="color:${data.env.missingCount ? "var(--warn)" : "var(--ok)"}">${data.env.missingCount}</div></div>
      <div class="kpi"><div class="k">Seat ops</div><div class="v">${data.ops.built}</div><div class="s">built · ${data.ops.partial} partial · ${data.ops.planned} planned</div></div>
      ${data.tickets ? `<div class="kpi"><div class="k">Tickets ${esc(data.tickets.dayUtc)}</div><div class="v">${data.tickets.ticketCount}</div><div class="s">risk $${data.tickets.totalRisk} · toWin $${data.tickets.totalToWin}</div></div>` : ""}
      ${capBits}
    </div>

    <section>
      <h2>Partners</h2>
      <div>${partnerChips || "<span style='color:var(--muted)'>No partner codes on outs</span>"}</div>
    </section>

    <section>
      <h2>Risk findings</h2>
      <table>
        <thead><tr><th>Sev</th><th>Code</th><th>Out</th><th>Message</th></tr></thead>
        <tbody>
          ${findings || `<tr><td colspan="4" style="color:var(--muted)">No findings</td></tr>`}
        </tbody>
      </table>
    </section>

    <section>
      <h2>Outs / capacity</h2>
      <table>
        <thead><tr><th>Out</th><th>Partner</th><th>Provider</th><th>Capacity</th></tr></thead>
        <tbody>${outRows || `<tr><td colspan="4" style="color:var(--muted)">No active outs — seed TOML</td></tr>`}</tbody>
      </table>
    </section>

    <section>
      <h2>Ledger freshness</h2>
      <table>
        <thead><tr><th>Out</th><th>Desk</th><th>Odds</th><th>Lines today</th><th>Tickets today</th></tr></thead>
        <tbody>${ledgerRows || `<tr><td colspan="5" style="color:var(--muted)">Empty — run finance-cron / ws-ingest</td></tr>`}</tbody>
      </table>
    </section>

    <section>
      <h2>Operator catalog</h2>
      <table>
        <thead><tr><th>Command</th><th>Purpose</th></tr></thead>
        <tbody>${cmdRows}</tbody>
      </table>
    </section>

    <footer>
      Bun-native static board · no Vite · data from SQLite registry + partner_ledger ·
      regenerate with <code>bun run partner:dashboard</code>
      ${data.toml ? ` · toml ${esc(data.toml.path)} +${data.toml.drift?.added ?? 0} ~${data.toml.drift?.changed ?? 0} -${data.toml.drift?.removed ?? 0}` : ""}
    </footer>
  </main>
  <script type="application/json" id="partner-dashboard-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
</body>
</html>
`;
}
