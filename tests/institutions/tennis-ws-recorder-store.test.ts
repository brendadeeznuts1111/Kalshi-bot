// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  loadTennisWsRecorderHistory,
  persistTennisWsRecorderSession,
  summarizeTennisWsRecorderTrend,
} from "../../src/institutions/event-store/tennis-ws-recorder-store.ts";
import { tempSqlitePath } from "../tmp-db.ts";

describe("tennis-ws-recorder-store", () => {
  test("persist appends history and summarizeTennisWsRecorderTrend aggregates gaps", async () => {
    const base = tempSqlitePath("tennis-ws-recorder").replace(/\.db$/, "");
    const latestPath = `${base}-latest.json`;
    const historyPath = `${base}-history.jsonl`;

    await persistTennisWsRecorderSession(
      {
        ticksRecorded: 10,
        snapshots: 8,
        deltas: 2,
        seqGaps: 0,
        duplicates: 0,
        errors: 0,
        subscribed: 4,
        resyncRequests: 0,
      },
      { durationMs: 15_000, subscribedTickers: 4, at: "2026-07-22T12:00:00.000Z" },
      { latest: latestPath, history: historyPath },
    );
    await persistTennisWsRecorderSession(
      {
        ticksRecorded: 20,
        snapshots: 16,
        deltas: 4,
        seqGaps: 3,
        duplicates: 1,
        errors: 0,
        subscribed: 8,
        resyncRequests: 2,
      },
      { durationMs: 30_000, subscribedTickers: 8, at: "2026-07-22T12:05:00.000Z" },
      { latest: latestPath, history: historyPath },
    );

    const history = await loadTennisWsRecorderHistory(10, historyPath);
    expect(history.length).toBe(2);
    expect(history[1]!.fingerprint.length).toBeGreaterThan(4);

    const trend = summarizeTennisWsRecorderTrend(history);
    expect(trend.sessions).toBe(2);
    expect(trend.totalGaps).toBe(3);
    expect(trend.totalDeltas).toBe(6);
    expect(trend.gapSessionPct).toBe(50);

    await Bun.$`rm -f ${latestPath} ${historyPath}`.nothrow().quiet();
  });
});
