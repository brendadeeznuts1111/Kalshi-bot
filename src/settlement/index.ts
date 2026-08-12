/**
 * Shell settlement weighting + void-aware EV + sport-wide edge patterns.
 * @see docs/PLIVE-EZLIVE-SPORTS-RULES.md
 * @see docs/EDGE-PATTERNS.md
 */

export {
  DEFAULT_WEIGHTING,
  classifyMarketClass,
  defaultVoidPrior,
  resolveSettlementWeighting,
  settlementComponents,
  tennisMatchMlWouldHaveAction,
  weightingSportKey,
  type SettlementContextInput,
  type SettlementMarketClass,
  type SettlementPhase,
  type SettlementWeighting,
  type SportWeightingRules,
  type VoidRiskLevel,
  type WeightingIndex,
  type WeightingSportKey,
} from './weighting.ts';

export {
  americanToDecimal,
  expectedValueWithVoid,
  type VoidEvInput,
  type VoidEvResult,
} from './void-ev.ts';

export {
  attachEdgePatternComponents,
  attachSettlementToComponents,
  describeSettlementWeighting,
  weightLiveTrackerMove,
  type LiveTrackerWeightInput,
  type LiveTrackerWeightResult,
} from './live-weight.ts';

export {
  EDGE_PATTERN_FAMILIES,
  EDGE_PATTERN_SORT_KEYS,
  edgePatternsByFamily,
  formatEdgePatternCatalog,
  getEdgePattern,
  lineKindFromMarketClass,
  listEdgePatternFamilies,
  listEdgePatterns,
  parseEdgePatternSortBy,
  scanEdgePatterns,
  sortEdgePatternHits,
  sortEdgePatterns,
  voidRiskScore,
  type EdgeLineKind,
  type EdgePattern,
  type EdgePatternContext,
  type EdgePatternFamily,
  type EdgePatternHit,
  type EdgePatternScanResult,
  type EdgePatternScope,
  type EdgePatternSeverity,
  type EdgePatternSortKey,
  type EdgePatternSortOptions,
} from './edge-patterns.ts';

export {
  ANALYZE_COLUMN_PRESET_NAMES,
  ANALYZE_COLUMN_PRESETS,
  ANALYZE_WEIGHTED_ALL_COLUMNS,
  ANALYZE_WEIGHTED_DEFAULT_COLUMNS,
  ANALYZE_WEIGHTED_FIELD_SCHEMA,
  buildAnalyzeInspectMeta,
  buildAnalyzeSchemaDocument,
  buildAnalyzeSnapshotArtifact,
  flattenWeightedEventRow,
  flattenWeightedEvents,
  formatAnalyzeBanner,
  formatAnalyzeHtmlReport,
  formatAnalyzeInspectTable,
  formatAnalyzeMarkdownReport,
  formatAnalyzeMarkdownTable,
  projectAnalyzeRows,
  resolveAnalyzeColumns,
  summarizeAnalyzeRows,
  type AnalyzeColumnPresetName,
  type AnalyzeRowSummary,
  type AnalyzeSnapshotArtifact,
  type AnalyzeWeightedFieldKey,
  type AnalyzeWeightedRow,
  type WeightedTrackerEvent,
} from './analyze-table.ts';