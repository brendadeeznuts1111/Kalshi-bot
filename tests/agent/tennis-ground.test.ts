// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { parseAgentCommand } from "../../src/agent/cli.ts";
import {
  buildTennisNextActions,
  formatTennisGround,
  runTennisGround,
} from "../../src/agent/tennis-ground.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { tempSqlitePath, unlinkSqlite } from "../tmp-db.ts";

describe("tennis-ground", () => {
  test("parseAgentCommand recognizes tennis", () => {
    expect(parseAgentCommand(["tennis"]).command).toBe("tennis");
    expect(parseAgentCommand(["tennis", "--", "--canary"]).rest).toEqual(["--canary"]);
    expect(parseAgentCommand(["tennis", "--webview"]).rest).toEqual(["--webview"]);
  });

  test("buildTennisNextActions recommends canary when missing", () => {
    const report = {
      source: "event-store" as const,
      dbPath: ":memory:",
      at: new Date().toISOString(),
      store: {
        events: 10,
        markets: 20,
        liveScores: 0,
        scoreSnapshots: 0,
        bookTicks: 0,
        watchSize: 3,
        liveNow: 0,
      },
      canary: null,
      wsGround: null,
      wsSession: null,
      wsSessionHistory: [],
      wsRecorderTrend: {
        sessions: 0,
        totalGaps: 0,
        totalDeltas: 0,
        totalResyncs: 0,
        gapSessionPct: null,
      },
      bookCoverage: {
        watchEvents: 0,
        watchTickers: 3,
        watchWithWs: 0,
        watchWithRest: 0,
        watchWithBoth: 0,
        watchWithNeither: 3,
        wsTicksTotal: 0,
        restTicksTotal: 0,
        wsExchangeClockTicks: 0,
        wsExchangeClockPct: null,
        linkedEventsWithWs: 0,
        linkedEventsTotal: 0,
      },
      cadence: {
        assumedIntervalMs: 10_000,
        events: [],
        totals: {
          events: 0,
          snapshots: 0,
          gameTransitions: 0,
          setTransitions: 0,
          pointTransitions: 0,
          restMiss: 0,
          restBorderline: 0,
        },
      },
    };
    const actions = buildTennisNextActions(report);
    expect(actions.some((a) => a.includes("tennis:live:canary"))).toBe(true);
    expect(actions.some((a) => a.includes("tennis:ws-ground"))).toBe(true);
    expect(actions.some((a) => a.includes("tennis:live -- --sync --loop"))).toBe(true);
  });

  test("runTennisGround over empty store", async () => {
    const dbPath = tempSqlitePath("tennis-ground");
    try {
      openEventStore({ dbPath });
      const report = await runTennisGround({ dbPath });
      expect(report.source).toBe("event-store");
      expect(report.store.events).toBe(0);
      expect(report.store.watchSize).toBe(0);
      expect(report.nextActions.length).toBeGreaterThan(0);
      const text = formatTennisGround(report);
      expect(text).toContain("Kalshi agent tennis");
      expect(text).toContain("Next actions");
    } finally {
      unlinkSqlite(dbPath);
    }
  });
});
