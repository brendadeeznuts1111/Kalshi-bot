/**
 * Partner ledger — structured ops + ticket rows (no invented settlement API).
 *
 * Kinds:
 *   - desk_snapshot  written by partner:finance-cron each cycle
 *   - ticket         from known betGroups wire when placeOrder/history lands
 *
 * Source of truth for P&L remains the book until a list-tickets HAR is mapped;
 * this table is our local audit + desk time series.
 */
// @see https://bun.com/docs/runtime/sqlite
import type { Database } from "bun:sqlite";
import type { PartnerBetGroup, PartnerExecutionResult } from "./types.ts";

export type PartnerLedgerKind =
  | "desk_snapshot"
  | "ticket"
  | "odds_book"
  | "risk_health";

export type PartnerLedgerRow = {
  id: string;
  kind: PartnerLedgerKind;
  outId: string;
  partnerId: string;
  partnerCode: string;
  provider: string;
  /** UTC day key YYYY-MM-DD for daily rollups */
  dayUtc: string;
  /** Capacity snapshot or stake (risk) for tickets */
  amount: number;
  /** toWin / net when known */
  secondaryAmount: number | null;
  currency: string;
  /** ticketNumber / stream summary key */
  externalId: string | null;
  rawJson: string;
  createdAt: number;
};

export function ensurePartnerLedgerSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS partner_ledger (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    out_id TEXT NOT NULL,
    partner_id TEXT NOT NULL,
    partner_code TEXT NOT NULL,
    provider TEXT NOT NULL,
    day_utc TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    secondary_amount REAL,
    currency TEXT NOT NULL DEFAULT 'USD',
    external_id TEXT,
    raw_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_partner_ledger_out_day ON partner_ledger (out_id, day_utc)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_partner_ledger_kind_day ON partner_ledger (kind, day_utc)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_partner_ledger_partner ON partner_ledger (partner_code, day_utc)`,
  );
}

export function dayUtcFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function insertPartnerLedgerRow(
  db: Database,
  row: Omit<PartnerLedgerRow, "id" | "createdAt"> & {
    id?: string;
    createdAt?: number;
  },
): PartnerLedgerRow {
  ensurePartnerLedgerSchema(db);
  const createdAt = row.createdAt ?? Date.now();
  const id = row.id ?? `pl_${createdAt}_${Math.random().toString(36).slice(2, 10)}`;
  const full: PartnerLedgerRow = {
    id,
    kind: row.kind,
    outId: row.outId,
    partnerId: row.partnerId,
    partnerCode: row.partnerCode,
    provider: row.provider,
    dayUtc: row.dayUtc,
    amount: row.amount,
    secondaryAmount: row.secondaryAmount,
    currency: row.currency,
    externalId: row.externalId,
    rawJson: row.rawJson,
    createdAt,
  };
  db.query(
    `INSERT INTO partner_ledger (
       id, kind, out_id, partner_id, partner_code, provider, day_utc,
       amount, secondary_amount, currency, external_id, raw_json, created_at
     ) VALUES (
       $id, $kind, $out_id, $partner_id, $partner_code, $provider, $day_utc,
       $amount, $secondary, $currency, $external_id, $raw_json, $created_at
     )`,
  ).run({
    $id: full.id,
    $kind: full.kind,
    $out_id: full.outId,
    $partner_id: full.partnerId,
    $partner_code: full.partnerCode,
    $provider: full.provider,
    $day_utc: full.dayUtc,
    $amount: full.amount,
    $secondary: full.secondaryAmount,
    $currency: full.currency,
    $external_id: full.externalId,
    $raw_json: full.rawJson,
    $created_at: full.createdAt,
  });
  return full;
}

/** Upsert-ish: one desk_snapshot per out per day (replace latest same day). */
export function writeDeskSnapshot(
  db: Database,
  input: {
    outId: string;
    partnerId: string;
    partnerCode: string;
    provider: string;
    totalPerBetMax: number;
    workingBalance: number | null;
    envOk: boolean;
    skinCount: number;
    currency?: string;
    extra?: Record<string, unknown>;
    nowMs?: number;
  },
): PartnerLedgerRow {
  ensurePartnerLedgerSchema(db);
  const nowMs = input.nowMs ?? Date.now();
  const dayUtc = dayUtcFromMs(nowMs);
  // Remove prior snapshot for same out+day so re-runs stay clean
  db.query(
    `DELETE FROM partner_ledger
     WHERE kind = 'desk_snapshot' AND out_id = $out AND day_utc = $day`,
  ).run({ $out: input.outId, $day: dayUtc });

  return insertPartnerLedgerRow(db, {
    kind: "desk_snapshot",
    outId: input.outId,
    partnerId: input.partnerId,
    partnerCode: input.partnerCode,
    provider: input.provider,
    dayUtc,
    amount: input.totalPerBetMax,
    secondaryAmount: input.workingBalance,
    currency: input.currency ?? "USD",
    externalId: null,
    rawJson: JSON.stringify({
      totalPerBetMax: input.totalPerBetMax,
      workingBalance: input.workingBalance,
      envOk: input.envOk,
      skinCount: input.skinCount,
      ...(input.extra ?? {}),
    }),
    createdAt: nowMs,
  });
}

/** Open vs settled from known Fantasy place/list markers (no invented P&L). */
export type TicketLedgerStatus = "open" | "settled" | "unknown";

export type TicketWriteAction = "inserted" | "updated" | "skipped";

export type TicketWriteResult = {
  action: TicketWriteAction;
  row: PartnerLedgerRow | null;
};

export function classifyTicketStatus(input: {
  result?: number | null;
  state?: number | null;
  isWin?: number | null;
}): TicketLedgerStatus {
  if (input.isWin === 0 || input.isWin === 1) return "settled";
  if (input.result != null && input.result !== 0) return "settled";
  if (input.state != null && input.state !== 0) return "settled";
  if (input.result === 0 || input.state === 0) return "open";
  return "unknown";
}

function ticketRawFingerprint(rawJson: string): string {
  try {
    const j = JSON.parse(rawJson) as Record<string, unknown>;
    return JSON.stringify({
      risk: j.risk,
      toWin: j.toWin,
      result: j.result ?? null,
      state: j.state ?? null,
      isWin: j.isWin ?? null,
      status: j.status ?? null,
      finalOdds: j.finalOdds ?? null,
      legCount: Array.isArray(j.legs) ? j.legs.length : 0,
    });
  } catch {
    return rawJson;
  }
}

function buildTicketRawJson(input: {
  result: PartnerExecutionResult;
  group?: PartnerBetGroup;
}): string {
  const g = input.group;
  const status = classifyTicketStatus({
    result: g?.result ?? null,
    state: g?.state ?? null,
    isWin: g?.isWin ?? null,
  });
  return JSON.stringify({
    ticketNumber: input.result.ticketNumber ?? g?.ticketNumber,
    betGroupId: input.result.betGroupId ?? g?.betGroupId,
    finalOdds: input.result.finalOdds ?? g?.finalOdds,
    risk: input.result.risk ?? g?.risk,
    toWin: input.result.toWin ?? g?.toWin,
    remainingBalance: input.result.remainingBalance,
    success: input.result.success,
    dryRun: input.result.dryRun,
    wireErrorCode: input.result.wireErrorCode,
    result: g?.result ?? null,
    state: g?.state ?? null,
    isWin: g?.isWin ?? null,
    status,
    currency: input.result.currency ?? g?.currency ?? null,
    legs: (g?.legs ?? []).map((leg) => ({
      betId: leg.betId,
      eventId: leg.eventId,
      marketId: leg.marketId,
      key: leg.key,
      team1: leg.team1,
      team2: leg.team2,
      finalOdds: leg.finalOdds,
      state: leg.state,
    })),
  });
}

/**
 * Store a ticket from known betGroups / execution result wire.
 * external_id = ticketNumber; re-ingest updates when payload changes
 * (`updateExisting`, default true) so settlement markers can land later.
 */
export function writeTicketFromExecution(
  db: Database,
  input: {
    outId: string;
    partnerId: string;
    partnerCode: string;
    provider: string;
    result: PartnerExecutionResult;
    group?: PartnerBetGroup;
    currency?: string;
    nowMs?: number;
    /** When false, duplicate ticketNumber is skipped (legacy). Default true. */
    updateExisting?: boolean;
  },
): TicketWriteResult {
  if (!input.result.success && !input.result.ticketNumber) {
    return { action: "skipped", row: null };
  }
  ensurePartnerLedgerSchema(db);
  const nowMs = input.nowMs ?? Date.now();
  const ticket = input.result.ticketNumber ?? null;
  const rawJson = buildTicketRawJson({
    result: input.result,
    group: input.group,
  });
  const amount = input.result.risk ?? 0;
  const secondaryAmount = input.result.toWin ?? null;
  const currency = input.result.currency ?? input.currency ?? "USD";
  const updateExisting = input.updateExisting !== false;

  if (ticket) {
    const existing = db
      .query(
        `SELECT id, raw_json AS rawJson, amount, secondary_amount AS secondaryAmount
         FROM partner_ledger
         WHERE kind = 'ticket' AND out_id = $out AND external_id = $ext`,
      )
      .get({ $out: input.outId, $ext: ticket }) as {
      id: string;
      rawJson: string;
      amount: number;
      secondaryAmount: number | null;
    } | null;
    if (existing) {
      if (!updateExisting) return { action: "skipped", row: null };
      const same =
        ticketRawFingerprint(existing.rawJson) ===
          ticketRawFingerprint(rawJson) &&
        Number(existing.amount) === amount &&
        Number(existing.secondaryAmount ?? 0) === Number(secondaryAmount ?? 0);
      if (same) return { action: "skipped", row: null };
      db.query(
        `UPDATE partner_ledger
         SET amount = $amount,
             secondary_amount = $secondary,
             currency = $currency,
             partner_id = $partner_id,
             partner_code = $partner_code,
             provider = $provider,
             raw_json = $raw_json,
             created_at = $created_at
         WHERE id = $id`,
      ).run({
        $id: existing.id,
        $amount: amount,
        $secondary: secondaryAmount,
        $currency: currency,
        $partner_id: input.partnerId,
        $partner_code: input.partnerCode,
        $provider: input.provider,
        $raw_json: rawJson,
        $created_at: nowMs,
      });
      return {
        action: "updated",
        row: {
          id: existing.id,
          kind: "ticket",
          outId: input.outId,
          partnerId: input.partnerId,
          partnerCode: input.partnerCode,
          provider: input.provider,
          dayUtc: dayUtcFromMs(nowMs),
          amount,
          secondaryAmount,
          currency,
          externalId: ticket,
          rawJson,
          createdAt: nowMs,
        },
      };
    }
  }

  const row = insertPartnerLedgerRow(db, {
    kind: "ticket",
    outId: input.outId,
    partnerId: input.partnerId,
    partnerCode: input.partnerCode,
    provider: input.provider,
    dayUtc: dayUtcFromMs(nowMs),
    amount,
    secondaryAmount,
    currency,
    externalId: ticket,
    rawJson,
    createdAt: nowMs,
  });
  return { action: "inserted", row };
}

/**
 * Persist a priced-book snapshot from WebView/Pandora coefficient ingest.
 * amount = priced line count; secondary = priced event count.
 */
export function writeOddsBookSnapshot(
  db: Database,
  input: {
    outId: string;
    partnerId: string;
    partnerCode: string;
    provider?: string;
    pricedLines: number;
    pricedEvents: number;
    markets?: unknown;
    source?: string;
    capturePath?: string;
    nowMs?: number;
  },
): PartnerLedgerRow {
  ensurePartnerLedgerSchema(db);
  const nowMs = input.nowMs ?? Date.now();
  const dayUtc = dayUtcFromMs(nowMs);
  db.query(
    `DELETE FROM partner_ledger
     WHERE kind = 'odds_book' AND out_id = $out AND day_utc = $day`,
  ).run({ $out: input.outId, $day: dayUtc });

  return insertPartnerLedgerRow(db, {
    kind: "odds_book",
    outId: input.outId,
    partnerId: input.partnerId,
    partnerCode: input.partnerCode,
    provider: input.provider ?? "fantasy402",
    dayUtc,
    amount: input.pricedLines,
    secondaryAmount: input.pricedEvents,
    currency: "USD",
    externalId: input.capturePath ?? null,
    rawJson: JSON.stringify({
      source: input.source ?? "bun.webview+pandora",
      pricedLines: input.pricedLines,
      pricedEvents: input.pricedEvents,
      markets: input.markets ?? null,
      capturePath: input.capturePath,
    }),
    createdAt: nowMs,
  });
}

/**
 * Persist risk-health fingerprint for alert dedupe.
 * external_id = sha256 of sorted finding codes; amount = errorCount, secondary = warnCount.
 */
export function writeRiskHealthSnapshot(
  db: Database,
  input: {
    fingerprint: string;
    errorCount: number;
    warnCount: number;
    findings: unknown;
    nowMs?: number;
  },
): PartnerLedgerRow {
  ensurePartnerLedgerSchema(db);
  const nowMs = input.nowMs ?? Date.now();
  return insertPartnerLedgerRow(db, {
    kind: "risk_health",
    outId: "_global",
    partnerId: "_global",
    partnerCode: "OPS",
    provider: "system",
    dayUtc: dayUtcFromMs(nowMs),
    amount: input.errorCount,
    secondaryAmount: input.warnCount,
    currency: "USD",
    externalId: input.fingerprint,
    rawJson: JSON.stringify({
      fingerprint: input.fingerprint,
      errorCount: input.errorCount,
      warnCount: input.warnCount,
      findings: input.findings,
    }),
    createdAt: nowMs,
  });
}

/** Last risk_health fingerprint (for dedupe). */
export function lastRiskHealthFingerprint(db: Database): string | null {
  ensurePartnerLedgerSchema(db);
  const row = db
    .query(
      `SELECT external_id AS fp FROM partner_ledger
       WHERE kind = 'risk_health' AND out_id = '_global'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get() as { fp: string | null } | null;
  return row?.fp ?? null;
}

export function writeTicketFromBetGroup(
  db: Database,
  input: {
    outId: string;
    partnerId: string;
    partnerCode: string;
    provider: string;
    group: PartnerBetGroup;
    nowMs?: number;
    updateExisting?: boolean;
  },
): TicketWriteResult {
  return writeTicketFromExecution(db, {
    outId: input.outId,
    partnerId: input.partnerId,
    partnerCode: input.partnerCode,
    provider: input.provider,
    result: {
      success: true,
      ticketNumber: input.group.ticketNumber,
      betGroupId: input.group.betGroupId,
      finalOdds: input.group.finalOdds ?? undefined,
      risk: input.group.risk,
      toWin: input.group.toWin,
      currency: input.group.currency ?? undefined,
    },
    group: input.group,
    currency: input.group.currency ?? undefined,
    nowMs: input.nowMs,
    updateExisting: input.updateExisting,
  });
}

export type LedgerFreshness = {
  outId: string;
  lastDeskSnapshotAt: number | null;
  lastTicketAt: number | null;
  lastOddsBookAt: number | null;
  deskSnapshotsToday: number;
  ticketsToday: number;
  oddsLinesToday: number;
};

export type TicketOutDayTotals = {
  outId: string;
  partnerCode: string;
  ticketCount: number;
  totalRisk: number;
  totalToWin: number;
  openCount: number;
  settledCount: number;
  openRisk: number;
  settledRisk: number;
};

export type TicketDayTotals = {
  dayUtc: string;
  ticketCount: number;
  totalRisk: number;
  totalToWin: number;
  openCount: number;
  settledCount: number;
  openRisk: number;
  settledRisk: number;
  byOut: TicketOutDayTotals[];
};

function statusFromTicketRaw(rawJson: string): TicketLedgerStatus {
  try {
    const j = JSON.parse(rawJson) as {
      status?: TicketLedgerStatus;
      result?: number | null;
      state?: number | null;
      isWin?: number | null;
    };
    if (j.status === "open" || j.status === "settled" || j.status === "unknown") {
      return j.status;
    }
    return classifyTicketStatus(j);
  } catch {
    return "unknown";
  }
}

/** Sum ticket rows for a UTC day (optional partner / out filter). */
export function sumTicketTotalsForDay(
  db: Database,
  options: {
    dayUtc?: string;
    partnerCode?: string;
    outId?: string;
    nowMs?: number;
  } = {},
): TicketDayTotals {
  ensurePartnerLedgerSchema(db);
  const dayUtc = options.dayUtc ?? dayUtcFromMs(options.nowMs ?? Date.now());
  const clauses = [`kind = 'ticket'`, `day_utc = $day`];
  const params: Record<string, string> = { $day: dayUtc };
  if (options.partnerCode) {
    clauses.push(`partner_code = $pc`);
    params.$pc = options.partnerCode.trim().toUpperCase();
  }
  if (options.outId) {
    clauses.push(`out_id = $out`);
    params.$out = options.outId;
  }
  const where = clauses.join(" AND ");
  const rows = db
    .query(
      `SELECT out_id AS outId, partner_code AS partnerCode,
              amount, secondary_amount AS toWin, raw_json AS rawJson
       FROM partner_ledger
       WHERE ${where}
       ORDER BY out_id`,
    )
    .all(params) as Array<{
    outId: string;
    partnerCode: string;
    amount: number;
    toWin: number | null;
    rawJson: string;
  }>;

  const byOutMap = new Map<string, TicketOutDayTotals>();
  let ticketCount = 0;
  let totalRisk = 0;
  let totalToWin = 0;
  let openCount = 0;
  let settledCount = 0;
  let openRisk = 0;
  let settledRisk = 0;

  for (const r of rows) {
    const risk = Number(r.amount) || 0;
    const toWin = Number(r.toWin) || 0;
    const status = statusFromTicketRaw(r.rawJson);
    ticketCount += 1;
    totalRisk += risk;
    totalToWin += toWin;
    if (status === "open") {
      openCount += 1;
      openRisk += risk;
    } else if (status === "settled") {
      settledCount += 1;
      settledRisk += risk;
    }

    let out = byOutMap.get(r.outId);
    if (!out) {
      out = {
        outId: r.outId,
        partnerCode: r.partnerCode,
        ticketCount: 0,
        totalRisk: 0,
        totalToWin: 0,
        openCount: 0,
        settledCount: 0,
        openRisk: 0,
        settledRisk: 0,
      };
      byOutMap.set(r.outId, out);
    }
    out.ticketCount += 1;
    out.totalRisk += risk;
    out.totalToWin += toWin;
    if (status === "open") {
      out.openCount += 1;
      out.openRisk += risk;
    } else if (status === "settled") {
      out.settledCount += 1;
      out.settledRisk += risk;
    }
  }

  return {
    dayUtc,
    ticketCount,
    totalRisk,
    totalToWin,
    openCount,
    settledCount,
    openRisk,
    settledRisk,
    byOut: [...byOutMap.values()].sort((a, b) =>
      a.outId.localeCompare(b.outId),
    ),
  };
}

export function listLedgerFreshness(
  db: Database,
  nowMs = Date.now(),
): LedgerFreshness[] {
  ensurePartnerLedgerSchema(db);
  const day = dayUtcFromMs(nowMs);
  const outs = db
    .query(`SELECT DISTINCT out_id AS outId FROM partner_ledger`)
    .all() as Array<{ outId: string }>;

  return outs.map((o) => {
    const lastDesk = db
      .query(
        `SELECT MAX(created_at) AS t FROM partner_ledger
         WHERE out_id = $o AND kind = 'desk_snapshot'`,
      )
      .get({ $o: o.outId }) as { t: number | null };
    const lastTicket = db
      .query(
        `SELECT MAX(created_at) AS t FROM partner_ledger
         WHERE out_id = $o AND kind = 'ticket'`,
      )
      .get({ $o: o.outId }) as { t: number | null };
    const lastOdds = db
      .query(
        `SELECT MAX(created_at) AS t FROM partner_ledger
         WHERE out_id = $o AND kind = 'odds_book'`,
      )
      .get({ $o: o.outId }) as { t: number | null };
    const deskToday = db
      .query(
        `SELECT COUNT(*) AS c FROM partner_ledger
         WHERE out_id = $o AND kind = 'desk_snapshot' AND day_utc = $d`,
      )
      .get({ $o: o.outId, $d: day }) as { c: number };
    const ticketsToday = db
      .query(
        `SELECT COUNT(*) AS c FROM partner_ledger
         WHERE out_id = $o AND kind = 'ticket' AND day_utc = $d`,
      )
      .get({ $o: o.outId, $d: day }) as { c: number };
    const oddsToday = db
      .query(
        `SELECT COALESCE(SUM(amount), 0) AS c FROM partner_ledger
         WHERE out_id = $o AND kind = 'odds_book' AND day_utc = $d`,
      )
      .get({ $o: o.outId, $d: day }) as { c: number };
    return {
      outId: o.outId,
      lastDeskSnapshotAt: lastDesk.t ?? null,
      lastTicketAt: lastTicket.t ?? null,
      lastOddsBookAt: lastOdds.t ?? null,
      deskSnapshotsToday: deskToday.c,
      ticketsToday: ticketsToday.c,
      oddsLinesToday: Number(oddsToday.c) || 0,
    };
  });
}
