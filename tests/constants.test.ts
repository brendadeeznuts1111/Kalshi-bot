// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  COMPONENT_WEIGHTS,
  DETECTOR_ID_LIST,
  DETECTOR_IDS,
  DRY_RUN_MARKERS,
  isPreferredLicense,
  isUnlicensedSpdx,
  LICENSE_MIT,
  PREFERRED_LICENSES,
} from "../src/research/constants.ts";

describe("constants", () => {
  test("DETECTOR_ID_LIST length matches COMPONENT_WEIGHTS", () => {
    expect(DETECTOR_ID_LIST.length).toBe(6);
    expect(Object.keys(COMPONENT_WEIGHTS).length).toBe(DETECTOR_ID_LIST.length);
  });

  test("DETECTOR_ID_LIST matches DETECTOR_IDS values", () => {
    expect(DETECTOR_ID_LIST).toHaveLength(6);
    expect(DETECTOR_ID_LIST).toContain(DETECTOR_IDS.authApi);
    expect(DETECTOR_ID_LIST).toContain(DETECTOR_IDS.orderRealism);
  });

  test("COMPONENT_WEIGHTS sum to 100", () => {
    const sum = Object.values(COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
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
});
