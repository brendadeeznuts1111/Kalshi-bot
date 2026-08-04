/**
 * glossary.ts — single source of truth for domain short codes, unit
 * conventions, and HQ UI glossary entries (tooltips + panel).
 * docs/GLOSSARY.md is the human mirror; do not fork definitions into views.
 *
 * Convention:
 *   - Short codes are 3–5 uppercase letters, stable forever (append-only).
 *   - Money fields end in `Cents` (integer) or `Dollars` (fixed-point string).
 *   - Times end in `AtMs` (epoch millis). Wire `*_ts` is unix SECONDS.
 *   - UI concepts use camelCase ids matching tip() keys / #glossary:id.
 */
import {
  COLORS,
  cssColor,
  foregroundCss,
  isColorKey,
  type ColorKey,
} from "../lib/color/index.ts";

// ── Ledger / entity short codes ──

export const CODES = {
  // Money movement (Kalshi has no programmatic deposit/withdraw — DEP/WDL
  // appear only in OUR reconciliation records after bank-rail transfers)
  DEP: "deposit — funds in via Kalshi web/bank rails; reconciled, never API-initiated",
  WDL: "withdrawal — funds out via Kalshi web/bank rails; reconciled, never API-initiated",
  TRF: "internal transfer between subaccounts",

  // Trading entities
  ORD: "order — working intent; status resting|pending|executed|canceled",
  FILL: "fill — executed quantity against an order; has is_taker + fee_cost",
  POS: "position — signed contracts per market (+yes / −no)",
  BAL: "balance — available-to-trade cents; portfolio_value is separate",
  FEE: "fee — taker or maker, cents (taker_fees / maker_fees / fee_cost)",
  SETL: "settlement — market resolution payout",

  // Market data
  BOOK: "orderbook snapshot — bids/asks in yes-cents, integer levels",
  TICK: "price tick from ingest (polymarket/market_data agent)",
  EVT: "canonical event (kalshi:EVENT-TICKER in event store)",
  MILE: "Kalshi milestone — groups related event tickers",

  // Pipeline
  RUN: "research run — one discovery+score sweep, id = UTC timestamp",
  PROG: "alpha program — alpha/*/program.json, status shadow|pilot|live",
  SHDW: "shadow signal — simulated decision, hash-chained in shadow-log.jsonl",
  CAL: "calibration run — calibration/artifacts/<ts>",
  ALERT: "pipeline alert — fired by price-logger when feed quality degrades",
  RESV: "alert resolution — auto-sent when active alert conditions clear",
} as const;

export type ShortCode = keyof typeof CODES;

// ── Unit conventions (chart / export / wire annotations) ──

/**
 * Canonical unit keys for `GlossaryEntry.unit`.
 * Interior money is always integer cents; USD/pp/pct are display or delta scales.
 */
export const UNITS = {
  cents: "integer cents, 1–99 for prices; canonical money unit everywhere",
  usd: "US dollars (chart/export display; prefer cents interior)",
  dollarsFp: "fixed-point dollar string e.g. \"0.5600\" — wire only, parse via dollarsToCents",
  countFp: "fixed-point contract string e.g. \"10.00\" — fractional flagged, not orderable",
  count: "integer count (contracts, events, gaps, appearances)",
  pp: "percentage points — edge / probability delta (e.g. surface edge)",
  pct: "percent 0–100 scale (thresholds, share of total)",
  probability: "probability on 0–1 scale (Elo, model outputs)",
  atMs: "epoch milliseconds — canonical absolute time (suffix AtMs)",
  ms: "duration in milliseconds (staleness windows, intervals)",
  unixSec: "unix seconds — wire only (updated_ts, ts); multiply by 1000 at boundary",
} as const;

export type UnitKey = keyof typeof UNITS;

/** Lifecycle for safe evolution — omit on entry = active. */
export const GLOSSARY_STATUSES = ["active", "deprecated", "draft"] as const;
export type GlossaryStatus = (typeof GLOSSARY_STATUSES)[number];

// ── Structured glossary entries (HQ panel + tip keys) ──

export type GlossaryCategory =
  | "market"
  | "model"
  | "tournament"
  | "warehouse"
  | "trading"
  | "ui"
  | "pipeline"
  | "other";

export const GLOSSARY_CATEGORY_LABELS: Record<GlossaryCategory, string> = {
  market: "Market data",
  model: "Model & calibration",
  tournament: "Tournament metadata",
  warehouse: "Warehouse & profiles",
  trading: "Trading & orders",
  ui: "UI & ops",
  pipeline: "Pipeline & alerts",
  other: "Other",
};

/**
 * kind:
 *   registry  — desk/export feature name (snake_case id = feature)
 *   ui        — HQ tip keys / pure chrome (camelCase or ui.*)
 *   composite — derived multi-field concepts
 * @see docs/SEMANTIC_LAYER.md
 */
export type GlossaryKind = "registry" | "ui" | "composite";

export type GlossaryEntry = {
  /** Stable id — tip("id"), #glossary:id, registry.concept FK */
  id: string;
  label: string;
  description: string;
  category: GlossaryCategory;
  kind: GlossaryKind;
  /** UI concept that shadows a registry concept */
  mapsTo?: string;
  /** Alternate labels (search / governance) */
  synonyms?: string[];
  example?: string;
  /** Closed-set option codes (filter enums, severity ladders, …) */
  values?: string[];
  /**
   * Optional display text for a value code (option labels in selects).
   * Defaults to the code string when omitted.
   */
  valueLabels?: Record<string, string>;
  /** Condition that resolves this alert (empty = manual-only) */
  resolveValues?: string[];
  /** Label shown on resolution messages */
  resolveLabel?: string;
  /**
   * Related glossary ids for panel discoverability (soft links, not inheritance).
   * Validated: every id must exist; no self-links.
   */
  seeAlso?: string[];
  /**
   * Lifecycle — omit means `active`.
   * `deprecated` should set `deprecatedBy` to the replacement id.
   * `draft` = WIP; may be hidden from hard consumers later.
   */
  status?: GlossaryStatus;
  /** When status is deprecated, preferred replacement concept id */
  deprecatedBy?: string;
  /** Unit annotation for chart/export consumers (`keyof UNITS`) */
  unit?: UnitKey;
  /** ISO date when entry was first added (YYYY-MM-DD) */
  added?: string;
  /** ISO date when entry was deprecated (YYYY-MM-DD) */
  deprecatedAt?: string;
  /** Semantic color key from the Bun-native color kernel (not a raw hex) */
  color?: ColorKey;
  /** Output format for ad-hoc glossaryColor() ("hex", "ansi", "css", …) */
  colorFormat?: string;
  /** Optional canonical docs / product URL (validated by glossary:urls) */
  url?: string;
  /** Tone / voice category for consistent UX writing */
  tone?: "metric" | "alert" | "registry" | "concept";
};

function ui(
  e: Omit<GlossaryEntry, "kind"> & { kind?: GlossaryKind },
): GlossaryEntry {
  return { kind: "ui", ...e };
}

function reg(
  e: Omit<GlossaryEntry, "kind" | "category"> & {
    category?: GlossaryCategory;
    kind?: GlossaryKind;
  },
): GlossaryEntry {
  return { kind: "registry", category: e.category ?? "other", ...e };
}

/**
 * Canonical glossary — semantic authority.
 * tip() keys must appear here. Desk export columns with concept FKs need kind=registry.
 */
export const GLOSSARY_ENTRIES: readonly GlossaryEntry[] = [
  // ── market (HQ UI tips) ──
  ui({
    id: "mid",
    label: "Mid",
    description:
      "Midpoint of best yes-bid and yes-ask. Untradeable reference price.",
    category: "market",
    mapsTo: "kalshi_mu",
    synonyms: ["mid price", "market price"],
    unit: "cents",
    seeAlso: ["kalshi_mu", "spreadCents", "poly_mid"],
    tone: "concept" }),
  ui({
    id: "spreadCents",
    label: "Spread",
    description: "Best ask − best bid (¢). Wide spreads = poor liquidity; prefer postOnly.",
    category: "market",
    mapsTo: "kalshi_spread",
    synonyms: ["bid-ask", "spread"],
    unit: "cents",
    seeAlso: ["mid", "kalshi_spread", "liquidity_ok"],
    tone: "concept" }),
  ui({
    id: "crossed",
    label: "Crossed book",
    description: "Transient book state (yesBid + noBid > 100). Do not treat mid as tradeable.",
    category: "market",
    seeAlso: ["mid", "spreadCents"],
    tone: "concept" }),
  ui({
    id: "avgKalshiVolumeFp",
    label: "Avg volume (Fp)",
    description:
      "Mean resolved Kalshi contract volume over trading appearances (player_profiles). Not poly; not a single-tick kalshi_volume.",
    category: "market",
    mapsTo: "kalshi_volume",
    synonyms: ["avg vol", "volume", "avgKalshiVolume"],
    unit: "countFp",
    seeAlso: ["kalshi_volume", "playerProfiles", "lastSeenAtMs"],
    tone: "concept" }),
  ui({
    id: "yesPriceCents",
    label: "Yes price ¢",
    description: "Limit price for YES contracts, 1–99¢. NO price = 100 − yes.",
    category: "market",
    unit: "cents",
    seeAlso: ["mid", "feeCents", "postOnly"],
    tone: "concept" }),

  // ── trading UI ──
  ui({
    id: "balanceCents",
    label: "Balance",
    description:
      "Available-to-trade cash. Does not include value locked in open positions.",
    category: "trading",
    unit: "cents",
    seeAlso: ["portfolioValueCents", "exposureCents"],
    tone: "concept" }),
  ui({
    id: "portfolioValueCents",
    label: "Portfolio value",
    description: "Current mark value of all held positions, separate from cash balance.",
    category: "trading",
    unit: "cents",
    seeAlso: ["balanceCents", "position", "exposureCents"],
    tone: "concept" }),
  ui({
    id: "position",
    label: "Position",
    description: "Signed contracts: positive = long YES, negative = long NO (Kalshi convention).",
    category: "trading",
    unit: "count",
    seeAlso: ["exposureCents", "fillCount"],
    tone: "concept" }),
  ui({
    id: "exposureCents",
    label: "Exposure",
    description: "Cash at risk in this market at current marks.",
    category: "trading",
    unit: "cents",
    seeAlso: ["position", "balanceCents", "realizedPnlCents"],
    tone: "concept" }),
  ui({
    id: "realizedPnlCents",
    label: "Realized P&L",
    description: "Locked-in profit/loss from closed trades in this market.",
    category: "trading",
    unit: "cents",
    seeAlso: ["feesPaidCents", "exposureCents"],
    tone: "concept" }),
  ui({
    id: "feesPaidCents",
    label: "Fees paid",
    description: "Total exchange fees paid in this market, all time.",
    category: "trading",
    unit: "cents",
    seeAlso: ["feeCents", "realizedPnlCents", "isTaker"],
    tone: "concept" }),
  ui({
    id: "remainingCount",
    label: "Remaining",
    description: "Contracts still working on the book (not yet filled or canceled).",
    category: "trading",
    unit: "count",
    seeAlso: ["fillCount", "postOnly"],
    tone: "concept" }),
  ui({
    id: "fillCount",
    label: "Fill count",
    description: "Contracts already executed from this order.",
    category: "trading",
    unit: "count",
    seeAlso: ["remainingCount", "feeCents", "isTaker"],
    tone: "concept" }),
  ui({
    id: "isTaker",
    label: "Taker",
    description: "True = crossed the spread (taker fee); false = rested on book (maker fee, lower).",
    category: "trading",
    seeAlso: ["feeCents", "postOnly"],
    tone: "concept" }),
  ui({
    id: "feeCents",
    label: "Fee ¢",
    description: "Exchange fee on this fill. Maker < taker — postOnly orders target maker fees.",
    category: "trading",
    unit: "cents",
    seeAlso: ["feesPaidCents", "isTaker", "postOnly"],
    tone: "concept" }),
  ui({
    id: "postOnly",
    label: "Post-only",
    description: "Maker-first: order rests on book or is rejected; never crosses the spread.",
    category: "trading",
    seeAlso: ["isTaker", "feeCents", "dryRun"],
    tone: "concept" }),
  ui({
    id: "dryRun",
    label: "Dry-run",
    description: "Simulated order — no funds move, no API write. Live requires explicit opt-in.",
    category: "trading",
    synonyms: ["dry run", "simulate"],
    seeAlso: ["postOnly"],
    tone: "concept" }),

  // ── model UI gates ──
  ui({
    id: "shadowMinSignals",
    label: "Shadow min signals",
    description: "Gate: minimum shadow signals before a program may graduate to pilot.",
    category: "model",
    unit: "count",
    seeAlso: ["killBrierDriftPct", "graduationMinRealizedEdgeCentsPerFill"],
    tone: "concept" }),
  ui({
    id: "killBrierDriftPct",
    label: "Kill Brier drift %",
    description: "Gate: kill program if Brier score drifts this % above baseline.",
    category: "model",
    unit: "pct",
    seeAlso: ["shadowMinSignals", "graduationMinRealizedEdgeCentsPerFill"],
    tone: "concept" }),
  ui({
    id: "graduationMinRealizedEdgeCentsPerFill",
    label: "Graduation edge ¢/fill",
    description: "Gate: realized edge per fill needed for pilot→live.",
    category: "model",
    unit: "cents",
    seeAlso: ["shadowMinSignals", "eff_edge", "realizedPnlCents"],
    tone: "concept" }),

  // ── tournament (registry-aligned ids — same as desk export features) ──
  reg({
    id: "league",
    label: "League",
    description: "Professional circuit derived from Kalshi series (ATP, WTA, Challenger, ITF).",
    category: "tournament",
    synonyms: ["series", "tour"],
    values: ["ATP", "WTA", "ATP Challenger", "WTA 125", "ITF Men", "ITF Women"],
    seeAlso: ["surface", "tier", "series"],
    tone: "registry" }),
  reg({
    id: "surface",
    label: "Surface",
    description: "Court type: Hard, Clay, Grass, Carpet (from event or tournament seed).",
    category: "tournament",
    values: ["Hard", "Clay", "Grass", "Carpet"],
    seeAlso: ["league", "tier", "surfaceEdge"],
    tone: "registry" }),
  // tier / round appear on board + HQ filters; not always in desk export columns[]
  reg({
    id: "tier",
    label: "Tier",
    description: "Competition level (GS, 1000, 500, 250, CH, ITF15–100, …).",
    category: "tournament",
    synonyms: ["level"],
    values: [
      "GS", "SPECIAL", "1000", "500", "250", "CH", "W125",
      "ITF100", "ITF75", "ITF60", "ITF50", "ITF40", "ITF35", "ITF25", "ITF15",
    ],
    seeAlso: ["league", "surface", "round"],
    tone: "registry" }),
  reg({
    id: "round",
    label: "Round",
    description: "Match round within the tournament (R16, QF, SF, F, …).",
    category: "tournament",
    seeAlso: ["tier", "league"],
    tone: "registry" }),
  reg({
    id: "series",
    label: "Series",
    description: "Kalshi series ticker family (e.g. KXATPMATCH).",
    category: "tournament",
    seeAlso: ["league", "event_ticker"],
    tone: "registry" }),
  reg({
    id: "gender",
    label: "Gender",
    description: "Competition gender classification on the desk export.",
    category: "tournament",
    seeAlso: ["league", "age_group"],
    tone: "registry" }),
  reg({
    id: "age_group",
    label: "Age group",
    description: "Age band when present (junior/senior); often empty on tour.",
    category: "tournament",
    seeAlso: ["gender", "league"],
    tone: "registry" }),

  // ── desk export identity / market / model (registry) ──
  reg({
    id: "match_uuid",
    label: "Match UUID",
    description: "Stable match identity for desk joins.",
    category: "warehouse",
    tone: "registry" }),
  reg({
    id: "event_ticker",
    label: "Event ticker",
    description: "Kalshi event ticker (market grouping key).",
    category: "warehouse",
    tone: "registry" }),
  reg({
    id: "timestamp",
    label: "Timestamp",
    description: "Snapshot capture time for the desk row.",
    category: "warehouse",
    tone: "registry" }),
  reg({
    id: "player_a",
    label: "Player A",
    description: "Side A player display name on the desk row.",
    category: "warehouse",
    tone: "registry" }),
  reg({
    id: "player_b",
    label: "Player B",
    description: "Side B player display name on the desk row.",
    category: "warehouse",
    tone: "registry" }),
  reg({
    id: "title",
    label: "Title",
    description: "Match / event title string on the desk export.",
    category: "warehouse",
    tone: "registry" }),
  reg({
    id: "kalshi_mu",
    label: "Kalshi µ",
    description: "Kalshi mid (implied probability cents) on the desk snapshot.",
    category: "market",
    synonyms: ["kalshi mid", "mu"],
    unit: "cents",
    seeAlso: ["mid", "poly_mid", "pinny_no_vig", "blend_fair_cents"],
    tone: "registry" }),
  reg({
    id: "kalshi_spread",
    label: "Kalshi spread",
    description: "Kalshi bid–ask spread on the desk snapshot.",
    category: "market",
    unit: "cents",
    seeAlso: ["spreadCents", "kalshi_mu", "liquidity_ok"],
    tone: "registry" }),
  reg({
    id: "kalshi_volume",
    label: "Kalshi volume",
    description: "Kalshi contract volume on the desk tick (not player-profile average).",
    category: "market",
    unit: "countFp",
    seeAlso: ["avgKalshiVolumeFp", "poly_volume", "total_volume_usd"],
    tone: "registry" }),
  reg({
    id: "poly_mid",
    label: "Poly mid",
    description: "Polymarket mid price, cents; null when venue absent.",
    category: "market",
    unit: "cents",
    seeAlso: ["kalshi_mu", "poly_volume", "alert.divergence"],
    tone: "registry" }),
  reg({
    id: "poly_volume",
    label: "Poly volume",
    description: "Polymarket volume USD; null = venue absent, 0 = joined with zero trades.",
    category: "market",
    unit: "usd",
    seeAlso: ["kalshi_volume", "total_volume_usd", "poly_mid"],
    tone: "registry" }),
  reg({
    id: "pinny_no_vig",
    label: "Pinnacle no-vig",
    description: "Pinnacle no-vig probability in cents; null when unavailable.",
    category: "market",
    unit: "cents",
    seeAlso: ["pinny_source", "kalshi_mu", "blend_fair_cents"],
    tone: "registry" }),
  reg({
    id: "pinny_source",
    label: "Pinnacle source",
    description: "mock | live — origin of pinny_no_vig.",
    category: "market",
    values: ["mock", "live"],
    seeAlso: ["pinny_no_vig", "export_note"],
    tone: "registry" }),
  reg({
    id: "elo_prob",
    label: "Elo prob",
    description: "Elo win probability for player A (0–1); interpret with elo_source.",
    category: "model",
    unit: "probability",
    seeAlso: ["elo_source", "blend_fair_cents", "eff_edge"],
    tone: "registry" }),
  reg({
    id: "elo_source",
    label: "Elo source",
    description: "model | fallback_50 | missing — provenance of elo_prob.",
    category: "model",
    values: ["model", "fallback_50", "missing"],
    seeAlso: ["elo_prob"],
    tone: "registry" }),
  reg({
    id: "blend_fair_cents",
    label: "Blend fair ¢",
    description: "Blended fair price in cents (core priced output).",
    category: "model",
    unit: "cents",
    seeAlso: ["eff_edge", "kalshi_mu", "elo_prob", "pinny_no_vig"],
    tone: "registry" }),
  reg({
    id: "eff_edge",
    label: "Eff edge",
    description: "Effective edge vs blend (cents); tick-bound, can drift.",
    category: "model",
    unit: "cents",
    seeAlso: ["blend_fair_cents", "surfaceEdge", "arb_hint"],
    tone: "registry" }),
  reg({
    id: "liquidity_ok",
    label: "Liquidity OK",
    description: "Desk liquidity gate (necessary, not sufficient for tradable).",
    category: "market",
    seeAlso: ["desk.tradable", "kalshi_spread", "kalshi_volume", "ui.events.filter.liquidity", "kpi.tight_markets"],
    tone: "registry" }),
  reg({
    id: "desk.tradable",
    label: "Desk tradable",
    description:
      "Match clears liquidity_ok and mid is in the desk tradable band (default 20–80¢). Necessary for chip 'tradable' on HQ / partners.",
    category: "market",
    seeAlso: ["liquidity_ok", "kalshi_spread", "kalshi_volume", "kpi.tradable_matches"],
    tone: "registry",
    color: "tennis",
  }),
  reg({
    id: "total_volume_usd",
    label: "Total volume USD",
    description: "Combined venue volume in USD for the match snapshot.",
    category: "market",
    unit: "usd",
    seeAlso: ["kalshi_volume", "poly_volume", "multi_venue"],
    tone: "registry" }),
  reg({
    id: "multi_venue",
    label: "Multi-venue",
    description: "Whether more than one venue is joined on the row.",
    category: "warehouse",
    seeAlso: ["total_volume_usd", "arb_hint", "coverage"],
    tone: "registry" }),
  reg({
    id: "arb_hint",
    label: "Arb hint",
    description: "Directional arb signal (kalshi-cheap | poly-cheap | none | watch).",
    category: "model",
    seeAlso: ["arb_actionable", "alert.divergence", "eff_edge"],
    tone: "registry" }),
  reg({
    id: "arb_actionable",
    label: "Arb actionable",
    description: "Hard arb gate (net edge > 0 on real venue-vs-venue).",
    category: "model",
    seeAlso: ["arb_hint", "liquidity_ok", "eff_edge"],
    tone: "registry" }),
  reg({
    id: "rps_flag",
    label: "RPS flag",
    description: "Research process signal flag on the desk row.",
    category: "model",
    seeAlso: ["research_flag", "graph_divergence"],
    tone: "registry" }),
  reg({
    id: "graph_divergence",
    label: "Graph divergence",
    description: "Graph/model divergence indicator on the desk export.",
    category: "model",
    seeAlso: ["composite.divergence", "alert.divergence", "rps_flag"],
    tone: "registry" }),
  reg({
    id: "research_flag",
    label: "Research flag",
    description: "Research gating reason (e.g. DATA_INCOMPLETE, thin-data).",
    category: "warehouse",
    seeAlso: ["export_note", "rps_flag", "coverage"],
    tone: "registry" }),
  reg({
    id: "export_note",
    label: "Export note",
    description: "Per-row provenance string (e.g. mock pinny caveat).",
    category: "warehouse",
    seeAlso: ["pinny_source", "research_flag"],
    tone: "registry" }),

  // ── warehouse UI (not desk CSV columns) ──
  ui({
    id: "playerProfiles",
    label: "Player profiles",
    description:
      "Derived from event-store player_profiles (SSOT). Rebuild: bun run tennis:profiles:build.",
    category: "warehouse",
    synonyms: ["profiles"],
    seeAlso: ["avgKalshiVolumeFp", "lastSeenAtMs", "profilesSource"],
    tone: "concept" }),
  ui({
    id: "lastSeenAtMs",
    label: "Last seen",
    description:
      "Epoch millis of latest event start for this player. Capped ≤ now. Event-store ms.",
    category: "warehouse",
    synonyms: ["last seen", "lastSeenMs"],
    unit: "atMs",
    seeAlso: ["playerProfiles", "avgKalshiVolumeFp"],
    tone: "concept" }),
  ui({
    id: "profilesSource",
    label: "Profiles source",
    description:
      "warehouse = rows from event-store; seed = unavailable / fixture path.",
    category: "warehouse",
    values: ["warehouse", "seed"],
    seeAlso: ["playerProfiles"],
    tone: "concept" }),
  ui({
    id: "coverage",
    label: "Coverage",
    description: "Data completeness for a tour/surface slice (events with books, links, scores).",
    category: "warehouse",
    unit: "pct",
    seeAlso: ["multi_venue", "ui.warehouse.coverage"],
    tone: "concept" }),
  ui({
    id: "surfaceEdge",
    label: "Surface edge",
    description:
      "Dampened percentage-point edge from each player's historical surface win rates vs the match surface.",
    category: "warehouse",
    synonyms: ["surface edge"],
    unit: "pp",
    seeAlso: ["surface", "eff_edge", "ui.events.filter.min_surface_edge"],
    tone: "concept" }),
  ui({
    id: "ui.events.filter.reset",
    label: "Reset filters",
    description: "Clear all active Events facet selections and sort order.",
    category: "ui",
    synonyms: ["clear", "reset"],
    tone: "concept" }),

  // ── Live board / Events chrome ──
  ui({
    id: "ui.live_board.title",
    kind: "ui",
    label: "Tennis board",
    description:
      "Real-time match monitor: open Kalshi markets with filters, surface edge, and player profiles.",
    category: "ui",
    synonyms: ["live board", "board", "monitor", "tennis board"],
    tone: "concept" }),
  ui({
    id: "ui.live_board.scanner",
    label: "Scanner",
    description:
      "Price divergence alert: when market mid deviates from model fair by more than threshold.",
    category: "ui",
    mapsTo: "composite.scanner",
    synonyms: ["alert", "signal", "flag"],
    seeAlso: ["composite.scanner", "ui.live_board.divergence", "alert.divergence"],
    tone: "concept" }),
  ui({
    id: "ui.live_board.divergence",
    label: "Divergence",
    description: "Cents difference between market price and model fair price.",
    category: "ui",
    mapsTo: "composite.divergence",
    synonyms: ["delta", "edge", "gap"],
    unit: "cents",
    seeAlso: ["composite.divergence", "alert.divergence", "eff_edge"],
    tone: "concept" }),
  ui({
    id: "ui.live_board.edge_score",
    label: "Edge score",
    description:
      "Composite signal strength: divergence weighted by liquidity and model confidence.",
    category: "ui",
    mapsTo: "composite.edge_score",
    synonyms: ["edge", "score", "strength"],
    seeAlso: ["composite.edge_score", "eff_edge", "surfaceEdge"],
    tone: "concept" }),
  ui({
    id: "ui.live_board.model_suspect",
    label: "Model suspect",
    description:
      "Flag when model inputs are stale, incomplete, or conflict with market consensus.",
    category: "ui",
    mapsTo: "composite.model_suspect",
    synonyms: ["suspect", "stale", "untrusted"],
    seeAlso: ["composite.model_suspect", "elo_source", "alert.stale_feed"],
    tone: "concept" }),

  // ── Events filter chrome ──
  ui({
    id: "ui.events.filter.tournament",
    label: "Tournament",
    description: "Filter matches by tournament / competition name.",
    category: "tournament",
    synonyms: ["competition", "event name"],
    tone: "concept" }),
  ui({
    id: "ui.events.filter.country",
    label: "Country",
    description: "Filter by tournament or player nationality code/name.",
    category: "tournament",
    synonyms: ["nation", "geo"],
    tone: "concept" }),
  ui({
    id: "ui.events.filter.when",
    label: "When",
    description: "Time window filter: live, today, next 24h, this week.",
    category: "ui",
    synonyms: ["time", "window"],
    values: ["all", "live", "today", "24h", "week"],
    valueLabels: {
      all: "all",
      live: "in play now",
      today: "today",
      "24h": "next 24h",
      week: "this week",
    },
    tone: "concept",
  }),
  ui({
    id: "ui.events.filter.liquidity",
    label: "Liquidity",
    description: "Filter by quote presence: priced or actively trading.",
    category: "market",
    synonyms: ["quotes", "book"],
    values: ["all", "priced", "active"],
    valueLabels: {
      all: "all",
      priced: "has quotes",
      active: "trading live",
    },
    tone: "concept",
  }),
  ui({
    id: "ui.events.filter.min_vol",
    label: "Min 24h vol",
    description: "Minimum trailing volume gate for board rows (desk liquidity).",
    category: "market",
    mapsTo: "kalshi_volume",
    synonyms: ["min volume", "volume floor"],
    unit: "countFp",
    seeAlso: ["kalshi_volume", "ui.events.filter.liquidity"],
    tone: "concept" }),
  ui({
    id: "ui.events.filter.min_surface_edge",
    label: "Min surface edge",
    description: "Minimum surface-edge points required to keep a match on the board.",
    category: "warehouse",
    mapsTo: "surfaceEdge",
    unit: "pp",
    seeAlso: ["surfaceEdge", "surface"],
    tone: "concept" }),
  ui({
    id: "ui.sort.events",
    label: "Sort",
    description: "Ordering of the match list: start time, volume, or name.",
    category: "ui",
    synonyms: ["sort events", "order"],
    values: ["time", "volume", "alpha"],
    valueLabels: {
      time: "start time",
      volume: "24h volume",
      alpha: "A–Z",
    },
    tone: "concept",
    seeAlso: ["ui.events.filter.when", "ui.events.filter.min_vol"],
  }),
  ui({
    id: "ui.filter.unclassified",
    label: "Unclassified",
    description: "Placeholder when a value cannot be mapped to a known category.",
    category: "ui",
    synonyms: ["Unc", "Other", "NA", "unknown"],
    seeAlso: ["tier"],
    tone: "concept" }),

  // ── Warehouse fleet chrome ──
  ui({
    id: "ui.warehouse.coverage",
    label: "Coverage",
    description: "Data completeness badge: Kalshi-only, Polymarket-only, or hybrid.",
    category: "warehouse",
    mapsTo: "coverage",
    synonyms: ["venues", "sources"],
    seeAlso: ["coverage", "multi_venue", "ui.warehouse.poly_link"],
    tone: "concept" }),
  ui({
    id: "ui.warehouse.poly_link",
    label: "Poly",
    description: "Polymarket market link status: linked or unlinked.",
    category: "warehouse",
    synonyms: ["polymarket", "gamma", "matched"],
    seeAlso: ["poly_mid", "poly_volume", "ui.warehouse.coverage"],
    tone: "concept" }),
  ui({
    id: "ui.warehouse.event_status",
    label: "Event status",
    description: "Match lifecycle: Scheduled, Live, or Ended.",
    category: "warehouse",
    synonyms: ["status", "state"],
    seeAlso: ["ui.events.filter.when", "ui.live_board.title"],
    tone: "concept" }),
  ui({
    id: "ui.warehouse.fleet_count",
    label: "Events",
    description: "Number of matches in the current filtered view.",
    category: "ui",
    synonyms: ["count", "N events", "fleet"],
    unit: "count",
    seeAlso: ["ui.warehouse.fleet_volume"],
    tone: "concept" }),
  ui({
    id: "ui.warehouse.fleet_volume",
    label: "Total volume",
    description: "Aggregated volume across the filtered match set.",
    category: "market",
    mapsTo: "total_volume_usd",
    synonyms: ["volume", "X total vol"],
    unit: "usd",
    seeAlso: ["total_volume_usd", "ui.warehouse.fleet_count"],
    tone: "concept" }),

  // ── Composite concepts (semantic targets for mapsTo; not tip keys) ──
  {
    id: "composite.scanner",
    kind: "composite",
    label: "Scanner signal",
    description: "Abstract scanner / divergence-alert concept used by live board UI.",
    category: "model",
    seeAlso: ["ui.live_board.scanner", "composite.divergence", "alert.divergence"],
    tone: "concept" },
  {
    id: "composite.divergence",
    kind: "composite",
    label: "Price divergence",
    description: "Abstract market-vs-model divergence concept.",
    category: "model",
    unit: "cents",
    seeAlso: ["ui.live_board.divergence", "alert.divergence", "eff_edge"],
    tone: "concept" },
  {
    id: "composite.edge_score",
    kind: "composite",
    label: "Edge score",
    description: "Abstract composite edge strength concept.",
    category: "model",
    seeAlso: ["ui.live_board.edge_score", "eff_edge", "surfaceEdge"],
    tone: "concept" },
  {
    id: "composite.model_suspect",
    kind: "composite",
    label: "Model suspect",
    description: "Abstract model-trust flag concept.",
    category: "model",
    seeAlso: ["ui.live_board.model_suspect", "elo_source"],
    tone: "concept" },

  // ── Pipeline & alerts (composite concepts — not desk CSV columns) ──
  {
    id: "alert.poly_dropout",
    kind: "composite",
    label: "Poly Dropout",
    description: "kalshiOnly % exceeds threshold (>30% default) for N logger cycles. Polymarket matching failing.",
    category: "pipeline",
    values: ["CRITICAL: kalshiOnly/total > poly-dropout-pct for poly-dropout-ticks"],
    resolveValues: ["kalshiOnly/total ≤ poly-dropout-pct"],
    resolveLabel: "Poly Dropout — Resolved",
    seeAlso: ["alert.feed_frozen", "alert.volume_gap", "alert.delivery", "alert.severity"],
    status: "active",
    unit: "pct",
    tone: "alert",
  },
  {
    id: "alert.volume_gap",
    kind: "composite",
    label: "Volume Gap",
    description: "midOnly exceeds threshold (>10 default) for N cycles. Many mids but zero volume — stale volume_fp.",
    category: "pipeline",
    values: ["WARNING: midOnly > volume-gap-count for volume-gap-ticks"],
    resolveValues: ["midOnly ≤ volume-gap-count"],
    resolveLabel: "Volume Gap — Resolved",
    seeAlso: ["alert.poly_dropout", "alert.feed_frozen", "kalshi_volume"],
    status: "active",
    unit: "count",
    added: "2026-07-30",
    tone: "alert" },
  {
    id: "alert.feed_frozen",
    kind: "composite",
    label: "Poly Feed Frozen",
    description: "polyMatched=0 for N consecutive cycles. Polymarket feed completely frozen.",
    category: "pipeline",
    values: ["CRITICAL: polyMatched=0 for feed-frozen-ticks"],
    resolveValues: ["polyMatched > 0"],
    resolveLabel: "Poly Frozen — Resolved",
    seeAlso: ["alert.poly_dropout", "alert.volume_gap", "alert.stale_feed"],
    status: "active",
    unit: "count",
    added: "2026-07-30",
    tone: "alert" },
  {
    id: "alert.stale_feed",
    kind: "composite",
    label: "Feed Stale",
    description: "No snapshots within staleness-threshold-ms (120s). Logger stuck or crashed.",
    category: "pipeline",
    values: ["CRITICAL: no snapshot within staleness-threshold-ms"],
    resolveValues: ["logger cycle succeeds (reaches this code path)"],
    resolveLabel: "Feed Stale — Resolved",
    seeAlso: ["alert.feed_frozen", "alert.delivery", "alert.severity"],
    status: "active",
    unit: "ms",
    added: "2026-07-30",
    tone: "alert" },
  {
    id: "alert.divergence",
    kind: "composite",
    label: "Price Divergence",
    description: "Kalshi mid deviates from Poly implied prob > divergence-cents (15¢). Cross-venue mispricing.",
    category: "pipeline",
    values: ["INFO: |kalshiMid - polyProb×100| > divergence-cents"],
    resolveValues: ["manual only — no auto-resolution"],
    seeAlso: ["kalshi_mu", "poly_mid", "arb_hint", "alert.severity"],
    status: "active",
    unit: "cents",
    added: "2026-07-30",
    tone: "alert" },
  {
    id: "alert.resolution",
    kind: "composite",
    label: "Alert Resolution",
    description: "Auto-sent when active alert clears. Includes duration, replies original, clears debounce.",
    category: "pipeline",
    values: ["stale_feed_resolved", "poly_dropout_resolved", "volume_gap_resolved", "poly_feed_frozen_resolved"],
    seeAlso: ["alert.stale_feed", "alert.poly_dropout", "alert.volume_gap", "alert.feed_frozen"],
    status: "active",
    added: "2026-07-30",
    tone: "alert" },
  {
    id: "alert.delivery",
    kind: "composite",
    label: "Alert Delivery",
    description: "Telegram (HTML, threaded, keyboard CRITICAL), Discord/Slack webhook, console stderr.",
    category: "pipeline",
    values: ["telegram", "discord", "console"],
    seeAlso: ["alert.severity", "alert.stale_feed"],
    status: "active",
    added: "2026-07-30",
    tone: "alert" },
  {
    id: "alert.severity",
    kind: "composite",
    label: "Alert Severity",
    description: "CRITICAL: feed down (keyboard). WARNING: degraded. INFO: informational, silent.",
    category: "pipeline",
    values: ["CRITICAL", "WARNING", "INFO"],
    seeAlso: ["alert.poly_dropout", "alert.volume_gap", "alert.feed_frozen", "alert.stale_feed", "alert.divergence", "alert.delivery"],
    status: "active",
    added: "2026-07-30",
    tone: "alert" },

  // ── Design system ──
  {
    id: "ops.palette",
    kind: "ui",
    label: "Color Palette",
    description: "Venue and domain colors with WCAG contrast audited. SSOT: src/lib/color/. See docs/COLORS.md + public/registry/color-system.json.",
    category: "ui",
    seeAlso: ["alert.delivery"],
    status: "active",
    url: "https://bun.com/docs/runtime/color",
    color: "env",
    // design-system chrome — not a desk CSV column (tone ≠ registry)
    tone: "concept",
  },

  // KPI dashboard cards (ui kind)
  { id: "kpi.open_matches", kind: "ui", label: "Open matches", description: "Count of active Kalshi events with tradable markets and non-crossed books.", category: "pipeline", color: "tennis" , tone: "metric" },
  { id: "kpi.board_volume", kind: "ui", label: "Board volume", description: "Sum of 24-hour trading volume across all live board markets in USD.", category: "pipeline", mapsTo: "total_volume_usd" , color: "kalshi" , tone: "metric" },
  { id: "kpi.store_link_rate", kind: "ui", label: "Store link rate", description: "Percentage of events successfully enriched with cross-market odds from Polymarket and Pinnacle.", category: "pipeline" , color: "env" , tone: "metric" },
  { id: "kpi.book_watches", kind: "ui", label: "Book watches", description: "Count of events with active WebSocket book price monitoring.", category: "pipeline" , color: "polymarket" , tone: "metric" },
  { id: "kpi.player_profiles", kind: "ui", label: "Player profiles", description: "Number of players with computed Elo ratings and player profiles in the index.", category: "warehouse" , color: "tennis" , tone: "metric" },
  { id: "kpi.live_scores", kind: "ui", label: "Live scores", description: "Count of events currently receiving live score updates from the ITF Stadion feed.", category: "pipeline" , color: "tennis" , tone: "metric" },
  { id: "kpi.rps_warnings", kind: "ui", label: "RPS warnings", description: "Count of events flagged with RPS (price-smoothed) anomaly warnings on the live board.", category: "pipeline", mapsTo: "rps_flag" , color: "trading" , tone: "metric" },
  { id: "kpi.graph_divergence", kind: "ui", label: "Graph divergence", description: "Count of events where Elo or odds graph signal deviates from market mid price beyond threshold.", category: "pipeline", mapsTo: "graph_divergence" , color: "trading" , tone: "metric" },
  { id: "kpi.elite_conviction", kind: "ui", label: "Elite conviction", description: "Maximum legacy conviction edge score retained for dashboard compatibility; use effective edge for current decisions.", category: "pipeline", mapsTo: "eff_edge", status: "deprecated", deprecatedBy: "eff_edge" , color: "misc" , tone: "metric" },
  { id: "kpi.price_archive", kind: "ui", label: "Price archive", description: "Count of price snapshots stored in the archive table.", category: "warehouse" , color: "misc" , tone: "metric" },
  { id: "kpi.archive_elo_fair", kind: "ui", label: "Archive Elo fair", description: "Count of price snapshot rows with Elo fair probability populated.", category: "warehouse" , color: "misc" , tone: "metric" },
  { id: "kpi.server_errors", kind: "ui", label: "Server errors", description: "Count of logger error events recorded in the last 24 hours.", category: "pipeline" , color: "trading" , tone: "metric" },
  { id: "kpi.top_edge", kind: "ui", label: "Top edge", description: "Maximum effective edge observed across all live board events.", category: "pipeline", mapsTo: "eff_edge" , color: "research" , tone: "metric" },
  { id: "kpi.median_spread", kind: "ui", label: "Median spread", description: "Median bid-ask spread across all live board events in cents.", category: "market", mapsTo: "kalshi_spread" , color: "research" , tone: "metric" },
  { id: "kpi.tight_markets", kind: "ui", label: "Tight markets", description: "Count of match_liquidity rows with liquidity_ok (volume + tight non-empty book).", category: "market", mapsTo: "liquidity_ok" , color: "tennis" , tone: "metric" },
  { id: "kpi.tradable_matches", kind: "ui", label: "Tradable matches", description: "Count of match_liquidity rows with desk.tradable (liquidity_ok + mid band).", category: "market", mapsTo: "desk.tradable" , color: "tennis" , tone: "metric" },
  // Derived KPI (no mapsTo alias — count of non-empty books, not a single registry column)
  { id: "kpi.quoted_books", kind: "ui", label: "Quoted books", description: "Count of events with a non-empty top-of-book quote in match_liquidity.", category: "market", color: "kalshi" , tone: "metric" },
  { id: "kpi.scanner_alerts", kind: "ui", label: "Scanner alerts", description: "Count of active price divergence scanner flags on the live board.", category: "pipeline", mapsTo: "ui.live_board.scanner" , color: "middleware" , tone: "metric" },

  // ── Partner-ops taxonomy (factory mirror; soft ledger stays in ct) ──
  // ColorKeys use the real COLORS palette (tennis/middleware/trading/misc/… —
  // not tennisGreen/neutralGray/poly aliases). category stays pipeline|trading|ui
  // (there is no GlossaryCategory "ops"; ops.palette itself is category "ui").
  {
    id: "partner.phase.operator_ready",
    kind: "ui",
    label: "Operator ready",
    description: "Partner cleared for live trading — handshake complete, operator can run desk.",
    category: "pipeline",
    color: "tennis",
    status: "active",
    synonyms: ["ready", "live", "operator ready"],
    seeAlso: ["partner.phase.onboarding", "partner.phase.incomplete", "partner.phase.paused"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "partner.phase.onboarding",
    kind: "ui",
    label: "Onboarding",
    description: "Partner in setup flow — CODE registered or forum wiring in progress.",
    category: "pipeline",
    color: "middleware",
    status: "active",
    synonyms: ["onboarding", "forum_ready", "designated"],
    seeAlso: ["partner.phase.operator_ready", "partner.phase.incomplete"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "partner.phase.incomplete",
    kind: "ui",
    label: "Incomplete",
    description: "Partner setup missing required fields or blocked gates.",
    category: "pipeline",
    color: "trading",
    status: "active",
    synonyms: ["incomplete", "blocked"],
    seeAlso: ["partner.phase.onboarding", "partner.phase.operator_ready"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "partner.phase.paused",
    kind: "ui",
    label: "Paused",
    description: "Partner temporarily suspended — no FUND pressure.",
    category: "pipeline",
    color: "misc",
    status: "active",
    synonyms: ["paused"],
    seeAlso: ["partner.phase.operator_ready", "out.status.paused"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "book.type.legal",
    kind: "ui",
    label: "Legal book",
    description: "State-licensed / US-regulated sportsbook.",
    category: "trading",
    color: "kalshi",
    status: "active",
    synonyms: ["legal book", "US book", "legal-us", "Legal US"],
    seeAlso: ["book.type.offshore", "book.type.pph", "book.type.crypto"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "book.type.offshore",
    kind: "ui",
    label: "Offshore book",
    description: "Non-US regulated retail sportsbook.",
    category: "trading",
    color: "polymarket",
    status: "active",
    synonyms: ["offshore book"],
    seeAlso: ["book.type.legal", "book.type.pph"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "book.type.pph",
    kind: "ui",
    label: "PPH desk",
    description: "Pay-per-head bookmaking service.",
    category: "trading",
    color: "pinnacle",
    status: "active",
    synonyms: ["PPH", "pay per head"],
    seeAlso: ["book.type.offshore", "book.type.legal"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "book.type.crypto",
    kind: "ui",
    label: "Crypto book",
    description: "Cryptocurrency-accepting / crypto-settled sportsbook.",
    category: "trading",
    color: "middleware",
    status: "active",
    synonyms: ["crypto book", "crypto"],
    seeAlso: ["book.type.offshore", "deposit.method.crypto"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "deposit.method.venmo",
    kind: "ui",
    label: "Venmo",
    description: "Venmo peer-to-peer transfer funding rail.",
    category: "trading",
    color: "trading",
    status: "active",
    synonyms: ["Venmo"],
    seeAlso: ["deposit.method.crypto", "deposit.method.wire", "accounting.deposit"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "deposit.method.crypto",
    kind: "ui",
    label: "Crypto",
    description: "Cryptocurrency transfer funding rail.",
    category: "trading",
    color: "tennis",
    status: "active",
    synonyms: ["crypto rail", "BTC", "USDC"],
    seeAlso: ["book.type.crypto", "deposit.method.venmo", "accounting.deposit"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "deposit.method.wire",
    kind: "ui",
    label: "Wire transfer",
    description: "Bank wire transfer funding rail.",
    category: "trading",
    color: "kalshi",
    status: "active",
    synonyms: ["wire", "bank wire"],
    seeAlso: ["deposit.method.credit", "accounting.deposit"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "deposit.method.credit",
    kind: "ui",
    label: "Credit line",
    description: "Seat-extended / house credit line (not a cash deposit).",
    category: "trading",
    color: "research",
    status: "active",
    synonyms: ["credit line", "house credit"],
    seeAlso: ["accounting.credit", "deposit.method.wire"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "out.status.ready",
    kind: "ui",
    label: "Ready",
    description: "Out active and accepting bets.",
    category: "pipeline",
    color: "tennis",
    status: "active",
    synonyms: ["out ready", "ready"],
    seeAlso: ["out.status.deferred", "out.status.paused", "partner.phase.operator_ready"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "out.status.deferred",
    kind: "ui",
    label: "Deferred",
    description: "Out pending activation / warming.",
    category: "pipeline",
    color: "middleware",
    status: "active",
    synonyms: ["deferred out", "warming"],
    seeAlso: ["out.status.ready", "out.status.paused"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "out.status.paused",
    kind: "ui",
    label: "Paused",
    description: "Out temporarily inactive.",
    category: "pipeline",
    color: "misc",
    status: "active",
    synonyms: ["paused out"],
    seeAlso: ["out.status.deferred", "partner.phase.paused"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "accounting.deposit",
    kind: "composite",
    label: "Deposit received",
    description: "Incoming funds confirmed against a funding target.",
    category: "trading",
    color: "tennis",
    unit: "usd",
    status: "active",
    synonyms: ["deposit received", "DEPOSIT_RECEIVED"],
    seeAlso: ["accounting.credit", "accounting.free_roll", "deposit.method.venmo"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "accounting.withdrawal",
    kind: "composite",
    label: "Withdrawal processed",
    description: "Outgoing funds sent.",
    category: "trading",
    color: "trading",
    unit: "usd",
    status: "active",
    synonyms: ["withdrawal", "cashout"],
    seeAlso: ["accounting.deposit", "accounting.settlement"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "accounting.credit",
    kind: "composite",
    label: "Credit extended",
    description: "Credit line issued to partner.",
    category: "trading",
    color: "kalshi",
    unit: "usd",
    status: "active",
    synonyms: ["credit extended", "CREDIT_EXTENDED"],
    seeAlso: ["accounting.deposit", "deposit.method.credit"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "accounting.free_roll",
    kind: "composite",
    label: "Free-roll applied",
    description: "Risk-free stake / freeplay percent applied.",
    category: "trading",
    color: "research",
    unit: "pct",
    status: "active",
    synonyms: ["free-roll", "freeplay", "FREE_ROLL_APPLIED", "FP%"],
    seeAlso: ["accounting.deposit", "out.status.ready"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "accounting.settlement",
    kind: "composite",
    label: "Settlement confirmed",
    description: "Bet settled, funds moved — factory mirror event only.",
    category: "trading",
    color: "polymarket",
    unit: "usd",
    status: "active",
    synonyms: ["settlement", "SETTLEMENT_PROCESSED"],
    seeAlso: ["accounting.deposit", "accounting.withdrawal"],
    tone: "concept",
    added: "2026-07-31",
  },
  {
    id: "event.partner.registered",
    kind: "composite",
    label: "Partner registered",
    description: "Factory mirror: partner CODE registered (onboarding).",
    category: "pipeline",
    color: "middleware",
    status: "active",
    synonyms: ["PARTNER_REGISTERED"],
    seeAlso: ["partner.phase.onboarding", "event.partner.phase_change"],
    tone: "alert",
    added: "2026-07-31",
  },
  {
    id: "event.partner.phase_change",
    kind: "composite",
    label: "Partner phase change",
    description: "Factory mirror: partner lifecycle phase changed.",
    category: "pipeline",
    color: "tennis",
    status: "active",
    synonyms: ["PARTNER_PHASE_CHANGE"],
    seeAlso: ["partner.phase.operator_ready", "event.partner.registered"],
    tone: "alert",
    added: "2026-07-31",
  },
  {
    id: "event.out.created",
    kind: "composite",
    label: "Out created",
    description: "Factory mirror: new out row created on the seat desk.",
    category: "pipeline",
    color: "tennis",
    status: "active",
    synonyms: ["OUT_CREATED"],
    seeAlso: ["out.status.ready", "event.out.status_change"],
    tone: "alert",
    added: "2026-07-31",
  },
  {
    id: "event.out.status_change",
    kind: "composite",
    label: "Out status change",
    description: "Factory mirror: out status transitioned.",
    category: "pipeline",
    color: "middleware",
    status: "active",
    synonyms: ["OUT_STATUS_CHANGE"],
    seeAlso: ["out.status.deferred", "event.out.created"],
    tone: "alert",
    added: "2026-07-31",
  },
  {
    id: "event.deposit.received",
    kind: "composite",
    label: "Deposit received event",
    description: "Factory mirror: deposit confirmed (soft ledger stays in ct).",
    category: "trading",
    color: "tennis",
    unit: "usd",
    status: "active",
    synonyms: ["DEPOSIT_RECEIVED"],
    seeAlso: ["accounting.deposit", "event.deposit.allocated"],
    tone: "alert",
    added: "2026-07-31",
  },
  {
    id: "event.deposit.allocated",
    kind: "composite",
    label: "Deposit allocated",
    description: "Factory mirror: deposit allocated to an out / rail.",
    category: "trading",
    color: "kalshi",
    unit: "usd",
    status: "active",
    synonyms: ["DEPOSIT_ALLOCATED"],
    seeAlso: ["accounting.deposit", "event.deposit.received"],
    tone: "alert",
    added: "2026-07-31",
  },
  {
    id: "event.credit.extended",
    kind: "composite",
    label: "Credit extended event",
    description: "Factory mirror: credit line extended.",
    category: "trading",
    color: "kalshi",
    unit: "usd",
    status: "active",
    synonyms: ["CREDIT_EXTENDED"],
    seeAlso: ["accounting.credit", "event.deposit.received"],
    tone: "alert",
    added: "2026-07-31",
  },
  {
    id: "event.free_roll.applied",
    kind: "composite",
    label: "Free-roll applied event",
    description: "Factory mirror: free-roll / freeplay applied.",
    category: "trading",
    color: "research",
    unit: "pct",
    status: "active",
    synonyms: ["FREE_ROLL_APPLIED"],
    seeAlso: ["accounting.free_roll", "event.deposit.received"],
    tone: "alert",
    added: "2026-07-31",
  },
  {
    id: "event.settlement.processed",
    kind: "composite",
    label: "Settlement processed",
    description: "Factory mirror: settlement confirmed.",
    category: "trading",
    color: "polymarket",
    unit: "usd",
    status: "active",
    synonyms: ["SETTLEMENT_PROCESSED"],
    seeAlso: ["accounting.settlement", "event.deposit.received"],
    tone: "alert",
    added: "2026-07-31",
  },
  {
    id: "event.telegram.invite_sent",
    kind: "composite",
    label: "Telegram invite sent",
    description: "Factory mirror: Telegram invite dispatched for partner forum.",
    category: "pipeline",
    color: "middleware",
    status: "active",
    synonyms: ["TELEGRAM_INVITE_SENT"],
    seeAlso: ["event.telegram.message_pinned", "partner.phase.onboarding"],
    tone: "alert",
    added: "2026-07-31",
  },
  {
    id: "event.telegram.message_pinned",
    kind: "composite",
    label: "Telegram message pinned",
    description: "Factory mirror: Telegram message pinned (desk home / accounting).",
    category: "pipeline",
    color: "tennis",
    status: "active",
    synonyms: ["TELEGRAM_MESSAGE_PINNED"],
    seeAlso: ["event.telegram.invite_sent", "accounting.deposit"],
    tone: "alert",
    added: "2026-07-31",
  },
] as const;

/** Which glossary concepts appear on each page/surface. */
export const PAGE_SURFACES = {
  /** HQ dashboard — live tennis board + KPI cards */
  hq: [
    "kpi.open_matches", "kpi.board_volume", "kpi.store_link_rate",
    "kpi.book_watches", "kpi.player_profiles", "kpi.live_scores",
    "kpi.rps_warnings", "kpi.graph_divergence",
    "kpi.price_archive", "kpi.archive_elo_fair", "kpi.server_errors",
    "kpi.top_edge", "kpi.median_spread", "kpi.tight_markets", "kpi.tradable_matches", "kpi.quoted_books", "kpi.scanner_alerts",
    "kpi.elite_conviction", // deprecated, kept for backward audit compat
    "kalshi_mu", "kalshi_spread", "kalshi_volume",
    "poly_mid", "poly_volume",
    "elo_prob", "eff_edge", "rps_flag", "graph_divergence",
    "liquidity_ok", "desk.tradable", "total_volume_usd",
    "ops.palette",
  ],
  /** Ops dashboard */
  ops: [
    "ops.palette",
    // Desk liquidity (HQ chips + /api/liquidity + partners payload)
    "liquidity_ok", "desk.tradable", "kalshi_spread", "kalshi_volume",
    "kpi.tight_markets", "kpi.tradable_matches", "kpi.quoted_books",
    "alert.poly_dropout", "alert.volume_gap", "alert.feed_frozen",
    "alert.stale_feed", "alert.divergence",
    "alert.resolution", "alert.delivery", "alert.severity",
    // Partner-ops taxonomy (Telegram topic leaves stay on FactoryWager telegram glossary)
    "partner.phase.operator_ready", "partner.phase.onboarding",
    "partner.phase.incomplete", "partner.phase.paused",
    "book.type.legal", "book.type.offshore", "book.type.pph", "book.type.crypto",
    "deposit.method.venmo", "deposit.method.crypto", "deposit.method.wire", "deposit.method.credit",
    "out.status.ready", "out.status.deferred", "out.status.paused",
    "accounting.deposit", "accounting.withdrawal", "accounting.credit",
    "accounting.free_roll", "accounting.settlement",
    "event.partner.registered", "event.partner.phase_change",
    "event.out.created", "event.out.status_change",
    "event.deposit.received", "event.deposit.allocated",
    "event.credit.extended", "event.free_roll.applied",
    "event.settlement.processed",
    "event.telegram.invite_sent", "event.telegram.message_pinned",
  ],
} as const satisfies Record<string, readonly string[]>;

export type PageSurface = keyof typeof PAGE_SURFACES;

/** Reverse lookup: which surfaces does a concept appear on? */
export function conceptSurfaces(id: string): PageSurface[] {
  return (Object.entries(PAGE_SURFACES) as [PageSurface, readonly string[]][])
    .filter(([, ids]) => ids.includes(id))
    .map(([surface]) => surface);
}

// ── Tone rendering styles ──────────────────────────────────────

export type ToneStyle = {
  label: string;
  badge: string;        // emoji prefix
  weight: "heavy" | "medium" | "light";
  align: "left" | "center" | "right";
};

export const TONES: Record<string, ToneStyle> = {
  metric:   { label: "Metric",   badge: "📊", weight: "heavy",  align: "right" },
  alert:    { label: "Alert",    badge: "🚨", weight: "heavy",  align: "left" },
  registry: { label: "Registry", badge: "📋", weight: "medium", align: "left" },
  concept:  { label: "Concept",  badge: "💡", weight: "light",  align: "left" },
} as const;

export function toneStyle(entry: GlossaryEntry | undefined): ToneStyle {
  return TONES[entry?.tone ?? ""] ?? TONES.concept;
}

/** Which surfaces does this entry appear on? (derived from PAGE_SURFACES) */
export function surfacesFor(id: string): PageSurface[] {
  return conceptSurfaces(id);
}

// ── Render context (all metadata in one call) ──────────────────

/** Resolved color blob for wire / browser (pre-computed; no Bun.color in client). */
export type GlossaryWireColor = {
  key: ColorKey;
  css: string;
  foregroundCss: "#000000" | "#ffffff";
};

export type RenderContext = {
  entry: GlossaryEntry | undefined;
  tone: ToneStyle;
  color: string | number | null;
  /** Kernel-resolved CSS + foreground for badges / KPI chips */
  resolvedColor: GlossaryWireColor | null;
  surfaces: PageSurface[];
};

/** Single call for all rendering metadata: entry + tone + color + surfaces. */
export function renderContext(id: string, colorFormat?: string): RenderContext {
  const entry = getGlossaryEntry(id);
  return {
    entry,
    tone: toneStyle(entry),
    color: glossaryColor(entry, colorFormat),
    resolvedColor: resolveGlossaryWireColor(entry),
    surfaces: surfacesFor(id),
  };
}

export type { GlossaryId, RegistryId, UiId, CompositeId } from "../generated/glossary-ids.ts";

/** Flat tip map for HQ (backward compatible with tip(key) consumers). */
export const TOOLTIPS: Record<string, string> = Object.fromEntries(
  GLOSSARY_ENTRIES.map((e) => [e.id, e.description]),
);

export type TooltipKey = keyof typeof TOOLTIPS;

export function getGlossaryEntry(id: string): GlossaryEntry | undefined {
  return GLOSSARY_ENTRIES.find((e) => e.id === id);
}

/**
 * Resolve a glossary entry's color to any Bun.color output format.
 * Uses the entry's color (ColorKey) and colorFormat (default "hex").
 *
 *   glossaryColor(getGlossaryEntry("kpi.rps_warnings"), "ansi")
 *   → "\x1b[38;2;231;76;60m"   (trading red, auto-detect depth)
 *
 * Prefer `resolveGlossaryWireColor` for API / browser wire (css + foreground).
 */
export function glossaryColor(
  entry: GlossaryEntry | undefined,
  format?: string,
): string | number | null {
  if (!entry?.color || !isColorKey(entry.color)) return null;
  const hex = COLORS[entry.color];
  return Bun.color(hex, (format ?? entry.colorFormat ?? "hex") as "hex");
}

/** Pre-compute CSS + accessible foreground for a glossary entry (server-side). */
export function resolveGlossaryWireColor(
  entry: GlossaryEntry | undefined,
): GlossaryWireColor | null {
  if (!entry?.color || !isColorKey(entry.color)) return null;
  return {
    key: entry.color,
    css: cssColor(entry.color),
    foregroundCss: foregroundCss(entry.color),
  };
}

export function glossaryEntriesByCategory(): Map<GlossaryCategory, GlossaryEntry[]> {
  const map = new Map<GlossaryCategory, GlossaryEntry[]>();
  for (const e of GLOSSARY_ENTRIES) {
    const list = map.get(e.category) ?? [];
    list.push(e);
    map.set(e.category, list);
  }
  return map;
}

/**
 * Closed-set board filters — every id must declare `values[]` (audit via glossary:check).
 * Array of concept ids (not a map) — single write path for board dropdowns.
 */
export const FILTER_CATALOG_IDS = [
  "league",
  "surface",
  "tier",
  "ui.events.filter.when",
  "ui.events.filter.liquidity",
  "ui.sort.events",
] as const;

export type FilterCatalogId = (typeof FILTER_CATALOG_IDS)[number];

/**
 * Pending registry concepts (board/HQ filters) not yet on desk CSV columns[].
 * Keep until desk export schema gains tier/round columns — integrity allowlist only.
 * @see docs/SEMANTIC_LAYER.md (pending registry)
 */
export const PENDING_REGISTRY_CONCEPTS = ["tier", "round"] as const;

export type FilterCatalogEntry = {
  label: string;
  values: readonly string[];
  valueLabels: Record<string, string>;
};

/**
 * Wire shape for one glossary concept (API `concepts[]` / dump `concepts[]`).
 * Always an array element with stable `id` — never a bare map value without id.
 */
export type GlossaryConceptRecord = {
  id: string;
  label: string;
  description: string;
  category: GlossaryCategory;
  kind: GlossaryKind;
  mapsTo: string | null;
  synonyms: string[];
  values: string[] | null;
  valueLabels: Record<string, string> | null;
  seeAlso: string[];
  status: GlossaryStatus;
  deprecatedBy: string | null;
  unit: UnitKey | null;
  /**
   * Resolved semantic color (kernel-precomputed). Browser clients use css /
   * foregroundCss — never call Bun.color in the HQ bundle.
   */
  color: GlossaryWireColor | null;
  /** Optional docs / product URL when the entry declares one */
  url: string | null;
};

/** Ordered concept array — SSOT list for agents, API, dump. */
export function listConcepts(): GlossaryConceptRecord[] {
  return GLOSSARY_ENTRIES.map((e) => ({
    id: e.id,
    label: e.label,
    description: e.description,
    category: e.category,
    kind: e.kind,
    mapsTo: e.mapsTo ?? null,
    synonyms: e.synonyms ?? [],
    values: e.values ?? null,
    valueLabels: e.valueLabels ?? null,
    seeAlso: e.seeAlso ?? [],
    status: (e.status ?? "active") as GlossaryStatus,
    deprecatedBy: e.deprecatedBy ?? null,
    unit: e.unit ?? null,
    color: resolveGlossaryWireColor(e),
    url: e.url ?? null,
  }));
}

/** O(1) index over `listConcepts()` — secondary to the array. */
export function conceptsById(
  concepts: readonly GlossaryConceptRecord[] = listConcepts(),
): Record<string, GlossaryConceptRecord> {
  return Object.fromEntries(concepts.map((c) => [c.id, c]));
}

/** Kind → concept id arrays (browse / governance). */
export function conceptIdsByKind(
  concepts: readonly GlossaryConceptRecord[] = listConcepts(),
): Record<GlossaryKind, string[]> {
  const out: Record<GlossaryKind, string[]> = {
    registry: [],
    ui: [],
    composite: [],
  };
  for (const c of concepts) {
    out[c.kind].push(c.id);
  }
  return out;
}

/** Closed-set catalogs for board filters — single write path via glossary `values`. */
export function buildFilterCatalog(): Record<string, FilterCatalogEntry> {
  const filterCatalog: Record<string, FilterCatalogEntry> = {};
  for (const id of FILTER_CATALOG_IDS) {
    const e = getGlossaryEntry(id);
    if (e) {
      filterCatalog[id] = {
        label: e.label,
        values: e.values ?? [],
        valueLabels: e.valueLabels ?? {},
      };
    }
  }
  return filterCatalog;
}

/**
 * Payload for GET /api/glossary — panel + tips + codes.
 * schemaVersion 5: concepts[] include resolved `color` ({ key, css, foregroundCss }).
 */
export function buildGlossaryApiPayload() {
  const concepts = listConcepts();
  return {
    schemaVersion: 5,
    tooltips: TOOLTIPS,
    /** Primary ordered concept array (id on every element). */
    concepts,
    /**
     * @deprecated alias of `concepts` — keep for HQ clients that read `entries`
     */
    entries: concepts,
    /** Concept id arrays by structural kind */
    conceptIdsByKind: conceptIdsByKind(concepts),
    /** Board filter concept ids (must have values[]) */
    filterConceptIds: [...FILTER_CATALOG_IDS],
    /** Registry-kind ids not yet on desk columns */
    pendingRegistryConcepts: [...PENDING_REGISTRY_CONCEPTS],
    /** Closed-set filter catalogs (single write path for board dropdowns) */
    filterCatalog: buildFilterCatalog(),
    categories: (Object.keys(GLOSSARY_CATEGORY_LABELS) as GlossaryCategory[]).map((id) => ({
      id,
      label: GLOSSARY_CATEGORY_LABELS[id],
    })),
    statuses: [...GLOSSARY_STATUSES],
    codes: CODES,
    units: UNITS,
  };
}

// ── Resolution helpers (filter enums / UI labels) ──

/** Human label for a concept id (falls back to fallback, then id). */
export function resolveLabel(id: string, fallback?: string): string {
  return getGlossaryEntry(id)?.label ?? fallback ?? id;
}

/** One-line meaning (description) for tooltips / panel. */
export function resolveSummary(id: string): string | undefined {
  return getGlossaryEntry(id)?.description;
}

/**
 * Closed value list for enum-like concepts (filter options).
 * Empty if the concept is free-text (tournament names, etc.).
 */
export function resolveValues(id: string): readonly string[] {
  return getGlossaryEntry(id)?.values ?? [];
}

/**
 * Order live option values using glossary closed-set order when present.
 * Values not in the glossary list append alphabetically (or keep input order).
 *
 * @param conceptId glossary id with optional `values`
 * @param live live distinct values from the board
 * @returns ordered unique list for select options (excludes empty/all)
 */
export function orderChoicesByGlossary(
  conceptId: string,
  live: readonly string[],
): string[] {
  const preferred = resolveValues(conceptId);
  const set = new Set(live.filter(Boolean));
  const out: string[] = [];
  for (const v of preferred) {
    if (set.has(v)) {
      out.push(v);
      set.delete(v);
    }
  }
  const rest = [...set].sort((a, b) => a.localeCompare(b));
  return [...out, ...rest];
}

/**
 * Build select choice pairs for a glossary-backed filter.
 * Uses `valueLabels` when present. Prefixes `["", "all"]` only when the
 * closed set does **not** already include an `"all"` code (when/liquidity do).
 */
export function glossaryFilterChoices(
  conceptId: string,
  live: readonly string[],
): Array<[string, string]> {
  const entry = getGlossaryEntry(conceptId);
  const preferred = entry?.values ?? [];
  const labels = entry?.valueLabels ?? {};
  const ordered = orderChoicesByGlossary(conceptId, live);
  const pairs = ordered.map((v) => [v, labels[v] ?? v] as [string, string]);
  if (preferred.includes("all") || ordered.includes("all")) {
    return pairs;
  }
  return [["", "all"], ...pairs];
}

/** Display label for one value code of a concept (falls back to the code). */
export function resolveValueLabel(conceptId: string, value: string): string {
  const entry = getGlossaryEntry(conceptId);
  return entry?.valueLabels?.[value] ?? value;
}

/** Lifecycle status (omit on entry → active). */
export function resolveStatus(id: string): GlossaryStatus {
  return getGlossaryEntry(id)?.status ?? "active";
}

/** Unit key for chart/export consumers (undefined if free-form / categorical). */
export function resolveUnit(id: string): UnitKey | undefined {
  return getGlossaryEntry(id)?.unit;
}

/** Human unit convention string from UNITS. */
export function resolveUnitDescription(id: string): string | undefined {
  const unit = resolveUnit(id);
  return unit ? UNITS[unit] : undefined;
}

/** Related term ids for panel discoverability. */
export function resolveSeeAlso(id: string): readonly string[] {
  return getGlossaryEntry(id)?.seeAlso ?? [];
}

export function isActiveConcept(id: string): boolean {
  return resolveStatus(id) === "active";
}

export function isGlossaryUnit(value: string): value is UnitKey {
  return Object.prototype.hasOwnProperty.call(UNITS, value);
}
