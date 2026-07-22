#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
/**
 * Poll Kalshi /milestones + /live_data for watch-set ITF events.
 * Watch = occurrence within --lead minutes OR already is_live (early start).
 * Clocks labeled source_clock=recv — no vendor point timestamps.
 *
 * --dry-run: fetch + classify to write boundary; no live_scores / score_snapshots writes.
 *            would_upsert / would_snapshots use the same plan as the real writer.
 * --canary:  dry-run + exit 2 on drift (wire shape, fetch death, plan death).
 * --cadence: analyze score_snapshots gaps / transitions (REST vs WS verdict).
 * --verbose: print every polled score line (default: live rows + errors only; always all with --event).
 */
import { parseArgs } from "node:util";
import { syncOpenItfEvents } from "../../src/institutions/event-store/kalshi-itf-sync.ts";
import {
  buildCanaryArtifact,
  writeCanaryArtifact,
} from "../../src/institutions/event-store/live-canary-store.ts";
import {
  analyzeScoreSnapshotCadence,
  evaluateLiveCanary,
  formatLiveScoreLine,
  listLiveEventIds,
  pollLiveScores,
  type LivePollRow,
  type SnapshotCadenceReport,
} from "../../src/institutions/event-store/live-scores.ts";
import { ensureEventStoreDir, openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../../src/institutions/event-store/paths.ts";
import { bridgeStadionToKalshi } from "../../src/institutions/event-store/stadion-kalshi-bridge.ts";
import {
  listWatchEvents,
  listWatchEventsForTickers,
} from "../../src/institutions/event-store/watch-set.ts";
import { formatInspectTable, isTtyStdout } from "../../src/research/terminal-out.ts";

function rowsToShow(rows: LivePollRow[], opts: { verbose: boolean; singleEvent: boolean }): LivePollRow[] {
  if (opts.verbose || opts.singleEvent) return rows;
  return rows.filter((r) => r.isLive || r.error || r.wouldRetire || r.transition === "game" || r.transition === "set");
}

function emitCadence(report: SnapshotCadenceReport, asJson: boolean) {
  if (asJson) {
    // @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
    void Bun.write(Bun.stdout, `${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const t = report.totals;
  console.log(
    `score_snapshots cadence  interval=${report.assumedIntervalMs}ms` +
      ` events=${t.events} snaps=${t.snapshots}` +
      ` transitions: point=${t.pointTransitions} game=${t.gameTransitions} set=${t.setTransitions}` +
      ` rest: miss=${t.restMiss} borderline=${t.restBorderline}`,
  );
  const rows = report.events.slice(0, 20).map((e) => ({
    event: e.eventTicker.slice(0, 40),
    snaps: e.snapshots,
    med_gap: e.medianGapMs == null ? "—" : `${Math.round(e.medianGapMs)}ms`,
    p90: e.p90GapMs == null ? "—" : `${Math.round(e.p90GapMs)}ms`,
    rest: e.restVerdict,
    point: e.transitions.point,
    game: e.transitions.game,
    set: e.transitions.set,
  }));
  if (rows.length && isTtyStdout()) {
    process.stdout.write(
      formatInspectTable(rows, ["event", "snaps", "med_gap", "p90", "rest", "point", "game", "set"]),
    );
  } else {
    for (const e of report.events.slice(0, 20)) {
      const med = e.medianGapMs == null ? "—" : `${Math.round(e.medianGapMs)}ms`;
      console.log(
        `  ${e.eventTicker}  snaps=${e.snapshots}  med_gap=${med}  rest=${e.restVerdict}`,
      );
    }
  }
  if (t.restMiss > 0) {
    console.error(
      `cadence: ${t.restMiss} event(s) miss REST (median gap > 3× interval) — WS writer candidate`,
    );
  }
}

export async function runLiveScoresCli(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      loop: { type: "boolean", default: false },
      sync: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      /** Fail-loud exit codes for scheduled smoke (implies dry-run semantics for writes). */
      canary: { type: "boolean", default: false },
      /** Analyze score_snapshots cadence (no poll unless combined with other flags). */
      cadence: { type: "boolean", default: false },
      /** After --sync, refresh Stadion↔Kalshi event_links (default true). */
      bridge: { type: "boolean", default: true },
      event: { type: "string" },
      lead: { type: "string" },
      top: { type: "string" },
      db: { type: "string" },
      json: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
    },
    strict: false,
  });

  await ensureEventStoreDir();
  const dbPath = typeof values.db === "string" ? values.db : DEFAULT_EVENT_STORE_DB;
  const db = openEventStore({ dbPath });
  const leadMinutes = values.lead ? Number(values.lead) : 5;
  const limit = values.top ? Number(values.top) : 40;
  const intervalMs = Number(Bun.env.TENNIS_LIVE_INTERVAL_MS ?? 10_000);
  const canary = values.canary === true;
  const cadenceOnly = values.cadence === true;
  // Canary is always dry-run at the write boundary (zero write risk).
  const dryRun = values["dry-run"] === true || canary;
  const verbose = values.verbose === true;
  const singleEvent = typeof values.event === "string";

  if (values.sync) {
    if (dryRun) {
      if (!values.json) {
        console.log("Sync: skipped (--dry-run)");
      }
    } else {
      const sync = await syncOpenItfEvents(db);
      const bridge = values.bridge !== false ? bridgeStadionToKalshi(db) : null;
      if (!values.json) {
        console.log(
          `Sync: ${sync.eventsUpserted} events / ${sync.marketsUpserted} markets` +
            (sync.anomalies.length ? `  anomalies=${sync.anomalies.length}` : ""),
        );
        if (bridge) {
          console.log(
            `Bridge: linked=${bridge.linked} unmatched=${bridge.unmatched}` +
              ` ambiguous=${bridge.ambiguous} resolutions+=${bridge.resolutionsPropagated}`,
          );
        }
      }
    }
  }

  const runOnce = async () => {
    const eventTickers =
      typeof values.event === "string" ? [values.event] : undefined;
    const watchList =
      eventTickers ?
        listWatchEventsForTickers(db, eventTickers)
      : listWatchEvents(db, {
          leadMinutes,
          limit,
          clearStale: !dryRun,
        });
    const summary = await pollLiveScores(db, {
      leadMinutes,
      limit,
      eventTickers,
      pauseMs: 150,
      dryRun,
    });
    const liveFromPoll = summary.rows.filter((r) => r.isLive).map((r) => r.eventId);
    const transitions = {
      first: summary.rows.filter((r) => r.transition === "first").length,
      point: summary.rows.filter((r) => r.transition === "point").length,
      game: summary.rows.filter((r) => r.transition === "game").length,
      set: summary.rows.filter((r) => r.transition === "set").length,
      status: summary.rows.filter((r) => r.transition === "status").length,
      server: summary.rows.filter((r) => r.transition === "server").length,
      none: summary.rows.filter((r) => r.transition === "none").length,
    };
    return {
      dryRun,
      watch: watchList.length,
      watchEvents: watchList.map((w) => ({
        eventTicker: w.eventTicker,
        startTs: w.startTs,
        eventId: w.eventId,
        playerA: w.playerA,
        playerB: w.playerB,
        competitors: w.competitors,
      })),
      summary,
      transitions,
      /** Live from this poll (works in dry-run). DB early-start set when not dry-run. */
      liveIds: dryRun ? liveFromPoll : listLiveEventIds(db),
      liveTickers: summary.rows.filter((r) => r.isLive).map((r) => r.eventTicker),
      cadence:
        values.cadence === true
          ? analyzeScoreSnapshotCadence(db, {
              eventTicker: eventTickers?.[0],
              intervalMs,
            })
          : undefined,
    };
  };

  const emit = (payload: Awaited<ReturnType<typeof runOnce>>) => {
    if (values.json) {
      void Bun.write(Bun.stdout, `${JSON.stringify(payload, null, 2)}\n`);
      return;
    }
    const s = payload.summary;
    const prefix = dryRun ? "live_data (dry-run)" : "live_data";
    console.log(
      `${prefix}  watch=${payload.watch} polled=${s.polled} ` +
        `${dryRun ? "would_upsert" : "upserted"}=${s.upserted} ` +
        `${dryRun ? "would_snapshots" : "snapshots"}+=${s.snapshotsAppended} live=${s.live} ` +
        `no_milestone=${s.milestoneMissing} retire=${s.wouldRetire} ` +
        `errors=${s.errors.length}` +
        `  ${s.durationMs}ms x${s.concurrency}` +
        (s.staleLiveCleared ? ` stale_cleared=${s.staleLiveCleared}` : ""),
    );
    const tr = payload.transitions;
    if (tr.first + tr.point + tr.game + tr.set + tr.status + tr.server > 0) {
      console.log(
        `  transitions  first=${tr.first} point=${tr.point} game=${tr.game}` +
          ` set=${tr.set} status=${tr.status} server=${tr.server} none=${tr.none}`,
      );
    }
    for (const e of s.errors.slice(0, 10)) console.log(`  ! ${e}`);
    for (const row of rowsToShow(s.rows, { verbose, singleEvent })) {
      const delta =
        row.transition && row.transition !== "none" && row.transition !== "first"
          ? `  Δ=${row.transition}`
          : row.transition === "first"
            ? "  Δ=first"
            : "";
      console.log(`  ${formatLiveScoreLine(row)}${delta}`);
    }
    if (payload.cadence) emitCadence(payload.cadence, false);
  };

  if (!values.loop) {
    // Exclusive cadence path when only --cadence was requested without poll flags.
    if (cadenceOnly && values["dry-run"] !== true && !canary && values.sync !== true) {
      const report = analyzeScoreSnapshotCadence(db, {
        eventTicker: typeof values.event === "string" ? values.event : undefined,
        intervalMs,
      });
      emitCadence(report, values.json === true);
      return report.totals.restMiss > 0 ? 3 : 0;
    }

    const payload = await runOnce();
    emit(payload);
    if (canary) {
      const verdict = evaluateLiveCanary(payload.summary);
      const art = buildCanaryArtifact({
        summary: payload.summary,
        verdict,
        durationMs: payload.summary.durationMs,
        liveTickers: payload.liveTickers,
      });
      const path = await writeCanaryArtifact(art);
      for (const w of verdict.warnings) {
        console.error(`canary WARN: ${w}`);
      }
      if (!verdict.ok) {
        for (const r of verdict.reasons) {
          console.error(`canary FAIL: ${r}`);
        }
        console.error(`canary artifact: ${path}  fp=${art.fingerprint}`);
        return verdict.exitCode;
      }
      if (!values.json) {
        console.error(
          `canary OK  watch=${payload.summary.watched} polled=${payload.summary.polled}` +
            ` live=${payload.summary.live} would_upsert=${payload.summary.upserted}` +
            ` wire_ok=${payload.summary.rows.every((r) => r.missingDetailKeys.length === 0)}` +
            `  ${payload.summary.durationMs}ms x${payload.summary.concurrency}`,
        );
        console.error(`canary artifact: ${path}  fp=${art.fingerprint}`);
      }
      return 0;
    }
    return 0;
  }

  if (canary) {
    console.error("--canary is one-shot; omit --loop (use OS cron for schedule)");
    return 1;
  }

  console.log(
    `live_data${dryRun ? " (dry-run)" : ""} loop every ${intervalMs}ms (lead=${leadMinutes}m) — Ctrl+C to stop`,
  );
  for (;;) {
    try {
      emit(await runOnce());
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
    }
    await Bun.sleep(intervalMs);
  }
}

if (import.meta.main) {
  process.exit(await runLiveScoresCli(process.argv.slice(2)));
}
