import { describe, expect, test } from "bun:test";
import {
  createSingleFlight,
  INTERVAL_SPORTS_METADATA,
} from "../../scripts/cron-main.ts";

describe("sports metadata cron ownership", () => {
  test("uses a 15-minute cadence and joins overlapping invocations", async () => {
    expect(INTERVAL_SPORTS_METADATA).toBe("*/15 * * * *");
    let calls = 0;
    let release: ((value: number) => void) | undefined;
    const flight = createSingleFlight(async () => {
      calls++;
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    });

    const first = flight.run();
    const overlap = flight.run();
    expect(calls).toBe(1);
    release?.(42);
    expect(await first).toBe(42);
    expect(await overlap).toBe(42);
    await flight.drain();
  });

  test("drain waits for the active owner before shutdown", async () => {
    let release: (() => void) | undefined;
    const flight = createSingleFlight(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    void flight.run();
    let drained = false;
    const drain = flight.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    release?.();
    await drain;
    expect(drained).toBe(true);
  });
});
