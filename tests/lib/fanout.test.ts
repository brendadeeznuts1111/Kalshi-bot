import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createFanout, type FanoutMessage } from "../../src/lib/fanout.ts";

const CHANNEL = "kalshi-bot:bun-release";

describe("fan-out bus (BroadcastChannel)", () => {
  test("post() reaches handlers in the same process (two-instance internals)", () => {
    const bus = createFanout<FanoutMessage>(CHANNEL + ":a");
    const got: string[] = [];
    const off = bus.onMessage((m) => got.push(String(m.version)));
    bus.post({ type: "bun-release", version: "1.4" });
    // same-process delivery is async (channel event)
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(got).toEqual(["1.4"]);
        off();
        bus.close();
        resolve(undefined);
      }, 20);
    });
  });

  test("multiple handlers all receive; unregister stops one", async () => {
    // BroadcastChannel delivery is ASYNC: post() then immediate unregister
    // means the unregister wins (the first message never sees the handler).
    // Await delivery between steps so the unregister is observable.
    const bus = createFanout<FanoutMessage>(CHANNEL + ":b");
    const a: string[] = [];
    const b: string[] = [];
    const offA = bus.onMessage(() => a.push("a"));
    bus.onMessage(() => b.push("b"));
    bus.post({ type: "t1" });
    await Bun.sleep(20); // t1 delivered to both
    offA();
    bus.post({ type: "t2" });
    await Bun.sleep(20); // t2 delivered to b only
    expect(a).toEqual(["a"]);
    expect(b).toEqual(["b", "b"]);
    bus.close();
  });

  test("messages cross Worker threads (worker posts -> main handler)", async () => {
    const bus = createFanout<FanoutMessage>(CHANNEL);
    const got: FanoutMessage[] = [];
    bus.onMessage((m) => got.push(m));
    const w = new Worker(new URL("./fanout-worker.fixture.ts", import.meta.url));
    await Bun.sleep(150);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ type: "bun-release", version: "9.9" });
    bus.close();
    w.terminate();
  }, 5_000);
});
