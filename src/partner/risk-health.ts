/**
 * Risk health — compare desk_snapshot capacity vs odds_book lines.
 *
 * Pure checks (no secret values, no invented EV models):
 *  - lines without capacity / env not ready
 *  - capacity without fresh odds
 *  - stale odds beyond TTL
 *  - optional juice flag when both ML sides are negative (vig present — not EV)
 */
import type { Database } from "bun:sqlite";
import type { BettingAccountRow } from "./registry.ts";
import {
  listLedgerFreshness,
  sumTicketTotalsForDay,
  type LedgerFreshness,
} from "./ledger.ts";
import { outCapacityFromAccount, parseOutMeta } from "./out-capacity.ts";
import {
  checkPartnersEnvPresence,
  type PartnerEnvKey,
} from "./toml-config.ts";

export type RiskSeverity = "info" | "warn" | "error";

/**
 * Minimum severity to treat as "actionable" for alerts / fingerprints.
 * - error: only errors
 * - warn:  errors + warnings (default)
 * - info:  all findings
 * - off:   nothing (alerts suppressed)
 */
export type RiskThreshold = "error" | "warn" | "info" | "off";

const SEVERITY_RANK: Record<RiskSeverity, number> = {
  error: 3,
  warn: 2,
  info: 1,
};

const THRESHOLD_MIN: Record<RiskThreshold, number> = {
  error: 3,
  warn: 2,
  info: 1,
  off: 99,
};

export function parseRiskThreshold(
  raw: string | undefined | null,
  fallback: RiskThreshold = "warn",
): RiskThreshold {
  const v = raw?.trim().toLowerCase();
  if (v === "error" || v === "errors") return "error";
  if (v === "warn" || v === "warning" || v === "warnings") return "warn";
  if (v === "info" || v === "all") return "info";
  if (v === "off" || v === "none" || v === "silent") return "off";
  return fallback;
}

export function severityMeetsThreshold(
  severity: RiskSeverity,
  threshold: RiskThreshold,
): boolean {
  return SEVERITY_RANK[severity] >= THRESHOLD_MIN[threshold];
}

export function filterFindingsByThreshold(
  findings: RiskFinding[],
  threshold: RiskThreshold,
): RiskFinding[] {
  if (threshold === "off") return [];
  return findings.filter((f) => severityMeetsThreshold(f.severity, threshold));
}

export type RiskFinding = {
  severity: RiskSeverity;
  code: string;
  outId: string;
  partnerCode: string;
  message: string;
  /** Structured context for JSON consumers */
  data?: Record<string, unknown>;
};

export type RiskHealthReport = {
  generatedAt: string;
  ok: boolean;
  warnCount: number;
  errorCount: number;
  infoCount: number;
  findings: RiskFinding[];
  outs: Array<{
    outId: string;
    partnerCode: string;
    capacity: number;
    workingBalance: number | null;
    envOk: boolean;
    oddsLinesToday: number;
    pricedEventsToday: number;
    deskFreshMs: number | null;
    oddsFreshMs: number | null;
    oddsAgeMs: number | null;
  }>;
};

/** Compact snapshot safe for Telegram / logs (no secrets). */
export type RiskHealthJsonSnapshot = {
  generatedAt: string;
  ok: boolean;
  errorCount: number;
  warnCount: number;
  infoCount: number;
  threshold: RiskThreshold;
  findings: Array<{
    severity: RiskSeverity;
    code: string;
    outId: string;
    partnerCode: string;
    message: string;
  }>;
  outs: RiskHealthReport["outs"];
};

export type RiskHealthOptions = {
  /** Odds older than this are "stale" (default 2h) */
  oddsStaleMs?: number;
  /** Desk snapshot older than this is "stale" (default 36h — daily cron) */
  deskStaleMs?: number;
  nowMs?: number;
  envMap?: Record<string, string | undefined>;
  requiredKeys?: readonly PartnerEnvKey[];
};

function partnerCodeOf(a: BettingAccountRow): string {
  const meta = parseOutMeta(a.metaJson);
  if (typeof meta.partnerCode === "string" && meta.partnerCode.trim()) {
    return meta.partnerCode.trim().toUpperCase();
  }
  const m = /^out-([A-Z0-9]+)-/i.exec(a.id);
  if (m) return m[1]!.toUpperCase();
  return a.partnerId.replace(/^partner-/i, "").toUpperCase() || "UNKNOWN";
}

function latestOddsMeta(
  db: Database,
  outId: string,
): { pricedEvents: number; pricedLines: number } {
  const row = db
    .query(
      `SELECT amount, secondary_amount AS events, raw_json AS raw
       FROM partner_ledger
       WHERE out_id = $o AND kind = 'odds_book'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get({ $o: outId }) as
    | { amount: number; events: number | null; raw: string }
    | null;
  if (!row) return { pricedEvents: 0, pricedLines: 0 };
  let pricedEvents = Number(row.events) || 0;
  let pricedLines = Number(row.amount) || 0;
  try {
    const j = JSON.parse(row.raw) as {
      pricedEvents?: number;
      pricedLines?: number;
    };
    if (typeof j.pricedEvents === "number") pricedEvents = j.pricedEvents;
    if (typeof j.pricedLines === "number") pricedLines = j.pricedLines;
  } catch {
    /* ignore */
  }
  return { pricedEvents, pricedLines };
}

/**
 * Cross-check active outs: live-product capacity vs odds_book freshness.
 */
export function evaluateRiskHealth(
  db: Database,
  accounts: BettingAccountRow[],
  options: RiskHealthOptions = {},
): RiskHealthReport {
  const nowMs = options.nowMs ?? Date.now();
  const oddsStaleMs = options.oddsStaleMs ?? 2 * 60 * 60 * 1000;
  const deskStaleMs = options.deskStaleMs ?? 36 * 60 * 60 * 1000;
  const env = checkPartnersEnvPresence(accounts, {
    envMap: options.envMap,
    requiredKeys: options.requiredKeys,
  });
  const envByOut = new Map(env.outs.map((o) => [o.outId, o]));
  const freshness = listLedgerFreshness(db, nowMs);
  const freshByOut = new Map(freshness.map((f) => [f.outId, f]));

  const findings: RiskFinding[] = [];
  const outSummaries: RiskHealthReport["outs"] = [];

  // Union of registry outs + ledger-only outs
  const outIds = new Set([
    ...accounts.map((a) => a.id),
    ...freshness.map((f) => f.outId),
  ]);

  for (const outId of [...outIds].sort()) {
    const account = accounts.find((a) => a.id === outId);
    const partnerCode = account
      ? partnerCodeOf(account)
      : outId.replace(/^out-/, "").split("-")[0]?.toUpperCase() ?? "UNKNOWN";
    const cap = account
      ? outCapacityFromAccount(account)
      : {
          totalPerBetMax: 0,
          workingBalance: null as number | null,
          liveProducts: [] as Array<{ name: string; perBetMax: number }>,
        };
    const capacity = cap.totalPerBetMax;
    const envRow = envByOut.get(outId);
    const envOk = envRow ? envRow.missing.length === 0 : false;
    const f: LedgerFreshness | undefined = freshByOut.get(outId);
    const oddsMeta = latestOddsMeta(db, outId);
    const oddsLines = f?.oddsLinesToday ?? oddsMeta.pricedLines;
    const pricedEvents = oddsMeta.pricedEvents;
    const deskAt = f?.lastDeskSnapshotAt ?? null;
    const oddsAt = f?.lastOddsBookAt ?? null;
    const deskFreshMs = deskAt != null ? nowMs - deskAt : null;
    const oddsAgeMs = oddsAt != null ? nowMs - oddsAt : null;

    outSummaries.push({
      outId,
      partnerCode,
      capacity,
      workingBalance: cap.workingBalance,
      envOk,
      oddsLinesToday: oddsLines,
      pricedEventsToday: pricedEvents,
      deskFreshMs,
      oddsFreshMs: oddsAt != null ? nowMs - oddsAt : null,
      oddsAgeMs,
    });

    // Capacity but no odds today
    if (capacity > 0 && oddsLines === 0 && account) {
      findings.push({
        severity: "warn",
        code: "capacity_without_odds",
        outId,
        partnerCode,
        message: `capacity $${capacity} but no odds_book lines today — run partner:ws-ingest`,
        data: { capacity },
      });
    }

    // Odds but zero capacity
    if (oddsLines > 0 && capacity <= 0) {
      findings.push({
        severity: "warn",
        code: "odds_without_capacity",
        outId,
        partnerCode,
        message: `${oddsLines} priced lines but capacity $0 — check live_products / TOML`,
        data: { oddsLines, pricedEvents },
      });
    }

    // Odds present but secrets missing (can't trade)
    if (oddsLines > 0 && !envOk && account) {
      findings.push({
        severity: "error",
        code: "odds_without_secrets",
        outId,
        partnerCode,
        message: `priced book available (${oddsLines} lines) but secrets missing — cannot execute`,
        data: {
          missing: envRow?.missing ?? [],
          oddsLines,
        },
      });
    }

    // Stale odds
    if (oddsAt != null && oddsAgeMs != null && oddsAgeMs > oddsStaleMs) {
      findings.push({
        severity: "warn",
        code: "odds_stale",
        outId,
        partnerCode,
        message: `odds_book stale (${Math.round(oddsAgeMs / 60000)}m old) — re-run partner:ws-ingest --capture`,
        data: { oddsAgeMs, oddsStaleMs },
      });
    }

    // Never had odds, has capacity
    if (capacity > 0 && oddsAt == null && account) {
      findings.push({
        severity: "info",
        code: "odds_never",
        outId,
        partnerCode,
        message: "no odds_book row yet for this out",
      });
    }

    // Stale desk snapshot
    if (deskAt != null && deskFreshMs != null && deskFreshMs > deskStaleMs) {
      findings.push({
        severity: "info",
        code: "desk_stale",
        outId,
        partnerCode,
        message: `desk_snapshot older than ${Math.round(deskStaleMs / 3600000)}h — run partner:finance-cron`,
        data: { deskFreshMs },
      });
    }

    // Capacity vs working balance (soft)
    if (
      cap.workingBalance != null &&
      capacity > 0 &&
      cap.workingBalance < capacity * 0.1
    ) {
      findings.push({
        severity: "warn",
        code: "balance_vs_capacity",
        outId,
        partnerCode,
        message: `workingBalance $${cap.workingBalance} ≪ total skin capacity $${capacity}`,
        data: {
          workingBalance: cap.workingBalance,
          capacity,
        },
      });
    }

    const ticketsToday = f?.ticketsToday ?? 0;
    // Tickets ingested but secrets missing (can't place / reconcile live)
    if (ticketsToday > 0 && !envOk && account) {
      findings.push({
        severity: "warn",
        code: "tickets_without_secrets",
        outId,
        partnerCode,
        message: `${ticketsToday} ticket(s) today but secrets missing — live place/settle blocked`,
        data: {
          ticketsToday,
          missing: envRow?.missing ?? [],
        },
      });
    }

    // Open ticket exposure (risk still at book)
    if (ticketsToday > 0 && account) {
      const day = sumTicketTotalsForDay(db, { outId, nowMs });
      if (day.openCount > 0) {
        findings.push({
          severity: "info",
          code: "open_ticket_exposure",
          outId,
          partnerCode,
          message: `${day.openCount} open ticket(s) risk=$${day.openRisk} (settled=${day.settledCount})`,
          data: {
            openCount: day.openCount,
            openRisk: day.openRisk,
            settledCount: day.settledCount,
            settledRisk: day.settledRisk,
          },
        });
      }
    }
  }

  // Global: odds on webview-plive but not attributed to a real out
  const orphanOdds = freshness.filter(
    (f) =>
      f.oddsLinesToday > 0 &&
      !accounts.some((a) => a.id === f.outId) &&
      f.outId === "webview-plive",
  );
  for (const f of orphanOdds) {
    findings.push({
      severity: "info",
      code: "odds_unattributed",
      outId: f.outId,
      partnerCode: "PLIVE",
      message:
        "odds_book on webview-plive — re-ingest with --out-id=out-SPEN-1 to attribute",
      data: { oddsLinesToday: f.oddsLinesToday },
    });
  }

  const warnCount = findings.filter((f) => f.severity === "warn").length;
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const infoCount = findings.filter((f) => f.severity === "info").length;

  return {
    generatedAt: new Date(nowMs).toISOString(),
    ok: errorCount === 0,
    warnCount,
    errorCount,
    infoCount,
    findings: findings.sort((a, b) => {
      const s = { error: 0, warn: 1, info: 2 };
      return s[a.severity] - s[b.severity] || a.outId.localeCompare(b.outId);
    }),
    outs: outSummaries,
  };
}

/** Apply threshold for alerting: recompute counts on filtered set. */
export function applyRiskThreshold(
  report: RiskHealthReport,
  threshold: RiskThreshold,
): RiskHealthReport {
  const findings = filterFindingsByThreshold(report.findings, threshold);
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warnCount = findings.filter((f) => f.severity === "warn").length;
  const infoCount = findings.filter((f) => f.severity === "info").length;
  return {
    ...report,
    findings,
    errorCount,
    warnCount,
    infoCount,
    ok: riskOkUnderThreshold(report, threshold),
  };
}

/**
 * ok under threshold:
 * - error: no errors (warns ignored)
 * - warn: no errors and no warns
 * - info: no findings at all
 * - off: always ok for alert purposes
 */
export function riskOkUnderThreshold(
  report: RiskHealthReport,
  threshold: RiskThreshold,
): boolean {
  if (threshold === "off") return true;
  const f = filterFindingsByThreshold(report.findings, threshold);
  if (threshold === "error") return !f.some((x) => x.severity === "error");
  if (threshold === "warn") {
    return !f.some((x) => x.severity === "error" || x.severity === "warn");
  }
  return f.length === 0;
}

export function toRiskHealthJsonSnapshot(
  report: RiskHealthReport,
  threshold: RiskThreshold = "warn",
): RiskHealthJsonSnapshot {
  const filtered = applyRiskThreshold(report, threshold);
  return {
    generatedAt: report.generatedAt,
    ok: riskOkUnderThreshold(report, threshold),
    errorCount: filtered.errorCount,
    warnCount: filtered.warnCount,
    infoCount: filtered.infoCount,
    threshold,
    findings: filtered.findings.map((f) => ({
      severity: f.severity,
      code: f.code,
      outId: f.outId,
      partnerCode: f.partnerCode,
      message: f.message,
    })),
    outs: report.outs,
  };
}

export function formatRiskHealthText(report: RiskHealthReport): string {
  const lines: string[] = [
    `risk health: ${report.ok ? "ok" : "ISSUES"}  errors=${report.errorCount} warns=${report.warnCount}`,
  ];
  for (const f of report.findings) {
    const mark =
      f.severity === "error" ? "✗" : f.severity === "warn" ? "!" : "·";
    lines.push(`  ${mark} [${f.code}] ${f.outId}: ${f.message}`);
  }
  if (report.findings.length === 0) {
    lines.push("  (no risk findings)");
  }
  return lines.join("\n");
}

/** Stable fingerprint of findings at/above threshold (for alert dedupe). */
export function riskHealthFingerprint(
  report: RiskHealthReport,
  threshold: RiskThreshold = "warn",
): string {
  const keys = filterFindingsByThreshold(report.findings, threshold)
    .map((f) => `${f.severity}|${f.code}|${f.outId}`)
    .sort();
  const payload = `${threshold}\n${keys.join("\n") || "clean"}`;
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(payload);
  return hash.digest("hex").slice(0, 16);
}

export type RiskTelegramOptions = {
  threshold?: RiskThreshold;
  /** partner:health-style JSON snapshot for debugging (truncated) */
  includeHealthJson?: boolean;
  /** Max chars for embedded JSON block (default 1800) */
  maxJsonChars?: number;
};

/** Compact Telegram message (plain text, ≤3500 chars). */
export function formatRiskHealthTelegram(
  report: RiskHealthReport,
  options: RiskTelegramOptions = {},
): string {
  const threshold = options.threshold ?? "warn";
  const filtered = applyRiskThreshold(report, threshold);
  const ok = riskOkUnderThreshold(report, threshold);
  const header = ok
    ? `✅ Partner risk health OK  (threshold=${threshold}, warns=${filtered.warnCount})`
    : `⚠️ Partner risk health  errors=${filtered.errorCount} warns=${filtered.warnCount}  (threshold=${threshold})`;
  const lines = [header, ""];
  if (filtered.findings.length === 0) {
    lines.push(
      threshold === "off"
        ? "Risk alerts off (threshold=off)."
        : "No findings at/above threshold. Desk capacity + odds look aligned.",
    );
  } else {
    for (const f of filtered.findings.slice(0, 20)) {
      const icon =
        f.severity === "error" ? "🔴" : f.severity === "warn" ? "🟡" : "⚪";
      lines.push(`${icon} [${f.code}] ${f.outId}`);
      lines.push(`   ${f.message}`);
    }
    if (filtered.findings.length > 20) {
      lines.push(`… +${filtered.findings.length - 20} more`);
    }
  }
  lines.push("");
  lines.push(
    "Actions: partner:ws-ingest · partner:toml --check-env · partner:finance-cron",
  );

  if (options.includeHealthJson !== false) {
    const snap = toRiskHealthJsonSnapshot(report, threshold);
    const json = JSON.stringify(snap);
    const maxJ = options.maxJsonChars ?? 1800;
    const body =
      json.length > maxJ
        ? `${json.slice(0, maxJ)}…(+${json.length - maxJ}b)`
        : json;
    lines.push("");
    lines.push("health.json:");
    lines.push(body);
  }

  return lines.join("\n").slice(0, 3500);
}
