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

// ── Unit conventions ──

export const UNITS = {
  cents: "integer cents, 1–99 for prices; canonical money unit everywhere",
  dollarsFp: "fixed-point dollar string e.g. \"0.5600\" — wire only, parse via dollarsToCents",
  countFp: "fixed-point contract string e.g. \"10.00\" — fractional flagged, not orderable",
  atMs: "epoch milliseconds — canonical time unit (suffix AtMs)",
  unixSec: "unix seconds — wire only (updated_ts, ts); multiply by 1000 at boundary",
} as const;

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
  }),
  ui({
    id: "spreadCents",
    label: "Spread",
    description: "Best ask − best bid (¢). Wide spreads = poor liquidity; prefer postOnly.",
    category: "market",
    mapsTo: "kalshi_spread",
    synonyms: ["bid-ask", "spread"],
  }),
  ui({
    id: "crossed",
    label: "Crossed book",
    description: "Transient book state (yesBid + noBid > 100). Do not treat mid as tradeable.",
    category: "market",
  }),
  ui({
    id: "avgKalshiVolumeFp",
    label: "Avg volume (Fp)",
    description:
      "Mean resolved Kalshi contract volume over trading appearances (player_profiles). Not poly; not a single-tick kalshi_volume.",
    category: "market",
    mapsTo: "kalshi_volume",
    synonyms: ["avg vol", "volume", "avgKalshiVolume"],
  }),
  ui({
    id: "yesPriceCents",
    label: "Yes price ¢",
    description: "Limit price for YES contracts, 1–99¢. NO price = 100 − yes.",
    category: "market",
  }),

  // ── trading UI ──
  ui({
    id: "balanceCents",
    label: "Balance",
    description:
      "Available-to-trade cash. Does not include value locked in open positions.",
    category: "trading",
  }),
  ui({
    id: "portfolioValueCents",
    label: "Portfolio value",
    description: "Current mark value of all held positions, separate from cash balance.",
    category: "trading",
  }),
  ui({
    id: "position",
    label: "Position",
    description: "Signed contracts: positive = long YES, negative = long NO (Kalshi convention).",
    category: "trading",
  }),
  ui({
    id: "exposureCents",
    label: "Exposure",
    description: "Cash at risk in this market at current marks.",
    category: "trading",
  }),
  ui({
    id: "realizedPnlCents",
    label: "Realized P&L",
    description: "Locked-in profit/loss from closed trades in this market.",
    category: "trading",
  }),
  ui({
    id: "feesPaidCents",
    label: "Fees paid",
    description: "Total exchange fees paid in this market, all time.",
    category: "trading",
  }),
  ui({
    id: "remainingCount",
    label: "Remaining",
    description: "Contracts still working on the book (not yet filled or canceled).",
    category: "trading",
  }),
  ui({
    id: "fillCount",
    label: "Fill count",
    description: "Contracts already executed from this order.",
    category: "trading",
  }),
  ui({
    id: "isTaker",
    label: "Taker",
    description: "True = crossed the spread (taker fee); false = rested on book (maker fee, lower).",
    category: "trading",
  }),
  ui({
    id: "feeCents",
    label: "Fee ¢",
    description: "Exchange fee on this fill. Maker < taker — postOnly orders target maker fees.",
    category: "trading",
  }),
  ui({
    id: "postOnly",
    label: "Post-only",
    description: "Maker-first: order rests on book or is rejected; never crosses the spread.",
    category: "trading",
  }),
  ui({
    id: "dryRun",
    label: "Dry-run",
    description: "Simulated order — no funds move, no API write. Live requires explicit opt-in.",
    category: "trading",
    synonyms: ["dry run", "simulate"],
  }),

  // ── model UI gates ──
  ui({
    id: "shadowMinSignals",
    label: "Shadow min signals",
    description: "Gate: minimum shadow signals before a program may graduate to pilot.",
    category: "model",
  }),
  ui({
    id: "killBrierDriftPct",
    label: "Kill Brier drift %",
    description: "Gate: kill program if Brier score drifts this % above baseline.",
    category: "model",
  }),
  ui({
    id: "graduationMinRealizedEdgeCentsPerFill",
    label: "Graduation edge ¢/fill",
    description: "Gate: realized edge per fill needed for pilot→live.",
    category: "model",
  }),

  // ── tournament (registry-aligned ids — same as desk export features) ──
  reg({
    id: "league",
    label: "League",
    description: "Professional circuit derived from Kalshi series (ATP, WTA, Challenger, ITF).",
    category: "tournament",
    synonyms: ["series", "tour"],
    values: ["ATP", "WTA", "ATP Challenger", "WTA 125", "ITF Men", "ITF Women"],
  }),
  reg({
    id: "surface",
    label: "Surface",
    description: "Court type: Hard, Clay, Grass, Carpet (from event or tournament seed).",
    category: "tournament",
    values: ["Hard", "Clay", "Grass", "Carpet"],
  }),
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
  }),
  reg({
    id: "round",
    label: "Round",
    description: "Match round within the tournament (R16, QF, SF, F, …).",
    category: "tournament",
  }),
  reg({
    id: "series",
    label: "Series",
    description: "Kalshi series ticker family (e.g. KXATPMATCH).",
    category: "tournament",
  }),
  reg({
    id: "gender",
    label: "Gender",
    description: "Competition gender classification on the desk export.",
    category: "tournament",
  }),
  reg({
    id: "age_group",
    label: "Age group",
    description: "Age band when present (junior/senior); often empty on tour.",
    category: "tournament",
  }),

  // ── desk export identity / market / model (registry) ──
  reg({
    id: "match_uuid",
    label: "Match UUID",
    description: "Stable match identity for desk joins.",
    category: "warehouse",
  }),
  reg({
    id: "event_ticker",
    label: "Event ticker",
    description: "Kalshi event ticker (market grouping key).",
    category: "warehouse",
  }),
  reg({
    id: "timestamp",
    label: "Timestamp",
    description: "Snapshot capture time for the desk row.",
    category: "warehouse",
  }),
  reg({
    id: "player_a",
    label: "Player A",
    description: "Side A player display name on the desk row.",
    category: "warehouse",
  }),
  reg({
    id: "player_b",
    label: "Player B",
    description: "Side B player display name on the desk row.",
    category: "warehouse",
  }),
  reg({
    id: "title",
    label: "Title",
    description: "Match / event title string on the desk export.",
    category: "warehouse",
  }),
  reg({
    id: "kalshi_mu",
    label: "Kalshi µ",
    description: "Kalshi mid (implied probability cents) on the desk snapshot.",
    category: "market",
    synonyms: ["kalshi mid", "mu"],
  }),
  reg({
    id: "kalshi_spread",
    label: "Kalshi spread",
    description: "Kalshi bid–ask spread on the desk snapshot.",
    category: "market",
  }),
  reg({
    id: "kalshi_volume",
    label: "Kalshi volume",
    description: "Kalshi contract volume on the desk tick (not player-profile average).",
    category: "market",
  }),
  reg({
    id: "poly_mid",
    label: "Poly mid",
    description: "Polymarket mid price, cents; null when venue absent.",
    category: "market",
  }),
  reg({
    id: "poly_volume",
    label: "Poly volume",
    description: "Polymarket volume USD; null = venue absent, 0 = joined with zero trades.",
    category: "market",
  }),
  reg({
    id: "pinny_no_vig",
    label: "Pinnacle no-vig",
    description: "Pinnacle no-vig probability in cents; null when unavailable.",
    category: "market",
  }),
  reg({
    id: "pinny_source",
    label: "Pinnacle source",
    description: "mock | live — origin of pinny_no_vig.",
    category: "market",
    values: ["mock", "live"],
  }),
  reg({
    id: "elo_prob",
    label: "Elo prob",
    description: "Elo win probability for player A (0–1); interpret with elo_source.",
    category: "model",
  }),
  reg({
    id: "elo_source",
    label: "Elo source",
    description: "model | fallback_50 | missing — provenance of elo_prob.",
    category: "model",
    values: ["model", "fallback_50", "missing"],
  }),
  reg({
    id: "blend_fair_cents",
    label: "Blend fair ¢",
    description: "Blended fair price in cents (core priced output).",
    category: "model",
  }),
  reg({
    id: "eff_edge",
    label: "Eff edge",
    description: "Effective edge vs blend (cents); tick-bound, can drift.",
    category: "model",
  }),
  reg({
    id: "liquidity_ok",
    label: "Liquidity OK",
    description: "Desk liquidity gate (necessary, not sufficient for tradable).",
    category: "market",
  }),
  reg({
    id: "total_volume_usd",
    label: "Total volume USD",
    description: "Combined venue volume in USD for the match snapshot.",
    category: "market",
  }),
  reg({
    id: "multi_venue",
    label: "Multi-venue",
    description: "Whether more than one venue is joined on the row.",
    category: "warehouse",
  }),
  reg({
    id: "arb_hint",
    label: "Arb hint",
    description: "Directional arb signal (kalshi-cheap | poly-cheap | none | watch).",
    category: "model",
  }),
  reg({
    id: "arb_actionable",
    label: "Arb actionable",
    description: "Hard arb gate (net edge > 0 on real venue-vs-venue).",
    category: "model",
  }),
  reg({
    id: "rps_flag",
    label: "RPS flag",
    description: "Research process signal flag on the desk row.",
    category: "model",
  }),
  reg({
    id: "graph_divergence",
    label: "Graph divergence",
    description: "Graph/model divergence indicator on the desk export.",
    category: "model",
  }),
  reg({
    id: "research_flag",
    label: "Research flag",
    description: "Research gating reason (e.g. DATA_INCOMPLETE, thin-data).",
    category: "warehouse",
  }),
  reg({
    id: "export_note",
    label: "Export note",
    description: "Per-row provenance string (e.g. mock pinny caveat).",
    category: "warehouse",
  }),

  // ── warehouse UI (not desk CSV columns) ──
  ui({
    id: "playerProfiles",
    label: "Player profiles",
    description:
      "Derived from event-store player_profiles (SSOT). Rebuild: bun run tennis:profiles:build.",
    category: "warehouse",
    synonyms: ["profiles"],
  }),
  ui({
    id: "lastSeenAtMs",
    label: "Last seen",
    description:
      "Epoch millis of latest event start for this player. Capped ≤ now. Event-store ms.",
    category: "warehouse",
    synonyms: ["last seen", "lastSeenMs"],
  }),
  ui({
    id: "profilesSource",
    label: "Profiles source",
    description:
      "warehouse = rows from event-store; seed = unavailable / fixture path.",
    category: "warehouse",
    values: ["warehouse", "seed"],
  }),
  ui({
    id: "coverage",
    label: "Coverage",
    description: "Data completeness for a tour/surface slice (events with books, links, scores).",
    category: "warehouse",
  }),
  ui({
    id: "surfaceEdge",
    label: "Surface edge",
    description:
      "Dampened percentage-point edge from each player's historical surface win rates vs the match surface.",
    category: "warehouse",
    synonyms: ["surface edge"],
  }),
  ui({
    id: "ui.events.filter.reset",
    label: "Reset filters",
    description: "Clear all active Events facet selections and sort order.",
    category: "ui",
    synonyms: ["clear", "reset"],
  }),

  // ── Live board / Events chrome ──
  ui({
    id: "ui.live_board.title",
    kind: "ui",
    label: "Tennis board",
    description:
      "Real-time match monitor: open Kalshi markets with filters, surface edge, and player profiles.",
    category: "ui",
    synonyms: ["live board", "board", "monitor", "tennis board"],
  }),
  ui({
    id: "ui.live_board.scanner",
    label: "Scanner",
    description:
      "Price divergence alert: when market mid deviates from model fair by more than threshold.",
    category: "ui",
    mapsTo: "composite.scanner",
    synonyms: ["alert", "signal", "flag"],
  }),
  ui({
    id: "ui.live_board.divergence",
    label: "Divergence",
    description: "Cents difference between market price and model fair price.",
    category: "ui",
    mapsTo: "composite.divergence",
    synonyms: ["delta", "edge", "gap"],
  }),
  ui({
    id: "ui.live_board.edge_score",
    label: "Edge score",
    description:
      "Composite signal strength: divergence weighted by liquidity and model confidence.",
    category: "ui",
    mapsTo: "composite.edge_score",
    synonyms: ["edge", "score", "strength"],
  }),
  ui({
    id: "ui.live_board.model_suspect",
    label: "Model suspect",
    description:
      "Flag when model inputs are stale, incomplete, or conflict with market consensus.",
    category: "ui",
    mapsTo: "composite.model_suspect",
    synonyms: ["suspect", "stale", "untrusted"],
  }),

  // ── Events filter chrome ──
  ui({
    id: "ui.events.filter.tournament",
    label: "Tournament",
    description: "Filter matches by tournament / competition name.",
    category: "tournament",
    synonyms: ["competition", "event name"],
  }),
  ui({
    id: "ui.events.filter.country",
    label: "Country",
    description: "Filter by tournament or player nationality code/name.",
    category: "tournament",
    synonyms: ["nation", "geo"],
  }),
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
  }),
  ui({
    id: "ui.events.filter.min_vol",
    label: "Min 24h vol",
    description: "Minimum trailing volume gate for board rows (desk liquidity).",
    category: "market",
    mapsTo: "kalshi_volume",
    synonyms: ["min volume", "volume floor"],
  }),
  ui({
    id: "ui.events.filter.min_surface_edge",
    label: "Min surface edge",
    description: "Minimum surface-edge points required to keep a match on the board.",
    category: "warehouse",
    mapsTo: "surfaceEdge",
  }),
  ui({
    id: "ui.sort.events",
    label: "Sort",
    description: "Ordering of the match list: start time, volume, or name.",
    category: "ui",
    synonyms: ["sort events", "order"],
  }),
  ui({
    id: "ui.filter.unclassified",
    label: "Unclassified",
    description: "Placeholder when a value cannot be mapped to a known category.",
    category: "ui",
    synonyms: ["Unc", "Other", "NA", "unknown"],
  }),

  // ── Warehouse fleet chrome ──
  ui({
    id: "ui.warehouse.coverage",
    label: "Coverage",
    description: "Data completeness badge: Kalshi-only, Polymarket-only, or hybrid.",
    category: "warehouse",
    mapsTo: "coverage",
    synonyms: ["venues", "sources"],
  }),
  ui({
    id: "ui.warehouse.poly_link",
    label: "Poly",
    description: "Polymarket market link status: linked or unlinked.",
    category: "warehouse",
    synonyms: ["polymarket", "gamma", "matched"],
  }),
  ui({
    id: "ui.warehouse.event_status",
    label: "Event status",
    description: "Match lifecycle: Scheduled, Live, or Ended.",
    category: "warehouse",
    synonyms: ["status", "state"],
  }),
  ui({
    id: "ui.warehouse.fleet_count",
    label: "Events",
    description: "Number of matches in the current filtered view.",
    category: "ui",
    synonyms: ["count", "N events", "fleet"],
  }),
  ui({
    id: "ui.warehouse.fleet_volume",
    label: "Total volume",
    description: "Aggregated volume across the filtered match set.",
    category: "market",
    mapsTo: "total_volume_usd",
    synonyms: ["volume", "X total vol"],
  }),

  // ── Composite concepts (semantic targets for mapsTo; not tip keys) ──
  {
    id: "composite.scanner",
    kind: "composite",
    label: "Scanner signal",
    description: "Abstract scanner / divergence-alert concept used by live board UI.",
    category: "model",
  },
  {
    id: "composite.divergence",
    kind: "composite",
    label: "Price divergence",
    description: "Abstract market-vs-model divergence concept.",
    category: "model",
  },
  {
    id: "composite.edge_score",
    kind: "composite",
    label: "Edge score",
    description: "Abstract composite edge strength concept.",
    category: "model",
  },
  {
    id: "composite.model_suspect",
    kind: "composite",
    label: "Model suspect",
    description: "Abstract model-trust flag concept.",
    category: "model",
  },

  // ── Pipeline & alerts (composite concepts — not desk CSV columns) ──
  {
    id: "alert.poly_dropout",
    kind: "composite",
    label: "Poly Dropout",
    description: "kalshiOnly % exceeds threshold (>30% default) for N logger cycles. Polymarket matching failing.",
    category: "pipeline",
    values: ["CRITICAL: >30% for 3+ ticks"],
    resolveValues: ["kalshiOnly/total ≤ poly-dropout-pct"],
    resolveLabel: "Poly Dropout — Resolved",
  },
  {
    id: "alert.volume_gap",
    kind: "composite",
    label: "Volume Gap",
    description: "midOnly exceeds threshold (>10 default) for N cycles. Many mids but zero volume — stale volume_fp.",
    category: "pipeline",
    values: ["WARNING: >10 for 3+ ticks"],
    resolveValues: ["midOnly ≤ volume-gap-count"],
    resolveLabel: "Volume Gap — Resolved",
  },
  {
    id: "alert.feed_frozen",
    kind: "composite",
    label: "Poly Feed Frozen",
    description: "polyMatched=0 for N consecutive cycles. Polymarket feed completely frozen.",
    category: "pipeline",
    values: ["CRITICAL: 0 polyMatched for 6+ ticks"],
    resolveValues: ["polyMatched > 0"],
    resolveLabel: "Poly Frozen — Resolved",
  },
  {
    id: "alert.stale_feed",
    kind: "composite",
    label: "Feed Stale",
    description: "No snapshots within staleness-threshold-ms (120s). Logger stuck or crashed.",
    category: "pipeline",
    values: ["CRITICAL: >120s since last snapshot"],
    resolveValues: ["logger cycle succeeds (reaches this code path)"],
    resolveLabel: "Feed Stale — Resolved",
  },
  {
    id: "alert.divergence",
    kind: "composite",
    label: "Price Divergence",
    description: "Kalshi mid deviates from Poly implied prob > divergence-cents (15¢). Cross-venue mispricing.",
    category: "pipeline",
    values: ["INFO: |kalshiMid - polyProb*100| > 15¢"],
    resolveValues: ["manual only — no auto-resolution"],
  },
  {
    id: "alert.resolution",
    kind: "composite",
    label: "Alert Resolution",
    description: "Auto-sent when active alert clears. Includes duration, replies original, clears debounce.",
    category: "pipeline",
    values: ["stale_feed_resolved", "poly_dropout_resolved", "volume_gap_resolved", "poly_feed_frozen_resolved"],
  },
  {
    id: "alert.delivery",
    kind: "composite",
    label: "Alert Delivery",
    description: "Telegram (HTML, threaded, keyboard CRITICAL), Discord/Slack webhook, console stderr.",
    category: "pipeline",
    values: ["telegram", "discord", "console"],
  },
  {
    id: "alert.severity",
    kind: "composite",
    label: "Alert Severity",
    description: "CRITICAL: feed down (keyboard). WARNING: degraded. INFO: informational, silent.",
    category: "pipeline",
    values: ["CRITICAL", "WARNING", "INFO"],
  },
] as const;

export type GlossaryId = (typeof GLOSSARY_ENTRIES)[number]["id"];

/** Flat tip map for HQ (backward compatible with tip(key) consumers). */
export const TOOLTIPS: Record<string, string> = Object.fromEntries(
  GLOSSARY_ENTRIES.map((e) => [e.id, e.description]),
);

export type TooltipKey = keyof typeof TOOLTIPS;

export function getGlossaryEntry(id: string): GlossaryEntry | undefined {
  return GLOSSARY_ENTRIES.find((e) => e.id === id);
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

/** Concepts whose `values` drive board filter dropdowns (API + audit SSOT). */
export const FILTER_CATALOG_IDS = [
  "league",
  "surface",
  "tier",
  "ui.events.filter.when",
  "ui.events.filter.liquidity",
] as const;

export type FilterCatalogId = (typeof FILTER_CATALOG_IDS)[number];

export type FilterCatalogEntry = {
  label: string;
  values: readonly string[];
  valueLabels: Record<string, string>;
};

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

/** Payload for GET /api/glossary — panel + tips + codes. */
export function buildGlossaryApiPayload() {
  return {
    schemaVersion: 2,
    tooltips: TOOLTIPS,
    entries: GLOSSARY_ENTRIES.map((e) => ({
      id: e.id,
      label: e.label,
      description: e.description,
      category: e.category,
      kind: e.kind,
      mapsTo: e.mapsTo ?? null,
      synonyms: e.synonyms ?? [],
      values: e.values ?? null,
      valueLabels: e.valueLabels ?? null,
    })),
    /** Closed-set filter catalogs (single write path for board dropdowns) */
    filterCatalog: buildFilterCatalog(),
    categories: (Object.keys(GLOSSARY_CATEGORY_LABELS) as GlossaryCategory[]).map((id) => ({
      id,
      label: GLOSSARY_CATEGORY_LABELS[id],
    })),
    codes: CODES,
    units: UNITS,
  };
}

/** Pending registry concepts (board/HQ) not yet on desk CSV columns[]. */
export const PENDING_REGISTRY_CONCEPTS = ["tier", "round"] as const;

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
