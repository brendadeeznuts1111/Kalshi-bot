/**
 * Desk export column registry — structural SSOT for price_snapshot / hq-desk exports.
 * Meaning lives in glossary.ts (concept FK). Do not put human copy here.
 *
 * @see docs/SEMANTIC_LAYER.md
 * @see artifacts-browser/SCHEMA.md (human dictionary of export fields)
 */
import type { GlossaryId } from "./glossary.ts";

export type FeaturePurpose =
  | "identity"
  | "schedule"
  | "market"
  | "model"
  | "gate"
  | "provenance"
  | "other";

export type ColumnMeta = {
  /** 0-based index in export columns[] / CSV order */
  readonly column: number;
  /** snake_case machine name (export property) */
  readonly feature: string;
  /**
   * Optional FK to glossary.id with kind === "registry".
   * Stable semantic pointer — survives feature renames if concept stays.
   */
  readonly concept?: string;
  readonly featurePurpose: FeaturePurpose;
  /** Origin venue or system */
  readonly source: string;
  readonly nullable: boolean;
  readonly notes?: string;
};

/**
 * Columns from desk export meta (`price_snapshot_*.meta.json` columns[]).
 * concept defaults to feature when the field is a first-class semantic concept.
 */
export const DESK_EXPORT_COLUMNS: readonly ColumnMeta[] = [
  { column: 0, feature: "match_uuid", concept: "match_uuid", featurePurpose: "identity", source: "desk", nullable: false },
  { column: 1, feature: "event_ticker", concept: "event_ticker", featurePurpose: "identity", source: "kalshi", nullable: false },
  { column: 2, feature: "timestamp", concept: "timestamp", featurePurpose: "provenance", source: "desk", nullable: false },
  { column: 3, feature: "player_a", concept: "player_a", featurePurpose: "identity", source: "desk", nullable: false },
  { column: 4, feature: "player_b", concept: "player_b", featurePurpose: "identity", source: "desk", nullable: false },
  { column: 5, feature: "title", concept: "title", featurePurpose: "schedule", source: "desk", nullable: true },
  { column: 6, feature: "league", concept: "league", featurePurpose: "schedule", source: "desk", nullable: true },
  { column: 7, feature: "series", concept: "series", featurePurpose: "schedule", source: "kalshi", nullable: true },
  { column: 8, feature: "surface", concept: "surface", featurePurpose: "schedule", source: "desk", nullable: true },
  { column: 9, feature: "gender", concept: "gender", featurePurpose: "schedule", source: "desk", nullable: true },
  { column: 10, feature: "age_group", concept: "age_group", featurePurpose: "schedule", source: "desk", nullable: true },
  { column: 11, feature: "kalshi_mu", concept: "kalshi_mu", featurePurpose: "market", source: "kalshi", nullable: true },
  { column: 12, feature: "kalshi_spread", concept: "kalshi_spread", featurePurpose: "market", source: "kalshi", nullable: true },
  { column: 13, feature: "kalshi_volume", concept: "kalshi_volume", featurePurpose: "market", source: "kalshi", nullable: true },
  { column: 14, feature: "poly_mid", concept: "poly_mid", featurePurpose: "market", source: "polymarket", nullable: true },
  {
    column: 15,
    feature: "poly_volume",
    concept: "poly_volume",
    featurePurpose: "market",
    source: "polymarket",
    nullable: true,
    notes: "null = venue absent; 0 = joined with zero trades",
  },
  { column: 16, feature: "pinny_no_vig", concept: "pinny_no_vig", featurePurpose: "market", source: "pinnacle", nullable: true },
  { column: 17, feature: "pinny_source", concept: "pinny_source", featurePurpose: "provenance", source: "pinnacle", nullable: false },
  { column: 18, feature: "elo_prob", concept: "elo_prob", featurePurpose: "model", source: "elo", nullable: true },
  { column: 19, feature: "elo_source", concept: "elo_source", featurePurpose: "provenance", source: "elo", nullable: false },
  { column: 20, feature: "blend_fair_cents", concept: "blend_fair_cents", featurePurpose: "model", source: "desk", nullable: true },
  { column: 21, feature: "eff_edge", concept: "eff_edge", featurePurpose: "model", source: "desk", nullable: true },
  { column: 22, feature: "liquidity_ok", concept: "liquidity_ok", featurePurpose: "gate", source: "desk", nullable: false },
  {
    column: 23,
    feature: "desk_tradable",
    concept: "desk.tradable",
    featurePurpose: "gate",
    source: "desk",
    nullable: false,
    notes: "liquidity_ok + mid band; HQ / partners tradable chip",
  },
  {
    column: 24,
    feature: "desk_quoted",
    concept: "desk.quoted",
    featurePurpose: "gate",
    source: "desk",
    nullable: false,
    notes: "non-empty top-of-book in match_liquidity; maps from book_tick_count > 0",
  },
  { column: 25, feature: "total_volume_usd", concept: "total_volume_usd", featurePurpose: "market", source: "desk", nullable: true },
  { column: 26, feature: "multi_venue", concept: "multi_venue", featurePurpose: "gate", source: "desk", nullable: false },
  { column: 27, feature: "arb_hint", concept: "arb_hint", featurePurpose: "model", source: "desk", nullable: false },
  { column: 28, feature: "arb_actionable", concept: "arb_actionable", featurePurpose: "gate", source: "desk", nullable: false },
  { column: 29, feature: "rps_flag", concept: "rps_flag", featurePurpose: "model", source: "desk", nullable: false },
  { column: 30, feature: "graph_divergence", concept: "graph_divergence", featurePurpose: "model", source: "desk", nullable: false },
  { column: 31, feature: "research_flag", concept: "research_flag", featurePurpose: "gate", source: "desk", nullable: true },
  { column: 32, feature: "export_note", concept: "export_note", featurePurpose: "provenance", source: "desk", nullable: false },
] as const;

export type DeskFeature = (typeof DESK_EXPORT_COLUMNS)[number]["feature"];

export type ColumnRegistry = {
  readonly schema: "hq-desk/v1";
  readonly byIndex: readonly ColumnMeta[];
  readonly byFeature: ReadonlyMap<string, ColumnMeta>;
};

export function buildDeskColumnRegistry(
  columns: readonly ColumnMeta[] = DESK_EXPORT_COLUMNS,
): ColumnRegistry {
  const byFeature = new Map<string, ColumnMeta>();
  for (const m of columns) {
    if (byFeature.has(m.feature)) {
      throw new Error(`duplicate registry feature: ${m.feature}`);
    }
    byFeature.set(m.feature, m);
  }
  // structural check: column indices unique and contiguous from 0
  const idxs = columns.map((c) => c.column).sort((a, b) => a - b);
  for (let i = 0; i < idxs.length; i++) {
    if (idxs[i] !== i) {
      throw new Error(`column indices must be 0..n-1 contiguous; gap at ${i}`);
    }
  }
  return {
    schema: "hq-desk/v1",
    byIndex: columns,
    byFeature,
  };
}

/** Type-only helper: concept should be a registry GlossaryId when set. */
export type ConceptRef = GlossaryId | (string & {});
