// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  formatDiscoverGateNote,
  gatesDiffer,
  resolveDiscoverGate,
  resolveGates,
} from "../src/research/discover-gate.ts";
import { buildRepoSearchQuery } from "../src/research/discover.ts";

describe("discover-gate", () => {
  const strict = { minStars: 100, minForks: 100, maxAgeMonths: 18 };

  test("auto-broadens discover when apply gate has popularity thresholds", () => {
    const discover = resolveDiscoverGate(strict);
    expect(discover.minStars).toBe(0);
    expect(discover.minForks).toBe(0);
    expect(discover.maxAgeMonths).toBe(18);
    expect(buildRepoSearchQuery("kalshi nba", discover)).not.toContain("stars:>=100");
  });

  test("explicit discover-min-stars restores search pre-filter", () => {
    const discover = resolveDiscoverGate(strict, { discoverMinStars: 100 });
    expect(buildRepoSearchQuery("kalshi", discover)).toContain("stars:>=100");
  });

  test("discover-broad forces zero popularity qualifiers", () => {
    const { discover } = resolveGates({ minStars: 5, minForks: 3, maxAgeMonths: 12 }, { discoverBroad: true });
    expect(discover.minStars).toBe(0);
    expect(discover.minForks).toBe(0);
  });

  test("gatesDiffer detects split gates", () => {
    expect(gatesDiffer(strict, { minStars: 0, minForks: 0, maxAgeMonths: 18 })).toBe(true);
    expect(formatDiscoverGateNote(strict, { minStars: 0, minForks: 0, maxAgeMonths: 18 })).toContain(
      "Discovery search uses relaxed gate",
    );
  });

  test("zero apply gate leaves discover unchanged", () => {
    const loose = { minStars: 0, minForks: 0, maxAgeMonths: 24 };
    expect(resolveDiscoverGate(loose)).toEqual(loose);
  });
});
