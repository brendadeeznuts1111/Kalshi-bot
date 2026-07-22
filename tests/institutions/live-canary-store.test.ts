// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { buildCanaryArtifact, loadLatestCanary } from "../../src/institutions/event-store/live-canary-store.ts";
import { asKalshiEventTicker } from "../../src/institutions/event-store/brands.ts";
import { evaluateLiveCanary } from "../../src/institutions/event-store/live-scores.ts";
import { tempSqlitePath } from "../tmp-db.ts";

describe("live-canary-store", () => {
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
    const art = buildCanaryArtifact({
      summary,
      verdict,
      durationMs: 42,
      liveTickers: [asKalshiEventTicker("KXITFMATCH-26JUL22AAA")],
    });
    expect(art.fingerprint.length).toBeGreaterThan(4);
    expect(art.exitCode).toBe(0);
    expect(art.dryRun).toBe(true);
    expect(art.summary.live).toBe(1);
  });

  test("loadLatestCanary re-brands liveTickers from JSON wire", async () => {
    const latestPath = tempSqlitePath("canary-latest").replace(/\.db$/, ".json");
    try {
      const summary = {
        watched: 1,
        polled: 1,
        upserted: 1,
        snapshotsAppended: 0,
        live: 1,
        milestoneMissing: 0,
        wouldRetire: 0,
        errors: [] as string[],
        dryRun: true as const,
        rows: [] as never[],
        staleLiveCleared: 0,
        durationMs: 10,
        concurrency: 1,
      };
      const art = buildCanaryArtifact({
        summary,
        verdict: evaluateLiveCanary(summary),
        durationMs: 10,
        liveTickers: [asKalshiEventTicker("KXITFMATCH-26JUL22MID")],
      });
      await Bun.write(latestPath, JSON.stringify({ ...art, liveTickers: ["KXITFMATCH-26JUL22MID"] }));
      const loaded = await loadLatestCanary(latestPath);
      expect(loaded?.liveTickers[0]).toBe(asKalshiEventTicker("KXITFMATCH-26JUL22MID"));
    } finally {
      await Bun.$`rm -f ${latestPath}`.nothrow().quiet();
    }
  });
});
