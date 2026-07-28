// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/runtime/utils#bun-inspect-table-tabulardata-properties-options
/**
 * Agent tennis sub-agent — cache/event-store grounded triage (like agent ground).
 * Default: zero network. Optional --canary runs live dry-run smoke.
 */
import type { Database } from "bun:sqlite";
import {
  loadLatestCanary,
  type TennisCanaryArtifact,
} from "../institutions/event-store/live-canary-store.ts";
import {
  analyzeScoreSnapshotCadence,
  listLiveEventIds,
  listWatchEvents,
  type SnapshotCadenceReport,
} from "../institutions/event-store/live-scores.ts";
import { openEventStore } from "../institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../institutions/event-store/paths.ts";
import {
  loadLatestWsGround,
  type TennisWsGroundLatest,
} from "../institutions/event-store/tennis-ws-ground.ts";
import {
  loadLatestTennisWsRecorderSession,
  loadTennisWsRecorderHistory,
  summarizeTennisWsRecorderTrend,
  type TennisWsRecorderSessionArtifact,
  type TennisWsRecorderTrend,
} from "../institutions/event-store/tennis-ws-recorder-store.ts";
import { formatProbeErrorCodes } from "../institutions/event-store/kalshi-ws-recorder.ts";
import {
  loadLatestExperimentSession,
  type ExperimentSessionArtifact,
} from "../operations/experiment-store.ts";
import { analyzeTennisBookCoverage, type TennisBookCoverageReport } from "../institutions/event-store/tennis-book-coverage.ts";
import {
  resolveTennisLeadMinutes,
  TENNIS_CANARY_ARTIFACT_STALE_MS,
  TENNIS_EXPERIMENT_ARTIFACT_STALE_MS,
  TENNIS_LIVE_INTERVAL_MS_DEFAULT,
  TENNIS_WATCH_LIMIT,
  TENNIS_WS_GROUND_ARTIFACT_STALE_MS,
} from "../institutions/event-store/tennis-lane-constants.ts";
import { formatInspectTable } from "../research/terminal-out.ts";

export type TennisGroundOptions = {
  dbPath?: string;
  leadMinutes?: number;
  intervalMs?: number;
};

export type TennisGroundReport = {
  source: "event-store";
  dbPath: string;
  at: string;
  store: {
    events: number;
    markets: number;
    liveScores: number;
    scoreSnapshots: number;
    bookTicks: number;
    watchSize: number;
    liveNow: number;
  };
  canary: TennisCanaryArtifact | null;
  wsGround: TennisWsGroundLatest | null;
  wsSession: TennisWsRecorderSessionArtifact | null;
  wsSessionHistory: TennisWsRecorderSessionArtifact[];
  wsRecorderTrend: TennisWsRecorderTrend;
  experiments: ExperimentSessionArtifact | null;
  bookCoverage: TennisBookCoverageReport;
  cadence: SnapshotCadenceReport;
  nextActions: string[];
};

function count(db: Database, sql: string): number {
  const row = db.query(sql).get() as { n: number } | null;
  return row?.n ?? 0;
}

export function buildTennisNextActions(report: Omit<TennisGroundReport, "nextActions">): string[] {
  const actions: string[] = [];
  const c = report.canary;
  const w = report.wsGround;
  const t = report.cadence.totals;

  if (!c) {
    actions.push("bun run tennis:live:canary   # first smoke + artifact under research/cache/tennis-canary/");
  } else if (c.exitCode !== 0) {
    actions.push("bun run tennis:live:canary   # last canary FAILED — re-run and inspect wire_shape / errors");
    actions.push("bun run tennis:live -- --dry-run --verbose --json");
  } else {
    const ageMs = Date.now() - Date.parse(c.at);
    if (!Number.isFinite(ageMs) || ageMs > TENNIS_CANARY_ARTIFACT_STALE_MS) {
      actions.push("bun run tennis:live:canary   # last canary >30m old");
    }
  }

  if (report.store.watchSize === 0) {
    actions.push("bun run tennis:live -- --sync   # empty watch — sync ITF markets");
  } else if (report.store.liveNow === 0 && report.store.watchSize > 0) {
    actions.push("bun run tennis:live -- --dry-run   # watch non-empty, nothing live — poll classify");
  }

  const multiSnap = report.cadence.events.some((e) => e.snapshots >= 3);
  if (report.store.scoreSnapshots < 3 || !multiSnap) {
    actions.push(
      "bun run tennis:live -- --sync --loop   # promote: age score_snapshots for cadence",
    );
  } else if (t.restMiss > 0) {
    actions.push(
      "bun run tennis:live:cadence   # REST miss — consider TENNIS_LIVE_INTERVAL_MS=5000 or WS cue",
    );
  } else if (t.events > 0 && t.restBorderline > 0) {
    actions.push("bun run tennis:live:cadence -- --json   # borderline gaps — measure during live game");
  }

  actions.push("bun run tennis:record -- --watch --dry-run   # books under same watch set");
  actions.push("bun run tennis:record -- --ws --ws-seconds=60   # live orderbook WS → book_ticks");
  if (!w) {
    actions.push("bun run tennis:ws-ground   # first Bun.WebView + Bun.Image dashboard artifact");
  } else if (!w.webview) {
    actions.push("bun run tennis:ws-ground   # last run html-only — re-capture WebView png");
  } else {
    const wsAgeMs = Date.now() - Date.parse(w.at);
    if (!Number.isFinite(wsAgeMs) || wsAgeMs > TENNIS_WS_GROUND_ARTIFACT_STALE_MS) {
      actions.push("bun run tennis:ws-ground   # WS ground artifact >1h old");
    }
  }
  if (report.bookCoverage.watchWithWs === 0 && report.bookCoverage.watchTickers > 0) {
    actions.push("bun run tennis:record -- --ws --ws-seconds=120   # no WS ticks on current watch-set");
    actions.push("bun run tennis:record:ws:register   # OS cron every 30m (if not registered)");
  }
  const trend = report.wsRecorderTrend;
  if (trend.sessions > 0 && trend.gapSessionPct != null && trend.gapSessionPct >= 50) {
    actions.push(
      "bun run tennis:record -- --ws --ws-seconds=300   # >50% WS sessions had seq gaps — longer capture",
    );
  }
  if (report.wsSession && report.wsSession.deltas === 0 && report.wsSession.snapshots > 0) {
    actions.push(
      "bun run tennis:record -- --ws --ws-seconds=300   # last session snapshots-only — need live deltas",
    );
  }
  const exp = report.experiments;
  if (!exp) {
    actions.push(
      "bun run tennis:experiment -- launch --name=phase1 --routing=static,dynamic   # no experiment artifact",
    );
  } else if (exp.status === "active") {
    actions.push(
      `bun run tennis:experiment -- check --experiment=${exp.experimentId}   # daily check active experiment`,
    );
    if (exp.totalObservations === 0) {
      actions.push(
        `bun run tennis:experiment -- assign --experiment=${exp.experimentId} --partner=<eventId>`,
      );
      actions.push(
        `bun run tennis:experiment -- ingest --experiment=${exp.experimentId} --program=tennis-game-model   # shadow → metrics`,
      );
    }
    const expAgeMs = Date.now() - Date.parse(exp.at);
    if (!Number.isFinite(expAgeMs) || expAgeMs > TENNIS_EXPERIMENT_ARTIFACT_STALE_MS) {
      actions.push("bun run tennis:experiment -- check-all   # experiment artifact stale");
    }
  }
  actions.push("bun run agent tennis --webview   # ground + refresh visual artifact");
  actions.push("bun run tennis:live:canary:register   # OS cron every 15m (if not registered)");
  actions.push("bun run tennis:experiment:register   # OS cron daily experiment check");
  actions.push("bun run agent tennis --json   # re-ground after action");

  // de-dupe preserve order
  const seen = new Set<string>();
  return actions.filter((a) => (seen.has(a) ? false : (seen.add(a), true)));
}

export async function runTennisGround(
  options: TennisGroundOptions = {},
): Promise<TennisGroundReport> {
  const dbPath = options.dbPath ?? DEFAULT_EVENT_STORE_DB;
  const db = openEventStore({ dbPath });
  const leadMinutes = resolveTennisLeadMinutes(options.leadMinutes);
  const intervalMs =
    options.intervalMs ?? Number(Bun.env.TENNIS_LIVE_INTERVAL_MS ?? TENNIS_LIVE_INTERVAL_MS_DEFAULT);

  const watch = listWatchEvents(db, { leadMinutes, limit: TENNIS_WATCH_LIMIT, clearStale: false });
  const liveNow = listLiveEventIds(db).length;
  const cadence = analyzeScoreSnapshotCadence(db, { intervalMs });
  const canary = await loadLatestCanary();
  const wsGround = await loadLatestWsGround();
  const wsSession = await loadLatestTennisWsRecorderSession();
  const wsSessionHistory = await loadTennisWsRecorderHistory(8);
  const wsRecorderTrend = summarizeTennisWsRecorderTrend(wsSessionHistory);
  const experiments = await loadLatestExperimentSession();
  const bookCoverage = analyzeTennisBookCoverage(db, { leadMinutes, limit: TENNIS_WATCH_LIMIT });

  const partial = {
    source: "event-store" as const,
    dbPath,
    at: new Date().toISOString(),
    store: {
      events: count(db, "SELECT COUNT(*) AS n FROM events"),
      markets: count(db, "SELECT COUNT(*) AS n FROM markets"),
      liveScores: count(db, "SELECT COUNT(*) AS n FROM live_scores"),
      scoreSnapshots: count(db, "SELECT COUNT(*) AS n FROM score_snapshots"),
      bookTicks: count(db, "SELECT COUNT(*) AS n FROM book_ticks"),
      watchSize: watch.length,
      liveNow,
    },
    canary,
    wsGround,
    wsSession,
    wsSessionHistory,
    wsRecorderTrend,
    experiments,
    bookCoverage,
    cadence,
  };

  return {
    ...partial,
    nextActions: buildTennisNextActions(partial),
  };
}

export function formatTennisGround(report: TennisGroundReport): string {
  const lines: string[] = [
    "Kalshi agent tennis",
    `Source: ${report.source}  db=${report.dbPath}`,
    `At: ${report.at}`,
    "",
    "Store",
    `  events=${report.store.events}  markets=${report.store.markets}` +
      `  live_scores=${report.store.liveScores}  snapshots=${report.store.scoreSnapshots}` +
      `  book_ticks=${report.store.bookTicks}`,
    `  watch=${report.store.watchSize}  live_now=${report.store.liveNow}`,
  ];

  if (report.canary) {
    const c = report.canary;
    const ok = c.exitCode === 0 ? "OK" : "FAIL";
    lines.push(
      "",
      "Canary (latest artifact)",
      `  ${ok}  at=${c.at}  duration=${c.durationMs}ms  fp=${c.fingerprint}`,
      `  watch=${c.summary.watched} polled=${c.summary.polled} live=${c.summary.live}` +
        ` would_upsert=${c.summary.upserted} wire_missing=${c.summary.wireMissingRows}`,
    );
    for (const r of c.reasons.slice(0, 5)) lines.push(`  ! ${r}`);
    for (const w of c.warnings.slice(0, 3)) lines.push(`  ~ ${w}`);
  } else {
    lines.push("", "Canary: none — run bun run tennis:live:canary");
  }

  if (report.wsGround) {
    const w = report.wsGround;
    lines.push(
      "",
      "WS ground (latest artifact)",
      `  at=${w.at}  webview=${w.webview}  image=${w.image}`,
      `  watch=${w.watchEvents}/${w.watchTickers}  book_ticks ws=${w.wsTicks} rest=${w.restTicks} rows=${w.rows}`,
      `  png=${w.dashboardPng}`,
    );
    if (w.image) lines.push(`  thumb=${w.thumbWebp}`);
  } else {
    lines.push("", "WS ground: none — run bun run tennis:ws-ground");
  }

  const bc = report.bookCoverage;
  lines.push(
    "",
    "Book tick coverage (watch-set)",
    `  watch tickers=${bc.watchTickers}  with_ws=${bc.watchWithWs}  with_rest=${bc.watchWithRest}` +
      `  both=${bc.watchWithBoth}  neither=${bc.watchWithNeither}`,
    `  ws exchange_clock=${bc.wsExchangeClockPct ?? "—"}%  linked+ws=${bc.linkedEventsWithWs}/${bc.linkedEventsTotal}`,
  );

  if (report.wsSession) {
    const s = report.wsSession;
    lines.push(
      "",
      "WS recorder (latest session)",
      `  at=${s.at}  duration=${s.durationMs}ms  subscribed=${s.subscribedTickers}  fp=${s.fingerprint}`,
      `  ticks=${s.ticksRecorded} snapshots=${s.snapshots} deltas=${s.deltas}` +
        ` gaps=${s.seqGaps} dup=${s.duplicates} resync=${s.resyncRequests}` +
        ` wsErrors=${s.wsErrors ?? 0} errors=${s.errors}` +
        formatProbeErrorCodes(s),
    );
  }

  if (report.experiments) {
    const e = report.experiments;
    lines.push(
      "",
      "Experiments (latest artifact)",
      `  status=${e.status}  at=${e.at}  id=${e.experimentId}  fp=${e.fingerprint}`,
      `  n=${e.totalObservations} mean=${e.grandMean.toFixed(3)} r²=${e.rSquared.toFixed(3)}`,
    );
    for (const me of e.mainEffects.slice(0, 4)) {
      lines.push(`  ${me.factor}=${me.level} effect=${me.effect.toFixed(3)} n=${me.n}`);
    }
    if (e.reason) lines.push(`  reason: ${e.reason}`);
  } else {
    lines.push("", "Experiments: none — bun run tennis:experiment -- latest");
  }

  const tr = report.wsRecorderTrend;
  if (tr.sessions > 0) {
    lines.push(
      "",
      "WS recorder trend (history)",
      `  sessions=${tr.sessions}  total_deltas=${tr.totalDeltas}  total_gaps=${tr.totalGaps}` +
        `  resyncs=${tr.totalResyncs}  gap_sessions=${tr.gapSessionPct ?? "—"}%`,
    );
    const histRows = report.wsSessionHistory.slice(-5).map((s) => ({
      at: s.at.slice(11, 19),
      dur: `${Math.round(s.durationMs / 1000)}s`,
      sub: s.subscribedTickers,
      delta: s.deltas,
      gaps: s.seqGaps,
    }));
    if (histRows.length) {
      lines.push(formatInspectTable(histRows, ["at", "dur", "sub", "delta", "gaps"]).trimEnd());
    }
  }

  const t = report.cadence.totals;
  lines.push(
    "",
    "Cadence (score_snapshots)",
    `  events=${t.events} snaps=${t.snapshots}` +
      `  Δ point=${t.pointTransitions} game=${t.gameTransitions} set=${t.setTransitions}` +
      `  rest miss=${t.restMiss} borderline=${t.restBorderline}`,
  );

  const cadenceRows = report.cadence.events.slice(0, 8).map((e) => ({
    event: e.eventTicker.slice(0, 36),
    snaps: e.snapshots,
    med_gap: e.medianGapMs == null ? "—" : `${Math.round(e.medianGapMs)}ms`,
    rest: e.restVerdict,
    game: e.transitions.game,
    set: e.transitions.set,
  }));
  if (cadenceRows.length) {
    lines.push(formatInspectTable(cadenceRows, ["event", "snaps", "med_gap", "rest", "game", "set"]).trimEnd());
  }

  lines.push("", "Next actions");
  for (const [i, a] of report.nextActions.entries()) {
    lines.push(`  ${i + 1}. ${a}`);
  }
  return lines.join("\n");
}
