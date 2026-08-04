// @see https://bun.com/docs/runtime/file-io
/**
 * Pure helpers for event-store → match_liquidity ground db-watch.
 * CLI: tools/match-liquidity-db-watch.ts
 */

/** Basename of SQLite main db or its -wal / -shm sidecars. */
export function isEventStoreWatchFilename(
  filename: string | null | undefined,
  dbBasename: string,
): boolean {
  if (!filename) return true; // some platforms omit filename — treat as fire
  if (filename === dbBasename) return true;
  if (filename === `${dbBasename}-wal`) return true;
  if (filename === `${dbBasename}-shm`) return true;
  // Rare: rename temp files during checkpoint
  if (filename.startsWith(dbBasename) && /\.(db|sqlite)(-wal|-shm)?$/i.test(filename)) {
    return true;
  }
  return false;
}

export type DebounceScheduler = {
  schedule: (reason: string) => void;
  /** Flush pending timer immediately (tests). */
  flush: () => void;
  /** Cancel without firing. */
  cancel: () => void;
  /** Whether a rebuild is in flight or queued. */
  busy: () => boolean;
};

/**
 * Debounced serial runner: coalesces bursts (SQLite WAL multi-file writes)
 * and re-runs once if a fire arrives while the previous rebuild is still going.
 */
export function createDebounceScheduler(
  run: (reason: string) => void | Promise<void>,
  debounceMs: number,
  timers: {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
  } = { setTimeout, clearTimeout },
): DebounceScheduler {
  const ms = Math.max(0, debounceMs);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pendingReason: string | null = null;

  async function execute(reason: string): Promise<void> {
    if (running) {
      pendingReason = reason;
      return;
    }
    running = true;
    try {
      await run(reason);
    } finally {
      running = false;
      if (pendingReason !== null) {
        const next = pendingReason;
        pendingReason = null;
        void execute(next);
      }
    }
  }

  function schedule(reason: string): void {
    if (timer) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      void execute(reason);
    }, ms);
  }

  return {
    schedule,
    flush: () => {
      if (timer) {
        timers.clearTimeout(timer);
        timer = null;
      }
      void execute("flush");
    },
    cancel: () => {
      if (timer) {
        timers.clearTimeout(timer);
        timer = null;
      }
      pendingReason = null;
    },
    busy: () => running || pendingReason !== null || timer !== null,
  };
}
