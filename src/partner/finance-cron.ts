/**
 * Partner finance / desk cron — registry-driven ops summary.
 *
 * Pipeline:
 *   SQLite registry (partners + outs + skins meta)
 *   → resolvePartnerEnv(env_prefix)
 *   → computeProviderCapacity / outCapacityFromAccount
 *   → optional public stream-list inventory + optional login probe
 *   → optional Telegram notify
 *
 * Writes `desk_snapshot` (+ optional odds_book via webview). Ticket P&L lines
 * come from `partner:ingest-tickets` (betGroups wire) until placeOrder POST is mapped.
 *
 * Env knobs:
 *   PARTNER_FINANCE_CRON=1              enable in cron-main
 *   PARTNER_FINANCE_CRON_SCHEDULE       default "0 9 * * *" (09:00 UTC)
 *   PARTNER_FINANCE_NOTIFY=1            send desk Telegram summary
 *   PARTNER_FINANCE_RISK_ALERT=1        send risk-health Telegram (default on if NOTIFY=1)
 *   PARTNER_FINANCE_RISK_DIGEST=1       always send risk summary even when clean
 *   PARTNER_FINANCE_RISK_FORCE=1        skip fingerprint dedupe
 *   PARTNER_FINANCE_PARTNER=SPEN        filter by partner code
 *   PARTNER_FINANCE_PROBE_LOGIN=1       attempt Fantasy login when secrets present
 *   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID | TELEGRAM_GROUP_ID
 *   TELEGRAM_TOPIC_ID_{CODE}            optional message_thread_id
 */
// @see https://bun.com/docs/runtime/cron
// @see https://bun.com/docs/api/fetch
import type { Database } from 'bun:sqlite';
import { resolveDeskDomainFromEnv } from '../domain/index.ts';
import { FantasyUltraAdapter } from './fantasy-ultra/adapter.ts';
import type { FantasyUltraCredentials } from './fantasy-ultra/types.ts';
import {
  ensurePartnerRegistrySchema,
  listActiveBettingAccounts,
  type BettingAccountRow,
} from './registry.ts';
import { outCapacityFromAccount, parseOutMeta } from './out-capacity.ts';
import { fetchStreamSportsInventory } from './sports-inventory.ts';
import { DEFAULT_REQUIRED_ENV_KEYS, resolvePartnerEnv, type PartnerEnvKey } from './toml-config.ts';
import {
  lastRiskHealthFingerprint,
  sumTicketTotalsForDay,
  writeDeskSnapshot,
  writeRiskHealthSnapshot,
  type TicketDayTotals,
} from './ledger.ts';
import {
  evaluateRiskHealth,
  formatRiskHealthTelegram,
  formatRiskHealthText,
  parseRiskThreshold,
  riskHealthFingerprint,
  riskOkUnderThreshold,
  type RiskHealthReport,
  type RiskThreshold,
} from './risk-health.ts';
import { getPartnerVisual } from './visuals.ts';
import { parseLiveProductWire } from './out-capacity.ts';
import { runWebViewWsPipeline } from './webview-ws-pipeline.ts';

export type FinanceCronOptions = {
  /** Fail hard when any out is missing required secrets */
  strictEnv?: boolean;
  /** Only this partner code (e.g. SPEN) */
  partnerFilter?: string;
  /** Attempt login() when secrets present */
  probeLogin?: boolean;
  /** Fetch public stream-list inventory once for the report */
  probeInventory?: boolean;
  /** Send desk Telegram summary when configured */
  notify?: boolean;
  /**
   * Send risk-health Telegram (errors/warns).
   * Default: same as notify, or PARTNER_FINANCE_RISK_ALERT=1/0.
   */
  riskAlert?: boolean;
  /** Always send risk summary even when clean (PARTNER_FINANCE_RISK_DIGEST=1) */
  riskDigest?: boolean;
  /** Skip fingerprint dedupe (PARTNER_FINANCE_RISK_FORCE=1) */
  riskForce?: boolean;
  /**
   * Minimum severity for risk alerts / fingerprints.
   * error | warn (default) | info | off
   * Env: PARTNER_FINANCE_RISK_THRESHOLD
   */
  riskThreshold?: RiskThreshold;
  /** Embed partner:health-style JSON in Telegram risk message (default true) */
  riskIncludeHealthJson?: boolean;
  /**
   * Opt-in auto-heal: if capacity_without_odds persists ≥24h, run WebView capture+ingest once.
   * Env: PARTNER_FINANCE_AUTO_WS_INGEST=1  (default off)
   */
  autoWsIngest?: boolean;
  /** Hours capacity_without_odds must persist before auto-ingest (default 24) */
  autoWsIngestAfterHours?: number;
  /** Persist desk_snapshot rows to partner_ledger (default true) */
  writeLedger?: boolean;
  /**
   * Ingest latest Bun.WebView WS capture (or live capture) into coefficient store
   * and write odds_book ledger row. Env: PARTNER_FINANCE_WEBVIEW=1
   */
  webviewOdds?: boolean;
  /** Force live WebView capture when webviewOdds (default: use latest JSONL) */
  webviewCapture?: boolean;
  webviewSeconds?: number;
  envMap?: Record<string, string | undefined>;
  requiredKeys?: readonly PartnerEnvKey[];
};

export type FinanceCronOutRow = {
  outId: string;
  partnerId: string;
  partnerCode: string;
  provider: string;
  totalPerBetMax: number;
  skinCount: number;
  skins: Array<{ name: string; perBetMax: number }>;
  workingBalance: number | null;
  envPrefix: string;
  envOk: boolean;
  missingKeys: PartnerEnvKey[];
  loginOk?: boolean;
  loginError?: string;
};

export type FinanceCronPartnerGroup = {
  partnerCode: string;
  partnerId: string;
  totalCapacity: number;
  outs: FinanceCronOutRow[];
  hex: string;
};

export type FinanceCronReport = {
  generatedAt: string;
  outCount: number;
  partnerCount: number;
  skippedMissingSecrets: number;
  totalCapacity: number;
  /** Today's ticket ledger totals (risk / toWin) when any tickets ingested. */
  tickets?: TicketDayTotals;
  inventory?: {
    sportBuckets: number;
    totalEvents: number;
    primaryLive: number;
  };
  partners: FinanceCronPartnerGroup[];
  notified: boolean;
  /** Risk-health Telegram sent this run */
  riskNotified: boolean;
  /** Risk alert suppressed by fingerprint dedupe */
  riskAlertDeduped: boolean;
  riskThreshold?: RiskThreshold;
  risk?: RiskHealthReport;
  riskFingerprint?: string;
  /** Auto ws-ingest ran this cycle */
  autoWsIngestRan?: boolean;
  autoWsIngestResult?: {
    pricedLines: number;
    pricedEvents: number;
    capturePath: string | null;
  };
  strictEnvFailed: boolean;
  /** desk_snapshot rows written this run */
  ledgerWrites: number;
  /** WebView/Pandora odds ingest (optional) */
  webview?: {
    capturePath: string | null;
    pricedEvents: number;
    pricedLines: number;
    ledgerId: string | null;
  };
};

function partnerCodeForOut(a: BettingAccountRow): string {
  const meta = parseOutMeta(a.metaJson);
  if (typeof meta.partnerCode === 'string' && meta.partnerCode.trim()) {
    return meta.partnerCode.trim().toUpperCase();
  }
  const m = /^out-([A-Z0-9]+)-/i.exec(a.id);
  if (m) return m[1]!.toUpperCase();
  return a.partnerId.replace(/^partner-/i, '').toUpperCase() || 'UNKNOWN';
}

function credentialsFromEnv(
  bundle: ReturnType<typeof resolvePartnerEnv>
): FantasyUltraCredentials | null {
  const c = bundle.values.CUSTOMER_ID;
  const a = bundle.values.AGENT_ID;
  const p = bundle.values.PASSWORD;
  const t = bundle.values.BEARER_TOKEN;
  if (!c || !a || !p || !t) return null;
  return {
    customerID: c,
    agentID: a,
    password: p,
    bearerToken: t,
    domain: bundle.values.DOMAIN || resolveDeskDomainFromEnv(),
    skin: parseLiveProductWire(bundle.values.SKIN, 2),
    currency: bundle.values.CURRENCY || 'USD',
  };
}

async function probeLogin(
  creds: FantasyUltraCredentials
): Promise<{ ok: boolean; error?: string }> {
  try {
    const adapter = new FantasyUltraAdapter({
      credentials: creds,
      warmSession: false,
    });
    await adapter.login();
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
    };
  }
}

/** Soft Telegram send — never throws; no import of telegram/api (hard token require). */
export async function notifyTelegramFinance(
  text: string,
  options?: { partnerCode?: string }
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim() || process.env.TELEGRAM_GROUP_ID?.trim();
  if (!token || !chatId || !text.trim()) return false;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: text.slice(0, 3500),
    disable_web_page_preview: true,
  };
  if (options?.partnerCode) {
    const topic =
      process.env[`TELEGRAM_TOPIC_ID_${options.partnerCode}`]?.trim() ||
      process.env.TELEGRAM_TOPIC_ID?.trim();
    if (topic && /^\d+$/.test(topic)) {
      body.message_thread_id = Number(topic);
    }
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

export function formatFinanceCronReportText(report: FinanceCronReport): string {
  const lines: string[] = [];
  lines.push(
    `partner desk  partners=${report.partnerCount} outs=${report.outCount} capacity=$${report.totalCapacity}`
  );
  if (report.inventory) {
    lines.push(
      `  inventory: ${report.inventory.totalEvents} live events · ${report.inventory.sportBuckets} sports · primary live ${report.inventory.primaryLive}`
    );
  }
  if (report.webview) {
    lines.push(
      `  webview odds: events=${report.webview.pricedEvents} lines=${report.webview.pricedLines}` +
        (report.webview.capturePath ? `  capture=${report.webview.capturePath}` : '')
    );
  }
  if (report.risk) {
    lines.push(
      `  risk: errors=${report.risk.errorCount} warns=${report.risk.warnCount}` +
        (report.riskNotified ? '  telegram✓' : report.riskAlertDeduped ? '  deduped' : '')
    );
  }
  if (report.tickets && report.tickets.ticketCount > 0) {
    const t = report.tickets;
    lines.push(
      `  tickets today (${t.dayUtc}): n=${t.ticketCount}  risk=$${t.totalRisk}  toWin=$${t.totalToWin}` +
        `  open=${t.openCount} ($${t.openRisk})  settled=${t.settledCount}` +
        `  (net P&L needs settlement list URL)`
    );
    for (const row of t.byOut) {
      lines.push(
        `    └── ${row.outId}  n=${row.ticketCount}  risk=$${row.totalRisk}  toWin=$${row.totalToWin}` +
          `  open=${row.openCount}/$${row.openRisk}`
      );
    }
  }
  if (report.skippedMissingSecrets > 0) {
    lines.push(`  ⚠ ${report.skippedMissingSecrets} out(s) missing secrets (env)`);
  }
  for (const g of report.partners) {
    const v = getPartnerVisual(g.partnerCode);
    lines.push(`  ${g.partnerCode}  ${v.hex}  capacity=$${g.totalCapacity}  outs=${g.outs.length}`);
    for (const o of g.outs) {
      const skinBits = o.skins.map(s => `$${s.perBetMax} ${s.name}`).join(' + ');
      const envMark = o.envOk ? 'env✓' : `env✗ ${o.missingKeys.join(',')}`;
      const login = o.loginOk === true ? ' login✓' : o.loginOk === false ? ` login✗` : '';
      lines.push(
        `    └── ${o.outId}  $${o.totalPerBetMax}${skinBits ? ` (${skinBits})` : ''}  ${envMark}${login}`
      );
    }
  }
  return lines.join('\n');
}

/**
 * Run one desk/finance cycle against the SQLite partner registry.
 */
export async function runFinanceCron(
  db: Database,
  options: FinanceCronOptions = {}
): Promise<FinanceCronReport> {
  ensurePartnerRegistrySchema(db);
  const envMap = options.envMap ?? process.env;
  const required = options.requiredKeys ?? DEFAULT_REQUIRED_ENV_KEYS;
  const filter = options.partnerFilter?.trim().toUpperCase();
  const probeLoginEnabled = options.probeLogin ?? envMap.PARTNER_FINANCE_PROBE_LOGIN === '1';
  const probeInventory = options.probeInventory ?? envMap.PARTNER_FINANCE_PROBE_INVENTORY !== '0';
  const notify =
    options.notify ??
    (envMap.PARTNER_FINANCE_NOTIFY === '1' || envMap.PARTNER_TELEGRAM_NOTIFY === 'true');
  const riskAlert =
    options.riskAlert ??
    (envMap.PARTNER_FINANCE_RISK_ALERT === '0'
      ? false
      : envMap.PARTNER_FINANCE_RISK_ALERT === '1' || notify);
  const riskDigest = options.riskDigest ?? envMap.PARTNER_FINANCE_RISK_DIGEST === '1';
  const riskForce = options.riskForce ?? envMap.PARTNER_FINANCE_RISK_FORCE === '1';
  const riskThreshold = parseRiskThreshold(
    options.riskThreshold ?? envMap.PARTNER_FINANCE_RISK_THRESHOLD,
    'warn'
  );
  const riskIncludeHealthJson =
    options.riskIncludeHealthJson ?? envMap.PARTNER_FINANCE_RISK_HEALTH_JSON !== '0';
  const autoWsIngest = options.autoWsIngest ?? envMap.PARTNER_FINANCE_AUTO_WS_INGEST === '1';
  const autoWsIngestAfterHours =
    options.autoWsIngestAfterHours ??
    (Number(envMap.PARTNER_FINANCE_AUTO_WS_INGEST_HOURS ?? '24') || 24);
  const writeLedger = options.writeLedger !== false;
  let webviewOdds = options.webviewOdds ?? envMap.PARTNER_FINANCE_WEBVIEW === '1';

  let accounts = listActiveBettingAccounts(db);
  if (filter) {
    accounts = accounts.filter(a => partnerCodeForOut(a) === filter);
  }

  const outRows: FinanceCronOutRow[] = [];
  let skippedMissingSecrets = 0;
  let strictEnvFailed = false;

  for (const a of accounts) {
    const partnerCode = partnerCodeForOut(a);
    const cap = outCapacityFromAccount(a);
    const bundle = resolvePartnerEnv(a.envPrefix, envMap);
    const missing = required.filter(k => !bundle.values[k]);
    const envOk = missing.length === 0;
    if (!envOk) {
      skippedMissingSecrets++;
      if (options.strictEnv) strictEnvFailed = true;
    }

    const row: FinanceCronOutRow = {
      outId: a.id,
      partnerId: a.partnerId,
      partnerCode,
      provider: a.provider,
      totalPerBetMax: cap.totalPerBetMax,
      skinCount: cap.liveProducts.length,
      skins: cap.liveProducts.map(s => ({
        name: s.name,
        perBetMax: s.perBetMax,
      })),
      workingBalance: cap.workingBalance,
      envPrefix: bundle.envPrefix,
      envOk,
      missingKeys: missing,
    };

    if (envOk && probeLoginEnabled && a.provider === 'fantasy402') {
      const creds = credentialsFromEnv(bundle);
      if (creds) {
        const login = await probeLogin(creds);
        row.loginOk = login.ok;
        if (!login.ok) row.loginError = login.error;
      }
    }

    outRows.push(row);
  }

  // Group by partner
  const byPartner = new Map<string, FinanceCronOutRow[]>();
  for (const r of outRows) {
    const list = byPartner.get(r.partnerCode) ?? [];
    list.push(r);
    byPartner.set(r.partnerCode, list);
  }

  const partners: FinanceCronPartnerGroup[] = [...byPartner.entries()]
    .map(([partnerCode, outs]) => {
      const totalCapacity = outs.reduce((s, o) => s + o.totalPerBetMax, 0);
      return {
        partnerCode,
        partnerId: outs[0]?.partnerId ?? `partner-${partnerCode.toLowerCase()}`,
        totalCapacity,
        outs,
        hex: getPartnerVisual(partnerCode).hex,
      };
    })
    .sort(
      (a, b) => b.totalCapacity - a.totalCapacity || a.partnerCode.localeCompare(b.partnerCode)
    );

  let inventory: FinanceCronReport['inventory'];
  if (probeInventory) {
    try {
      const inv = await fetchStreamSportsInventory({
        // allow inject in tests via env override of URL later if needed
      });
      inventory = {
        sportBuckets: inv.sportBuckets,
        totalEvents: inv.totalEvents,
        primaryLive: inv.primaryLive,
      };
    } catch {
      /* non-fatal */
    }
  }

  let ledgerWrites = 0;
  if (writeLedger) {
    for (const r of outRows) {
      writeDeskSnapshot(db, {
        outId: r.outId,
        partnerId: r.partnerId,
        partnerCode: r.partnerCode,
        provider: r.provider,
        totalPerBetMax: r.totalPerBetMax,
        workingBalance: r.workingBalance,
        envOk: r.envOk,
        skinCount: r.skinCount,
        extra: {
          missingKeys: r.missingKeys,
          loginOk: r.loginOk,
          inventory,
        },
      });
      ledgerWrites++;
    }
  }

  const totalCapacity = partners.reduce((s, p) => s + p.totalCapacity, 0);
  let webview: FinanceCronReport['webview'];
  if (webviewOdds) {
    try {
      // Attach book to first fantasy402 out when present
      const primary = outRows.find(o => o.provider === 'fantasy402') ?? outRows[0];
      const pipe = await runWebViewWsPipeline({
        capture: options.webviewCapture === true,
        seconds: options.webviewSeconds ?? 20,
        writeLedger: writeLedger && Boolean(primary),
        db: writeLedger ? db : undefined,
        outId: primary?.outId ?? 'webview-plive',
        partnerId: primary?.partnerId ?? 'partner-default',
        partnerCode: primary?.partnerCode ?? 'PLIVE',
      });
      webview = {
        capturePath: pipe.capturePath,
        pricedEvents: pipe.pricedEvents,
        pricedLines: pipe.pricedLines,
        ledgerId: pipe.ledgerId,
      };
    } catch (e) {
      webview = {
        capturePath: null,
        pricedEvents: 0,
        pricedLines: 0,
        ledgerId: null,
      };
      console.error(`[finance-cron] webview odds: ${e instanceof Error ? e.message : e}`);
    }
  }

  const tickets = sumTicketTotalsForDay(db, {
    partnerCode: filter,
  });

  // Risk health after desk + optional odds write (fresh ledger state)
  let risk = evaluateRiskHealth(db, accounts, {
    envMap,
    requiredKeys: required,
  });

  // Opt-in auto-heal: capacity without odds for ≥ N hours → one WebView capture+ingest
  let autoWsIngestRan = false;
  let autoWsIngestResult: FinanceCronReport['autoWsIngestResult'];
  if (autoWsIngest) {
    const needIngest = risk.findings.some(f => {
      if (f.code !== 'capacity_without_odds' && f.code !== 'odds_never') {
        return false;
      }
      const row = risk.outs.find(o => o.outId === f.outId);
      if (!row || row.capacity <= 0) return false;
      // Persist: never had odds, or odds age ≥ threshold, with capacity present
      if (row.oddsAgeMs == null) {
        // no odds ever — treat as persistent if desk exists or capacity alone
        return true;
      }
      return row.oddsAgeMs >= autoWsIngestAfterHours * 3600_000;
    });
    // Only auto-run if no lines at all on any capacity out (avoid thrash)
    const anyFreshOdds = risk.outs.some(
      o =>
        o.capacity > 0 &&
        o.oddsLinesToday > 0 &&
        (o.oddsAgeMs == null || o.oddsAgeMs < autoWsIngestAfterHours * 3600_000)
    );
    if (needIngest && !anyFreshOdds) {
      try {
        const primary =
          outRows.find(o => o.provider === 'fantasy402' && o.totalPerBetMax > 0) ?? outRows[0];
        console.error(
          `[finance-cron] auto-ws-ingest: capacity_without_odds ≥${autoWsIngestAfterHours}h — capturing`
        );
        const pipe = await runWebViewWsPipeline({
          capture: true,
          seconds: options.webviewSeconds ?? 25,
          writeLedger: writeLedger && Boolean(primary),
          db: writeLedger ? db : undefined,
          outId: primary?.outId ?? 'webview-plive',
          partnerId: primary?.partnerId ?? 'partner-default',
          partnerCode: primary?.partnerCode ?? 'PLIVE',
        });
        autoWsIngestRan = true;
        autoWsIngestResult = {
          pricedLines: pipe.pricedLines,
          pricedEvents: pipe.pricedEvents,
          capturePath: pipe.capturePath,
        };
        webview = webview ?? {
          capturePath: pipe.capturePath,
          pricedEvents: pipe.pricedEvents,
          pricedLines: pipe.pricedLines,
          ledgerId: pipe.ledgerId,
        };
        // Re-evaluate after ingest
        risk = evaluateRiskHealth(db, accounts, {
          envMap,
          requiredKeys: required,
        });
      } catch (e) {
        console.error(
          `[finance-cron] auto-ws-ingest failed: ${e instanceof Error ? e.message : e}`
        );
      }
    }
  }

  const fingerprint = riskHealthFingerprint(risk, riskThreshold);
  const prevFingerprint = lastRiskHealthFingerprint(db);
  const hasIssues = !riskOkUnderThreshold(risk, riskThreshold);
  const fingerprintChanged =
    riskForce || prevFingerprint == null || prevFingerprint !== fingerprint;

  if (writeLedger) {
    writeRiskHealthSnapshot(db, {
      fingerprint,
      errorCount: risk.errorCount,
      warnCount: risk.warnCount,
      findings: risk.findings.map(f => ({
        severity: f.severity,
        code: f.code,
        outId: f.outId,
        message: f.message,
      })),
    });
  }

  const report: FinanceCronReport = {
    generatedAt: new Date().toISOString(),
    outCount: outRows.length,
    partnerCount: partners.length,
    skippedMissingSecrets,
    totalCapacity,
    tickets,
    inventory,
    partners,
    notified: false,
    riskNotified: false,
    riskAlertDeduped: false,
    riskThreshold,
    risk,
    riskFingerprint: fingerprint,
    autoWsIngestRan,
    autoWsIngestResult,
    strictEnvFailed,
    ledgerWrites,
    webview,
  };

  if (notify && !strictEnvFailed) {
    const text = formatFinanceCronReportText(report);
    let any = false;
    const hasTopics = partners.some(p => process.env[`TELEGRAM_TOPIC_ID_${p.partnerCode}`]?.trim());
    if (hasTopics) {
      for (const p of partners) {
        const chunk = formatFinanceCronReportText({
          ...report,
          partners: [p],
          partnerCount: 1,
          outCount: p.outs.length,
          totalCapacity: p.totalCapacity,
        });
        const ok = await notifyTelegramFinance(chunk, {
          partnerCode: p.partnerCode,
        });
        any = any || ok;
      }
    } else {
      any = await notifyTelegramFinance(text);
    }
    report.notified = any;
  }

  // Risk Telegram: issues at/above threshold (or digest), fingerprint dedupe
  if (riskAlert && !strictEnvFailed && riskThreshold !== 'off') {
    const shouldSend = (hasIssues || riskDigest) && (fingerprintChanged || riskForce);
    if (!shouldSend && hasIssues && !fingerprintChanged) {
      report.riskAlertDeduped = true;
      console.error(
        `[finance-cron] risk alert deduped (fp=${fingerprint} threshold=${riskThreshold})`
      );
    } else if (shouldSend) {
      const msg = formatRiskHealthTelegram(risk, {
        threshold: riskThreshold,
        includeHealthJson: riskIncludeHealthJson,
      });
      const ok = await notifyTelegramFinance(msg);
      report.riskNotified = ok;
      console.error(
        `[finance-cron] risk alert ${ok ? 'sent' : 'not sent (no telegram env)'}  threshold=${riskThreshold}  ${formatRiskHealthText(risk).split('\n')[0]}`
      );
    }
  }

  if (strictEnvFailed) {
    throw new Error(
      `finance-cron strict-env: ${skippedMissingSecrets} out(s) missing required secrets`
    );
  }

  return report;
}
