// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { buildCanaryArtifact } from "../../src/institutions/event-store/live-canary-store.ts";
import { evaluateLiveCanary } from "../../src/institutions/event-store/live-scores.ts";

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
    const art = buildCanaryArtifact({ summary, verdict, durationMs: 42, liveTickers: ["KX"] });
    expect(art.fingerprint.length).toBeGreaterThan(4);
    expect(art.exitCode).toBe(0);
    expect(art.dryRun).toBe(true);
    expect(art.summary.live).toBe(1);
  });
});
