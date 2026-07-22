// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  AUTH_SCORE_SHARES,
  COMPONENT_WEIGHTS,
  DEFAULT_GATE,
  DEFAULT_MAX_PER_TAG,
  DEFAULT_SHORTLIST_SIZE,
  DEFAULT_STACK_TIEBREAK_THRESHOLD,
  DETECTOR_ID_LIST,
  DETECTOR_IDS,
  DOCS_SCORE_SHARES,
  DRY_RUN_MARKERS,
  isPreferredLicense,
  isUnlicensedSpdx,
  LICENSE_MIT,
  LICENSE_WEIGHTS,
  MAX_QUALITY_SCORE,
  ORDER_SCORE_SHARES,
  PREFERRED_LICENSES,
  SCORE_COMPONENTS,
  TESTS_CI_SCORE_SHARES,
} from "../src/research/constants.ts";
import { RESEARCH_ROOT, joinPath } from "../src/research/paths.ts";

describe("constants", () => {
  test("DETECTOR_ID_LIST matches DETECTOR_IDS values", () => {
    expect(DETECTOR_ID_LIST).toHaveLength(7);
    expect(DETECTOR_ID_LIST).toContain(DETECTOR_IDS.authApi);
    expect(DETECTOR_ID_LIST).toContain(DETECTOR_IDS.orderRealism);
    expect(DETECTOR_ID_LIST).toContain(DETECTOR_IDS.feeAware);
  });

  test("SCORE_COMPONENTS align with COMPONENT_WEIGHTS keys", () => {
    expect(SCORE_COMPONENTS).toHaveLength(6);
    for (const key of SCORE_COMPONENTS) {
      expect(key in COMPONENT_WEIGHTS).toBe(true);
    }
  });

  test("COMPONENT_WEIGHTS sum to MAX_QUALITY_SCORE", () => {
    const sum = Object.values(COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(MAX_QUALITY_SCORE);
  });

  test("score share buckets sum to 1", () => {
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(sum(AUTH_SCORE_SHARES)).toBeCloseTo(1);
    expect(sum(ORDER_SCORE_SHARES)).toBeCloseTo(1);
    expect(sum(TESTS_CI_SCORE_SHARES)).toBeCloseTo(1);
    expect(sum(DOCS_SCORE_SHARES)).toBeCloseTo(1);
  });

  test("isPreferredLicense recognises MIT", () => {
    expect(isPreferredLicense(LICENSE_MIT)).toBe(true);
    expect(PREFERRED_LICENSES).toContain(LICENSE_MIT);
  });

  test("isUnlicensedSpdx flags empty and noassertion", () => {
    expect(isUnlicensedSpdx("")).toBe(true);
    expect(isUnlicensedSpdx("noassertion")).toBe(true);
    expect(isUnlicensedSpdx(LICENSE_MIT)).toBe(false);
  });

  test("DRY_RUN_MARKERS is non-empty", () => {
    expect(DRY_RUN_MARKERS.length).toBeGreaterThan(0);
  });

  test("defaults align with research/weights.json", async () => {
    const weights = await Bun.file(joinPath(RESEARCH_ROOT, "weights.json")).json() as {
      shortlistSize: number;
      maxPerTag: number;
      stackTiebreakThreshold: number;
      gate: { minStars: number; minForks: number; maxAgeMonths: number };
      components: Record<string, number>;
      license: { unlicensedPenalty: number; nonPreferredPenalty: number; preferredLicenses: string[] };
    };

    expect(weights.shortlistSize).toBe(DEFAULT_SHORTLIST_SIZE);
    expect(weights.maxPerTag).toBe(DEFAULT_MAX_PER_TAG);
    expect(weights.stackTiebreakThreshold).toBe(DEFAULT_STACK_TIEBREAK_THRESHOLD);
    expect(weights.gate).toEqual({ ...DEFAULT_GATE });
    expect(weights.components).toEqual({ ...COMPONENT_WEIGHTS });
    expect(weights.license.unlicensedPenalty).toBe(LICENSE_WEIGHTS.unlicensedPenalty);
    expect(weights.license.nonPreferredPenalty).toBe(LICENSE_WEIGHTS.nonPreferredPenalty);
    expect(weights.license.preferredLicenses).toEqual([...PREFERRED_LICENSES]);
  });
});
