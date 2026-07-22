/**
 * Pipeline SSOT for magic strings and default thresholds.
 * Runtime config in research/weights.json should stay aligned with these defaults.
 */

/** Normalized SPDX ids (lowercase). */
export const LICENSE_MIT = "mit";
export const LICENSE_APACHE_2_0 = "apache-2.0";
export const LICENSE_BSD_2_CLAUSE = "bsd-2-clause";
export const LICENSE_BSD_3_CLAUSE = "bsd-3-clause";
export const LICENSE_ISC = "isc";

export const PREFERRED_LICENSES = [
  LICENSE_MIT,
  LICENSE_APACHE_2_0,
  LICENSE_BSD_2_CLAUSE,
  LICENSE_BSD_3_CLAUSE,
  LICENSE_ISC,
] as const;

export type PreferredLicense = (typeof PREFERRED_LICENSES)[number];

/** Wire values that mean “no usable OSS license”. */
export const UNLICENSED_SPDX_MARKERS = ["noassertion", "unlicense"] as const;

export const DETECTOR_IDS = {
  authApi: "auth-api",
  orderRealism: "order-realism",
  testsCi: "tests-ci",
  docsSetup: "docs-setup",
  maintenance: "maintenance",
  riskControls: "risk-controls",
} as const;

export type DetectorId = (typeof DETECTOR_IDS)[keyof typeof DETECTOR_IDS];

export const DETECTOR_ID_LIST: readonly DetectorId[] = Object.values(DETECTOR_IDS);

/** Default max points per score component (mirrors research/weights.json components). */
export const COMPONENT_WEIGHTS = {
  authApi: 25,
  orderRealism: 25,
  testsCi: 15,
  docsSetup: 15,
  maintenance: 10,
  riskControls: 10,
} as const;

export const LICENSE_WEIGHTS = {
  unlicensedPenalty: 15,
  nonPreferredPenalty: 3,
} as const;

export const DEFAULT_SHORTLIST_SIZE = 12;
export const DEFAULT_MAX_PER_TAG = 4;
export const DEFAULT_STACK_TIEBREAK_THRESHOLD = 5;

export const DEFAULT_GATE = {
  minStars: 5,
  minForks: 3,
  maxAgeMonths: 18,
} as const;

/** Substrings that indicate dry-run / paper default (positive order-realism signal). */
export const DRY_RUN_MARKERS = [
  "dry-run",
  "dry_run",
  "paper_trading",
  "live_trading_enabled=false",
] as const;

/** When true, `hasDryRunDefault` contributes positively to order-realism scoring. */
export const DRY_RUN_DEFAULT_IS_POSITIVE = true;

export const HIGH_VALUE_MIN_TOTAL_SCORE = 70;
export const HIGH_VALUE_MIN_COMPONENT_POINTS = 15;

export const MAX_QUALITY_SCORE = 100;

export function isPreferredLicense(normalized: string): normalized is PreferredLicense {
  return (PREFERRED_LICENSES as readonly string[]).includes(normalized);
}

export function isUnlicensedSpdx(normalized: string): boolean {
  if (!normalized) return true;
  return (UNLICENSED_SPDX_MARKERS as readonly string[]).includes(normalized);
}
