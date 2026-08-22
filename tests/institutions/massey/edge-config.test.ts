// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  americanToDecimal,
  decimalToAmerican,
  lineImpliedFromDecimal,
  masseyEdge,
  vigFreeEdge,
} from "../../../src/institutions/massey/edge.ts";
import {
  DEFAULT_MASSEY_CONFIG,
  loadMasseyConfig,
  mergeMasseyConfig,
} from "../../../src/institutions/massey/config.ts";

describe("line odds math", () => {
  test("decimal <-> implied", () => {
    expect(lineImpliedFromDecimal(2.0)).toBeCloseTo(0.5, 6);
    expect(lineImpliedFromDecimal(1.0)).toBeNull();
    expect(lineImpliedFromDecimal(0.5)).toBeNull();
  });

  test("american <-> decimal", () => {
    expect(americanToDecimal(110)).toBeCloseTo(2.1, 6);
    expect(americanToDecimal(-110)).toBeCloseTo(1.90909, 4);
    expect(americanToDecimal(0)).toBeNull();
    expect(decimalToAmerican(2.1)).toBeCloseTo(110, 4);
  });
});

describe("masseyEdge", () => {
  test("positive edge = model prices side stronger than the line", () => {
    const e = masseyEdge(0.6, 2.0); // line implied 0.5, model 0.6
    expect(e).not.toBeNull();
    expect(e!.edge).toBeCloseTo(0.1, 6);
    expect(e!.lineImplied).toBeCloseTo(0.5, 6);
  });

  test("null on bad inputs", () => {
    expect(masseyEdge(null, 2.0)).toBeNull();
    expect(masseyEdge(0.6, 1.0)).toBeNull();
  });
});

describe("vigFreeEdge", () => {
  test("removes the overround before comparing", () => {
    // -110/-110: both implied 0.524 -> vig-free 0.5
    const e = vigFreeEdge(0.55, 1.909, 1.909);
    expect(e).not.toBeNull();
    expect(e!.lineImplied).toBeCloseTo(0.5, 4);
    expect(e!.edge).toBeCloseTo(0.05, 4);
  });
});

describe("massey config", () => {
  test("merge keeps defaults under partial patch", () => {
    const c = mergeMasseyConfig(DEFAULT_MASSEY_CONFIG, { sync: { maxAgeHours: 6 } });
    expect(c.sync.maxAgeHours).toBe(6);
    expect(c.sync.sports).toEqual(DEFAULT_MASSEY_CONFIG.sync.sports);
  });

  test("loadMasseyConfig honors env overrides without a file", () => {
    const c = loadMasseyConfig("/nonexistent.json5", { MASSEY_SYNC_SPORT: "tennis,volleyball" });
    expect(c.sync.sports).toEqual(["tennis", "volleyball"]);
  });
});
