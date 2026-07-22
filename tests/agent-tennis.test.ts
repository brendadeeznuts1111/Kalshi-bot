// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { parseAgentCommand } from "../src/agent/cli.ts";
import {
  buildTennisNextActions,
  formatTennisGround,
  runTennisGround,
} from "../src/agent/tennis-ground.ts";
import { buildCanaryArtifact } from "../src/institutions/event-store/live-canary-store.ts";
import { evaluateLiveCanary } from "../src/institutions/event-store/live-scores.ts";
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { joinPath } from "../src/research/paths.ts";

describe("agent tennis", () => {
  test("parseAgentCommand recognizes tennis", () => {
    expect(parseAgentCommand(["tennis"]).command).toBe("tennis");
    expect(parseAgentCommand(["tennis", "--", "--canary"]).rest).toEqual(["--canary"]);
  });

  test("buildCanaryArtifact fingerprints dry-run summary", () => {
    const summary = {
      watched: 2,
      polled: 2,
      upserted: 2,
      snapshotsAppended: 1,
      live: 1,
      milestoneMissing: 0,
      wouldRetire: 0,
      errors: [] as string[],
      dryRun: true as const,
      rows: [] as never[],
      staleLiveCleared: 0,
      durationMs: 42,
      concurrency: 4,
    };
    const verdict = evaluateLiveCanary(summary);
    const art = buildCanaryArtifact({ summary, verdict, durationMs: 42, liveTickers: ["KX"] });
    expect(art.fingerprint.length).toBeGreaterThan(4);
    expect(art.exitCode).toBe(0);
    expect(art.dryRun).toBe(true);
    expect(art.summary.live).toBe(1);
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
    expect(actions.some((a) => a.includes("tennis:live -- --sync --loop"))).toBe(true);
  });

  test("runTennisGround over empty store", async () => {
    const dbPath = joinPath(import.meta.dir, `.tmp-tennis-ground-${Date.now()}.db`);
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
      await Bun.$`rm -f ${dbPath} ${dbPath}-wal ${dbPath}-shm`.nothrow().quiet();
    }
  });
});
