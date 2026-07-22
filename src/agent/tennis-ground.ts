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
  const t = report.cadence.totals;

  if (!c) {
    actions.push("bun run tennis:live:canary   # first smoke + artifact under research/cache/tennis-canary/");
  } else if (c.exitCode !== 0) {
    actions.push("bun run tennis:live:canary   # last canary FAILED — re-run and inspect wire_shape / errors");
    actions.push("bun run tennis:live -- --dry-run --verbose --json");
  } else {
    const ageMs = Date.now() - Date.parse(c.at);
    if (!Number.isFinite(ageMs) || ageMs > 30 * 60_000) {
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
  actions.push("bun run tennis:live:canary:register   # OS cron every 15m (if not registered)");
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
  const leadMinutes = options.leadMinutes ?? 5;
  const intervalMs = options.intervalMs ?? Number(Bun.env.TENNIS_LIVE_INTERVAL_MS ?? 10_000);

  const watch = listWatchEvents(db, { leadMinutes, limit: 40, clearStale: false });
  const liveNow = listLiveEventIds(db).length;
  const cadence = analyzeScoreSnapshotCadence(db, { intervalMs });
  const canary = await loadLatestCanary();

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
