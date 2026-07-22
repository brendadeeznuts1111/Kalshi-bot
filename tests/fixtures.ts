/**
 * Mint a production-shaped run id near `now` (eligible for loadLatest* resolution).
 * Only use inside `withTempCache` / `enterTempCache`. Always set `source: "test"`
 * (or `kind: "fixture"`) unless the test intentionally exercises production resolution —
 * then use `source: "pipeline"` and avoid the harness mock shape
 * (`description: "test"` + `stars: 100`), which {@link looksLikeSyntheticFixtureRun} rejects.
 */
export function mintTestProductionRunId(now = Date.now()): string {
  const d = new Date(now);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}` +
    `-${pad(d.getUTCMilliseconds(), 3)}Z`
  );
}

/**
 * Production-shaped run id for tests that must win `loadLatestRunFromDb`.
 * Minted at import — near `now` so {@link isEligibleProductionRun} accepts it.
 */
export const TEST_LATEST_RUN_ID = mintTestProductionRunId();

/** Current timestamp — sorts ahead of older real runs and passes verify freshness checks. */
export function freshTestGeneratedAt(): string {
  return new Date().toISOString();
}
