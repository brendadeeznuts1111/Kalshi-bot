// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  createDebounceScheduler,
  isEventStoreWatchFilename,
} from "../../src/institutions/event-store/match-liquidity-db-watch.ts";
import { parseMatchLiquidityDbWatchCli } from "../../tools/match-liquidity-db-watch.ts";

describe("isEventStoreWatchFilename", () => {
  const base = "event-store.db";

  test("matches main db and wal/shm sidecars", () => {
    expect(isEventStoreWatchFilename("event-store.db", base)).toBe(true);
    expect(isEventStoreWatchFilename("event-store.db-wal", base)).toBe(true);
    expect(isEventStoreWatchFilename("event-store.db-shm", base)).toBe(true);
  });

  test("ignores unrelated files in the same cache dir", () => {
    expect(isEventStoreWatchFilename("cache.db", base)).toBe(false);
    expect(isEventStoreWatchFilename("hq-store.db-wal", base)).toBe(false);
    expect(isEventStoreWatchFilename("match-liquidity-ground.html", base)).toBe(false);
  });

  test("null/empty filename is a fire (platform-dependent fs.watch)", () => {
    expect(isEventStoreWatchFilename(null, base)).toBe(true);
    expect(isEventStoreWatchFilename(undefined, base)).toBe(true);
    expect(isEventStoreWatchFilename("", base)).toBe(true);
  });
});

describe("createDebounceScheduler", () => {
  test("coalesces multiple schedules into one run after debounce", async () => {
    const runs: string[] = [];
    const pending: Array<() => void> = [];
    const scheduler = createDebounceScheduler(
      (reason) => {
        runs.push(reason);
      },
      50,
      {
        setTimeout: ((fn: () => void) => {
          pending.push(fn);
          return pending.length as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout,
        clearTimeout: ((id: ReturnType<typeof setTimeout>) => {
          const i = (id as unknown as number) - 1;
          if (i >= 0 && i < pending.length) pending[i] = () => {};
        }) as typeof clearTimeout,
      },
    );

    scheduler.schedule("a");
    scheduler.schedule("b");
    scheduler.schedule("c");
    expect(runs).toEqual([]);
    // last scheduled timer is the live one (index 2)
    pending[2]!();
    await Promise.resolve();
    expect(runs).toEqual(["c"]);
  });

  test("queues a second run when schedule arrives while busy", async () => {
    const runs: string[] = [];
    let unlock!: () => void;
    const blocked = new Promise<void>((r) => {
      unlock = r;
    });

    const scheduler = createDebounceScheduler(async (reason) => {
      runs.push(`start:${reason}`);
      if (reason === "first") await blocked;
      runs.push(`end:${reason}`);
    }, 0);

    scheduler.schedule("first");
    await Bun.sleep(5);
    expect(runs).toContain("start:first");
    expect(runs).not.toContain("end:first");

    scheduler.schedule("second");
    unlock();
    await Bun.sleep(20);
    expect(runs).toEqual(["start:first", "end:first", "start:second", "end:second"]);
  });
});

describe("parseMatchLiquidityDbWatchCli", () => {
  test("defaults and flags", () => {
    const d = parseMatchLiquidityDbWatchCli([]);
    expect(d.debounceMs).toBe(750);
    expect(d.fetchVolume).toBe(false);
    expect(d.once).toBe(false);
    expect(d.dbPath).toContain("event-store.db");

    const o = parseMatchLiquidityDbWatchCli([
      "--debounce=200",
      "--fetch-volume",
      "--once",
      "--db=/tmp/x.db",
    ]);
    expect(o.debounceMs).toBe(200);
    expect(o.fetchVolume).toBe(true);
    expect(o.once).toBe(true);
    expect(o.dbPath).toBe("/tmp/x.db");
  });

  test("clamps debounce floor at 100ms", () => {
    expect(parseMatchLiquidityDbWatchCli(["--debounce=1"]).debounceMs).toBe(100);
  });
});
