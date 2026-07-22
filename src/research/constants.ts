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

/** Score component keys (mirrors ScoreBreakdown / weights.components). */
export const SCORE_COMPONENTS = [
  "authApi",
  "orderRealism",
  "testsCi",
  "docsSetup",
  "maintenance",
  "riskControls",
] as const;

export type ScoreComponentKey = (typeof SCORE_COMPONENTS)[number];

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

export const MS_PER_DAY = 86_400_000;

/** Inspect pool concurrency in CLI. */
export const DEFAULT_INSPECT_CONCURRENCY = 4;

/** `gh search repos --limit`. */
export const DEFAULT_GH_SEARCH_LIMIT = 30;

/** Default retries for `ghJson`. */
export const DEFAULT_GH_RETRIES = 3;

/** Fallback strategy tag when none match keywords. */
export const DEFAULT_STRATEGY_TAG = "news_event";

export const SDK_ONLY_TAG = "sdk_only";
export const UNTAGGED_BUCKET = "_untagged";

/** Audit concept id for shortlist diversity export. */
export const AUDIT_CONCEPT_SHORTLIST_ID = "kalshi-shortlist-diversity";

/** Rotor audit graph links for high-value finding exports. */
export const AUDIT_RELATED_CONCEPT_IDS = [
  AUDIT_CONCEPT_SHORTLIST_ID,
  "sha3-integrity",
  "nagata-map",
] as const;

/** Curated bun-docs token for evidence integrity (rotor relatedDocs verify). */
export const AUDIT_EVIDENCE_RELATED_DOC = "SHA3-256";

/** Detection markers (code search / readme aggregate). */
export const SDK_MARKERS = [
  "kalshi-python",
  "kalshi-typescript",
  "@kalshi/kalshi-js",
  "kalshi_api",
  "from kalshi",
  "import kalshi",
] as const;

export const AUTH_MARKERS = ["KALSHI-ACCESS-KEY", "KALSHI-ACCESS-SIGNATURE"] as const;

export const ORDER_MARKERS = [
  "create_order",
  "CreateOrder",
  "place_order",
  "PlaceOrder",
  "/orders",
] as const;

export const V2_API_MARKER = "trade-api/v2";
export const PORTFOLIO_ORDERS_MARKER = "portfolio/orders";
export const RSA_PSS_MARKERS = ["rsa-pss", "rsassa-pss"] as const;

/** README length thresholds (chars). */
export const README_SCORE_LONG_CHARS = 800;
export const README_DOCS_MATCH_CHARS = 500;

/** Fractional shares of each component max (must sum to ≤ 1 per scorer). */
export const AUTH_SCORE_SHARES = {
  authInCode: 0.35,
  v2Api: 0.25,
  rsaPss: 0.15,
  officialSdk: 0.25,
} as const;

export const ORDER_SCORE_SHARES = {
  liveOrderPath: 0.6,
  dryRunDefault: 0.4,
} as const;

export const TESTS_CI_SCORE_SHARES = {
  tests: 0.6,
  ci: 0.4,
} as const;

export const DOCS_SCORE_SHARES = {
  longReadme: 0.4,
  setupSection: 0.35,
  strategySection: 0.25,
} as const;

/** Maintenance score by age of last default-branch commit (days). */
export const MAINTENANCE_AGE_DAYS = {
  fresh: 30,
  recent: 90,
  medium: 180,
  year: 365,
} as const;

export const MAINTENANCE_SCORE_SHARES = {
  unknown: 0.2,
  fresh: 1,
  recent: 0.85,
  medium: 0.65,
  year: 0.4,
  stale: 0.15,
} as const;

export const RISK_HIT_FULL = 3;
export const RISK_SCORE_SHARES = {
  twoHits: 0.75,
  oneHit: 0.45,
} as const;

/** Higher = preferred when quality totals are within stackTiebreakThreshold. */
export const STACK_RANK = {
  typescript: 3,
  javascript: 3,
  python: 2,
  rust: 1,
  go: 1,
  other: 0,
} as const;

export function isPreferredLicense(normalized: string): normalized is PreferredLicense {
  return (PREFERRED_LICENSES as readonly string[]).includes(normalized);
}

export function isUnlicensedSpdx(normalized: string): boolean {
  if (!normalized) return true;
  return (UNLICENSED_SPDX_MARKERS as readonly string[]).includes(normalized);
}

/** OS-level Bun.cron job title (launchd / crontab / Task Scheduler). */
export const RESEARCH_CRON_TITLE = "kalshi-research-weekly";

/** Default schedule: Monday 06:00 system local time (cross-platform safe). */
export const RESEARCH_CRON_SCHEDULE = "0 6 * * MON";
