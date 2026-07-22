export type LicenseInfo = {
  spdxId: string | null;
  name: string | null;
  preferred: boolean;
  unlicensed: boolean;
};

export type RepoCandidate = {
  fullName: string;
  owner: string;
  name: string;
  htmlUrl: string;
  description: string | null;
  stars: number;
  forks: number;
  pushedAt: string;
  archived: boolean;
  topics: string[];
  defaultBranch: string;
  license: LicenseInfo;
};

export type CodeSearchHit = {
  query: string;
  totalCount: number;
  paths: string[];
};

export type InspectionSignals = {
  readmeLength: number;
  hasSetupSection: boolean;
  hasStrategySection: boolean;
  authHits: CodeSearchHit[];
  orderHits: CodeSearchHit[];
  usesOfficialSdk: boolean;
  hasAuthInCode: boolean;
  hasV2Api: boolean;
  hasRsaPss: boolean;
  hasLiveOrderPath: boolean;
  hasDryRunDefault: boolean;
  /** Auth stack touched on default branch within freshness window (see authFreshnessMaxDays). */
  hasAuthFreshness: boolean;
  /** Order paths reference Kalshi-style cent prices (1–99) or explicit price_cents fields. */
  hasCentsPriceBounds: boolean;
  hasTests: boolean;
  hasCi: boolean;
  languages: Record<string, number>;
  primaryLanguage: string | null;
  lastDefaultBranchCommitAt: string | null;
  strategyTags: string[];
  isSdkOnly: boolean;
  riskKeywordHits: string[];
};

export type ScoreBreakdown = {
  authApi: number;
  orderRealism: number;
  testsCi: number;
  docsSetup: number;
  maintenance: number;
  riskControls: number;
  licenseModifier: number;
  total: number;
};

/** Finest-scope falsifiable match — one query hit in one file path. */
export type EvidenceLine = {
  scope: "line";
  query: string;
  path: string;
  component: "authApi" | "orderRealism" | "riskControls" | "strategy";
};

export type DetectorScope = "line" | "file" | "repo" | "strategy";

export type ScoreComponent = keyof Omit<ScoreBreakdown, "total" | "licenseModifier">;

/** Aggregated detector output for one quality component. */
export type DetectorResult = {
  id: string;
  component: ScoreComponent;
  scope: DetectorScope;
  matched: boolean;
  pointsContributed: number;
  maxPoints: number;
  evidence: EvidenceLine[];
  rationale: string;
};

/** Per-repo structured report — local SSOT; audit wire via audit-adapter.ts. */
export type RepoReport = {
  fullName: string;
  generatedAt: string;
  score: ScoreBreakdown;
  detectors: DetectorResult[];
  liftNotes: string;
  strategyTags: string[];
};

export type ScoredRepo = {
  repo: RepoCandidate;
  signals: InspectionSignals;
  score: ScoreBreakdown;
  stackRank: number;
  report?: RepoReport;
};

export type DimensionDef = {
  label: string;
  queries: string[];
  candidateCap?: number;
};

export type DimensionsConfig = {
  candidateCap: number;
  defaultDimension: string;
  dimensions: Record<string, DimensionDef>;
};

export type ResearchConfig = {
  dimensions: DimensionsConfig;
  weights: {
    shortlistSize: number;
    maxPerTag: number;
    stackTiebreakThreshold: number;
    gate: { minStars: number; minForks: number; maxAgeMonths: number };
    components: {
      authApi: number;
      orderRealism: number;
      testsCi: number;
      docsSetup: number;
      maintenance: number;
      riskControls: number;
    };
    license: { unlicensedPenalty: number; preferredLicenses: string[] };
  };
  keywords: {
    authCodeSearch: string[];
    orderCodeSearch: string[];
    riskKeywords: string[];
    strategyTags: Record<string, string[]>;
    majorStrategyTags: string[];
  };
};

export type ResearchRunKind = "production" | "fixture";

export type ResearchRun = {
  runId: string;
  generatedAt: string;
  /** `fixture` runs are test harness data — excluded from operator views and latest resolution. */
  kind?: ResearchRunKind;
  /** Research question slice — see research/dimensions.json (default `all`). */
  dimension?: string;
  config: {
    shortlistSize: number;
    gate: ResearchConfig["weights"]["gate"];
    /** GitHub search qualifiers — defaults broad when apply gate is strict. */
    discoverGate?: ResearchConfig["weights"]["gate"];
  };
  stats: {
    discovered: number;
    gated: number;
    inspected: number;
    shortlist: number;
    cache?: {
      searchEtagHits: number;
      searchDegradedHits: number;
      inspectExactHits: number;
      inspectContentReuseHits: number;
      inspectDegradedHits: number;
      apiDegradedHits: number;
    };
  };
  candidates: RepoCandidate[];
  gated: RepoCandidate[];
  scored: ScoredRepo[];
  shortlist: ScoredRepo[];
  excludedSdkOnly: ScoredRepo[];
  /** Populated when discover > 0 but gate passes 0 — near misses + retry command. */
  gateMiss?: import("./gate-miss.ts").GateMissStats;
  /** Populated when discover returns 0 — alternate queries + relaxed gate retry. */
  discoveryMiss?: import("./discovery-miss.ts").DiscoveryMissStats;
};

export type RunDiff = {
  previousRunId: string | null;
  newEntrants: string[];
  dropped: string[];
  scoreDeltas: Array<{
    fullName: string;
    previous: number | null;
    current: number;
    delta: number | null;
  }>;
  shortlistChanges: {
    added: string[];
    removed: string[];
  };
};
