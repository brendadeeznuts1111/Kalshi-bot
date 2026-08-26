// ConsensusTracker: emits merge/split shifts across consecutive snapshots (§193).
import { describe, expect, test } from "bun:test";
import { ConsensusTracker } from "../../src/alpha/cluster/tracker.ts";
import type { OddsPrint } from "../../src/alpha/cluster/odds-vector.ts";

function printsAt(implieds: number[], ts: number): OddsPrint[] {
  return implieds.map((imp, i) => ({
    id: "p" + i, source: "s" + (i % 3), eventId: "e" + i, side: "yes",
    implied: imp, vig: 0.04, ts,
  }));
}

describe("ConsensusTracker", () => {
  test("first push emits no shifts; a later merge emits a merge shift", () => {
    const t = new ConsensusTracker();
    const s1 = t.push(printsAt([0.30, 0.31, 0.32, 0.33, 0.70, 0.71, 0.72, 0.73], 1000), 1000);
    expect(s1.shifts).toEqual([]);
    const s2 = t.push(printsAt([0.48, 0.49, 0.50, 0.51, 0.52, 0.53, 0.54, 0.55], 2000), 2000);
    expect(s2.shifts.length).toBeGreaterThan(0);
    expect(s2.shifts.some((x) => x.kind === "merge")).toBe(true);
  });

  test("stable snapshots emit no shifts", () => {
    const t = new ConsensusTracker();
    t.push(printsAt([0.30, 0.31, 0.32, 0.33, 0.70, 0.71, 0.72, 0.73], 1000), 1000);
    const s2 = t.push(printsAt([0.30, 0.31, 0.32, 0.33, 0.70, 0.71, 0.72, 0.73], 2000), 2000);
    expect(s2.shifts).toEqual([]);
  });

  test("reset clears history", () => {
    const t = new ConsensusTracker();
    t.push(printsAt([0.3, 0.7], 1000), 1000);
    t.reset();
    const s = t.push(printsAt([0.3, 0.7], 3000), 3000);
    expect(s.shifts).toEqual([]);
  });
});