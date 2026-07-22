/** Production-shaped run id for tests that must win `loadLatestRunFromDb` without clobbering real runs. */
export const TEST_LATEST_RUN_ID = "2026-12-31T23-59-59-000Z";

/** Current timestamp — sorts ahead of real runs and passes verify freshness checks. */
export function freshTestGeneratedAt(): string {
  return new Date().toISOString();
}
