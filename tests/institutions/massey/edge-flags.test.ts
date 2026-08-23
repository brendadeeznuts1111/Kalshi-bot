import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  computeEdgeFlags,
  formatEdgeFlagsJson,
  formatEdgeFlagsMarkdown,
  type PricedBookEvent,
} from "../../../src/institutions/massey/edge-flags.ts";
import type { MasseyRatingRow } from "../../../src/institutions/massey/parse.ts";

const META = { sport: "tennis", thresholdPct: 0.05, generatedAt: "2026-01-01T00:00:00.000Z" };

function index(rows: MasseyRatingRow[]): Map<string, MasseyRatingRow[]> {
  return new Map([["tennis/atp", rows]]);
}

const ATP: MasseyRatingRow[] = [
  { team: "Novak Djokovic", ew: 0.7, el: 0.3, wins: 10, losses: 0 },
  { team: "Carlos Alcaraz", ew: 0.45, el: 0.55, wins: 5, losses: 5 },
] as MasseyRatingRow[];

function ev(home: string, away: string, homeDecimal: number | null, awayDecimal: number | null): PricedBookEvent {
  return {
    league: "ATP Tour",
    home,
    away,
    competitionId: "tennis.atp",
    homeDecimal,
    awayDecimal,
    asOf: 1_700_000_000_000,
  };
}

describe("computeEdgeFlags (Massey vs live book odds)", () => {
  test("flags the side whose implied edge clears the threshold", () => {
    // Djokovic massey 0.70 @ home 1.30 → line 0.769 → edge -6.9pp;
    // Alcaraz massey 0.45 @ away 3.10 → line 0.323 → edge +12.7pp.
    // The engine flags the MAX |edge| side (away).
    const flags = computeEdgeFlags(
      [ev("Novak Djokovic", "Carlos Alcaraz", 1.30, 3.10)],
      index(ATP),
      { thresholdPct: 0.05 },
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]!.side).toBe("away");
    expect(flags[0]!.maxEdgePct).toBeCloseTo(12.7, 1);
    expect(flags[0]!.awaySide!.lineProb).toBeCloseTo(1 / 3.1, 4);
  });

  test("positive edge flags the away side", () => {
    // Alcaraz massey 0.45 vs away price 1.60 → line 0.625 → edge -17.5pp
    // Djokovic home 1.45 → line 0.690 → edge +1.0pp (under threshold).
    const flags = computeEdgeFlags(
      [ev("Novak Djokovic", "Carlos Alcaraz", 1.45, 1.60)],
      index(ATP),
      { thresholdPct: 0.05 },
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]!.side).toBe("away");
    expect(flags[0]!.awaySide!.edgePct).toBeCloseTo(-17.5, 1);
  });

  test("threshold boundary: at threshold flags, below does not", () => {
    // Away price 2.2222 → line 0.45 → away edge 0 (isolates the home side).
    const awayNeutral = 1.0 / 0.45;
    // Home line 0.649 → edge +5.1pp → just above threshold → flagged.
    const at = computeEdgeFlags(
      [ev("Novak Djokovic", "Carlos Alcaraz", 1.0 / 0.649, awayNeutral)],
      index(ATP),
      { thresholdPct: 0.05 },
    );
    expect(at).toHaveLength(1);
    expect(at[0]!.side).toBe("home");
    expect(at[0]!.maxEdgePct).toBeCloseTo(5.1, 1);
    // Home line 0.66 → edge +4.0pp → clearly below threshold → no flags.
    const below = computeEdgeFlags(
      [ev("Novak Djokovic", "Carlos Alcaraz", 1.0 / 0.66, awayNeutral)],
      index(ATP),
      { thresholdPct: 0.05 },
    );
    expect(below).toHaveLength(0);
  });

  test("unpriced or unmatched events are skipped", () => {
    const flags = computeEdgeFlags(
      [
        ev("Novak Djokovic", "Carlos Alcaraz", null, 2.0), // no home price
        ev("Nobody Here", "Also Nobody", 1.5, 2.0), // unmatched
      ],
      index(ATP),
    );
    expect(flags).toHaveLength(0);
  });

  test("results sort by |edge| desc", () => {
    const flags = computeEdgeFlags(
      [
        ev("Novak Djokovic", "Carlos Alcaraz", 1.10, 3.10), // edge -20.9pp
        ev("Novak Djokovic", "Carlos Alcaraz", 1.30, 3.10), // edge -6.9pp
      ],
      index(ATP),
    );
    expect(flags[0]!.maxEdgePct).toBeLessThan(flags[1]!.maxEdgePct);
  });
});

describe("edge flag artifacts", () => {
  test("json carries kind/schema/count", () => {
    const flags = computeEdgeFlags(
      [ev("Novak Djokovic", "Carlos Alcaraz", 1.30, 3.10)],
      index(ATP),
    );
    const parsed = JSON.parse(formatEdgeFlagsJson(flags, META)) as { kind: string; count: number; flags: unknown[] };
    expect(parsed.kind).toBe("massey-edge-flags");
    expect(parsed.count).toBe(1);
    expect(parsed.flags).toHaveLength(1);
  });

  test("markdown renders a table row per flag", () => {
    const flags = computeEdgeFlags(
      [ev("Novak Djokovic", "Carlos Alcaraz", 1.30, 3.10)],
      index(ATP),
    );
    const md = formatEdgeFlagsMarkdown(flags, META);
    expect(md).toContain("# Massey edge flags — tennis");
    expect(md).toContain("Novak Djokovic");
    expect(md).toContain("12.7|away");
    expect(md).toContain("threshold |edge| ≥ 5.0%");
  });
});
