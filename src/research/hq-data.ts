// @ts-nocheck
/**
 * HQ dashboard data plane — aggregates research, trading, alpha, calibration,
 * and ops signals into one machine-readable payload for /api/hq.
 *
 * Every section is failure-isolated: a missing credential, absent DB, or
 * unreachable upstream degrades that section to a typed "unavailable" state
 * instead of failing the whole payload.
 */
import { readJsonFileOr } from "../lib/json-file.ts";
import { join } from "node:path";
import { listRunSummaries, loadLatestProductionRunAnyDimension } from "./cache.ts";
import { CACHE_DIR, REPORT_DIR, joinPath } from "./paths.ts";
import { getBalance, getOrders, getFills, getPositions } from "../bot/kalshi-client.ts";
import { isWorkingOrder } from "../institutions/ledger-types.ts";
import { recordTradingSnapshot, readTradingHistory } from "./hq-store.ts";

const ROOT = joinPath(import.meta.dir, "../..");
const ALPHA_DIR = joinPath(ROOT, "alpha");
const CALIBRATION_DIR = joinPath(ROOT, "calibration", "artifacts");

// ── Trading section (short-TTL cache so a dashboard refresh burst does not
//    turn into an API burst against Kalshi) ──

const TRADING_CACHE_TTL_MS = 60_000;
let tradingCache: { value: unknown; expiresAtMs: number } | null = null;

/** Test hook — drop the cached trading snapshot. */
export function resetTradingCache(): void {
  tradingCache = null;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    Bun.sleep(ms).then(() => {
      throw new Error("timeout");
    }),
  ]) as Promise<T>;
}

async function fetchTradingSection(nowMs: number) {
  if (tradingCache && nowMs < tradingCache.expiresAtMs) return tradingCache.value;
  const checkedAt = new Date(nowMs).toISOString();
  let value;
  try {
    // Kalshi rate limits are TOKEN-BUCKET: firing 4 signed requests in
    // parallel (balance/positions/orders/fills) exhausts the bucket and
    // yields 401 even with VALID creds (probed 2026-08-24; docs.kalshi.com
    // /getting_started/rate_limits - most requests cost 10 tokens).
    // Fetch balance FIRST as the authoritative auth probe; enrich
    // SEQUENTIALLY so we never burst signed requests.
    const balance = await withTimeout(getBalance(), 3_000).catch((err) => err);
    if (balance instanceof Error) {
      value = {
        state: "unavailable",
        checkedAt,
        reason: balance.message,
      };
      tradingCache = { value, expiresAtMs: nowMs + TRADING_CACHE_TTL_MS };
      return value;
    }
    const positionList = await withTimeout(getPositions(), 3_000).catch(() => []);
    const orderList = await withTimeout(getOrders(), 3_000).catch(() => []);
    const fillList = await withTimeout(getFills(), 3_000).catch(() => []);
    const openOrders = orderList.filter(isWorkingOrder);
    try {
      recordTradingSnapshot({
        atMs: nowMs,
        balanceCents: balance.balanceCents,
        portfolioValueCents: balance.portfolioValueCents,
        positions: positionList,
        openOrderCount: openOrders.length,
        fillCount: fillList.length,
      });
    } catch {
      // persistence is best-effort — never fail the payload
    }
    value = {
      state: "ok",
      checkedAt,
      balanceCents: balance.balanceCents,
      portfolioValueCents: balance.portfolioValueCents,
      positions: positionList,
      openOrders,
      orderCount: orderList.length,
      recentFills: fillList.slice(0, 25),
      fillCount: fillList.length,
    };
  } catch (err) {
    value = {
      state: "unavailable",
      checkedAt,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  tradingCache = { value, expiresAtMs: nowMs + TRADING_CACHE_TTL_MS };
  return value;
}

// ── Alpha programs section ──

type AlphaProgramView = {
  name: string;
  status: string;
  role: string;
  dimension: string;
  created: string | null;
  gates: Record<string, number>;
  shadow: { signals: number; resolutions: number; lastAt: string | null } | null;
  hypothesis: string | null;
};

async function readShadowStats(dir: string, shadowLog: string | undefined) {
  if (!shadowLog) return null;
  const path = joinPath(dir, shadowLog);
  if (!(await Bun.file(path).exists())) return null;
  let signals = 0;
  let resolutions = 0;
  let lastAt: string | null = null;
  try {
    const lines = (await Bun.file(path).text()).split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (rec.kind === "outcome-resolution") resolutions += 1;
        else signals += 1;
        if (typeof rec.ts === "number") lastAt = new Date(rec.ts).toISOString();
      } catch {
        // skip malformed line
      }
    }
  } catch {
    return null;
  }
  return { signals, resolutions, lastAt };
}

type AlphaProgramSeed = {
  name?: string;
  status?: string;
  role?: string;
  dimension?: string;
  created?: string | null;
  gates?: Record<string, unknown>;
  hypothesisFile?: string;
  shadowLog?: string;
};

async function readAlphaPrograms(): Promise<AlphaProgramView[]> {
  const names: string[] = [];
  try {
    // Glob throws ENOENT when ALPHA_DIR is missing (same guard the old
    // existsSync provided); "*/program.json" yields one entry per program dir.
    for await (const rel of new Bun.Glob("*/program.json").scan({ cwd: ALPHA_DIR, onlyFiles: true })) {
      names.push(rel.substring(0, rel.indexOf("/")));
    }
  } catch {
    return [];
  }
  const out: AlphaProgramView[] = [];
  for (const name of names.sort()) {
    const dir = joinPath(ALPHA_DIR, name);
    const programPath = joinPath(dir, "program.json");
    try {
      const p = await readJsonFileOr<AlphaProgramSeed>(programPath, null);
      if (p == null) continue;
      const hypPath = joinPath(dir, p.hypothesisFile ?? "hypothesis.md");
      out.push({
        name: p.name ?? name,
        status: p.status ?? "unknown",
        role: p.role ?? "unknown",
        dimension: p.dimension ?? "unknown",
        created: p.created ?? null,
        gates: p.gates ?? {},
        shadow: await readShadowStats(dir, p.shadowLog),
        hypothesis: (await Bun.file(hypPath).text().catch(() => ""))
          .split("\n").find((l) => l.trim().length > 0) ?? null,
      });
    } catch {
      // skip unreadable program
    }
  }
  return out;
}

// ── Calibration section ──

async function readCalibrationLatest() {
  const latest = await readJsonFileOr<{ runId: string; at: string }>(
    joinPath(CALIBRATION_DIR, "latest-run.json"),
    null,
  );
  if (latest == null) return null;
  try {
    let runs = 0;
    try {
      // One manifest per run dir; Glob throws ENOENT when CALIBRATION_DIR is
      // missing (old readdirSync+statSync guard => 0 either way).
      for await (const _rel of new Bun.Glob("*/manifest.json").scan({ cwd: CALIBRATION_DIR, onlyFiles: true })) {
        runs += 1;
      }
    } catch {
      runs = 0;
    }
    const manifestPath = joinPath(CALIBRATION_DIR, latest.runId, "manifest.json");
    const manifest: unknown = await readJsonFileOr(manifestPath, null);
    return { runId: latest.runId, at: latest.at, totalRuns: runs, manifest };
  } catch {
    return null;
  }
}

// ── Research section ──

function readResearchSection() {
  const run = loadLatestProductionRunAnyDimension();
  const summaries = listRunSummaries(10);
  return {
    latest: run
      ? {
          runId: run.runId,
          generatedAt: run.generatedAt ?? null,
          discovered: run.discovered?.length ?? 0,
          gated: run.gated?.length ?? 0,
          inspected: run.inspected?.length ?? 0,
          shortlisted: run.scored?.filter((s) => s.shortlisted).length ?? 0,
          top: (run.scored ?? [])
            .slice()
            .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))
            .slice(0, 8)
            .map((s) => ({
              fullName: s.repo.fullName,
              stars: s.repo.stars,
              qualityScore: s.qualityScore,
              strategyTags: s.strategyTags ?? [],
            })),
        }
      : null,
    runs: summaries,
  };
}

// ── Freshness tracking (cadence per section; stale = older than cadence) ──

export const FRESHNESS_CADENCE_MIN = {
  research: 7 * 24 * 60, // weekly cron
  trading: 5, // 15s cache + fetch latency
  alpha: 24 * 60, // shadow logs update daily at best
  calibration: 7 * 24 * 60, // weekly-ish maintenance
} as const;

type FreshnessEntry = {
  at: string | null;
  ageMinutes: number | null;
  staleAfterMinutes: number;
  stale: boolean;
};

function freshness(atIso: string | null, staleAfterMinutes: number, nowMs: number): FreshnessEntry {
  if (!atIso) return { at: null, ageMinutes: null, staleAfterMinutes, stale: true };
  const ms = Date.parse(atIso);
  if (!Number.isFinite(ms)) return { at: atIso, ageMinutes: null, staleAfterMinutes, stale: true };
  const ageMinutes = Math.max(0, Math.round((nowMs - ms) / 60_000));
  return { at: atIso, ageMinutes, staleAfterMinutes, stale: ageMinutes > staleAfterMinutes };
}

// ── Cross-site event monitor ──

/** Kalshi market ticker → event ticker (strip trailing -SUFFIX leg). */
export function eventTickerFromMarket(ticker: string): string {
  const i = ticker.lastIndexOf("-");
  return i > 0 ? ticker.slice(0, i) : ticker;
}

function buildMonitorSection(trading: unknown) {
  if ((trading as { state?: string }).state !== "ok") return { kalshi: [], crossSite: [] };
  const t = trading as {
    positions: Array<{ ticker: string; position: number; exposureCents: number | null }>;
    openOrders: Array<{ ticker: string }>;
  };
  const openTickers = new Set(t.openOrders.map((o) => o.ticker));
  const kalshi = t.positions.map((p) => ({
    ticker: p.ticker,
    eventTicker: eventTickerFromMarket(p.ticker),
    position: p.position,
    exposureCents: p.exposureCents,
    hasOpenOrders: openTickers.has(p.ticker),
  }));
  // Group exposure by event for the event-level view
  const byEvent = new Map<string, { exposureCents: number; markets: number }>();
  for (const k of kalshi) {
    const e = byEvent.get(k.eventTicker) ?? { exposureCents: 0, markets: 0 };
    e.exposureCents += Math.abs(k.exposureCents ?? 0);
    e.markets += 1;
    byEvent.set(k.eventTicker, e);
  }
  const crossSite = [...byEvent.entries()]
    .map(([eventTicker, v]) => ({ eventTicker, ...v }))
    .sort((a, b) => b.exposureCents - a.exposureCents);
  return { kalshi, crossSite };
}

// ── Aggregate ──

/** Schema version for the /api/hq JSON contract (bump on breaking shape changes). */
export const HQ_PAYLOAD_SCHEMA_VERSION = 1;

export async function buildHqPayload(nowMs = Date.now()) {
  const trading = await fetchTradingSection(nowMs);
  const research = readResearchSection();
  const alpha = await readAlphaPrograms();
  const calibration = await readCalibrationLatest();
  const alphaLastAt = alpha
    .map((p) => p.shadow?.lastAt)
    .filter((x): x is string => typeof x === "string")
    .sort()
    .pop() ?? null;
  return {
    schemaVersion: HQ_PAYLOAD_SCHEMA_VERSION,
    generatedAt: new Date(nowMs).toISOString(),
    research,
    trading,
    alpha,
    calibration,
    history: readTradingHistory(200),
    monitor: buildMonitorSection(trading),
    freshness: {
      research: freshness(
        research.latest?.generatedAt ?? null,
        FRESHNESS_CADENCE_MIN.research,
        nowMs,
      ),
      trading: freshness(
        trading.state === "ok" ? (trading as { checkedAt?: string }).checkedAt ?? null : null,
        FRESHNESS_CADENCE_MIN.trading,
        nowMs,
      ),
      alpha: freshness(alphaLastAt, FRESHNESS_CADENCE_MIN.alpha, nowMs),
      calibration: freshness(
        calibration?.at ?? null,
        FRESHNESS_CADENCE_MIN.calibration,
        nowMs,
      ),
    },
    links: {
      ops: "/ops",
      opsJson: "/ops.json",
      latestReport: "/reports/latest.md",
      polymarketStatus: "/polymarket/status",
    },
  };
}
