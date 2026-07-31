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
  | "other";

export const GLOSSARY_CATEGORY_LABELS: Record<GlossaryCategory, string> = {
  market: "Market data",
  model: "Model & calibration",
  tournament: "Tournament metadata",
  warehouse: "Warehouse & profiles",
  trading: "Trading & orders",
  ui: "UI & ops",
  other: "Other",
};

export type GlossaryEntry = {
  /** Stable id — tip("id") and #glossary:id */
  id: string;
  label: string;
  description: string;
  category: GlossaryCategory;
  /** Alternate labels (governance / search) */
  synonyms?: string[];
  example?: string;
  /** Optional enum values for filters */
  values?: string[];
};

/**
 * Canonical UI glossary. Every tip() key used in HQ should appear here.
 * Order within a category is display order.
 */
export const GLOSSARY_ENTRIES: readonly GlossaryEntry[] = [
  // ── market ──
  {
    id: "mid",
    label: "Mid",
    description:
      "Midpoint of best yes-bid and yes-ask. Untradeable reference price.",
    category: "market",
    synonyms: ["mid price", "market price"],
  },
  {
    id: "spreadCents",
    label: "Spread",
    description: "Best ask − best bid (¢). Wide spreads = poor liquidity; prefer postOnly.",
    category: "market",
    synonyms: ["bid-ask", "spread"],
  },
  {
    id: "crossed",
    label: "Crossed book",
    description: "Transient book state (yesBid + noBid > 100). Do not treat mid as tradeable.",
    category: "market",
  },
  {
    id: "avgKalshiVolumeFp",
    label: "Avg volume (Fp)",
    description:
      "Mean resolved Kalshi contract volume over trading appearances (player_profiles.avg_kalshi_volume_fp). Not poly; not live board volume24h.",
    category: "market",
    synonyms: ["avg vol", "volume", "avgKalshiVolume"],
    example: "avgKalshiVolumeFp",
  },
  {
    id: "yesPriceCents",
    label: "Yes price ¢",
    description: "Limit price for YES contracts, 1–99¢. NO price = 100 − yes.",
    category: "market",
  },

  // ── trading ──
  {
    id: "balanceCents",
    label: "Balance",
    description:
      "Available-to-trade cash. Does not include value locked in open positions.",
    category: "trading",
  },
  {
    id: "portfolioValueCents",
    label: "Portfolio value",
    description: "Current mark value of all held positions, separate from cash balance.",
    category: "trading",
  },
  {
    id: "position",
    label: "Position",
    description: "Signed contracts: positive = long YES, negative = long NO (Kalshi convention).",
    category: "trading",
  },
  {
    id: "exposureCents",
    label: "Exposure",
    description: "Cash at risk in this market at current marks.",
    category: "trading",
  },
  {
    id: "realizedPnlCents",
    label: "Realized P&L",
    description: "Locked-in profit/loss from closed trades in this market.",
    category: "trading",
  },
  {
    id: "feesPaidCents",
    label: "Fees paid",
    description: "Total exchange fees paid in this market, all time.",
    category: "trading",
  },
  {
    id: "remainingCount",
    label: "Remaining",
    description: "Contracts still working on the book (not yet filled or canceled).",
    category: "trading",
  },
  {
    id: "fillCount",
    label: "Fill count",
    description: "Contracts already executed from this order.",
    category: "trading",
  },
  {
    id: "isTaker",
    label: "Taker",
    description: "True = crossed the spread (taker fee); false = rested on book (maker fee, lower).",
    category: "trading",
  },
  {
    id: "feeCents",
    label: "Fee ¢",
    description: "Exchange fee on this fill. Maker < taker — postOnly orders target maker fees.",
    category: "trading",
  },
  {
    id: "postOnly",
    label: "Post-only",
    description: "Maker-first: order rests on book or is rejected; never crosses the spread.",
    category: "trading",
  },
  {
    id: "dryRun",
    label: "Dry-run",
    description: "Simulated order — no funds move, no API write. Live requires explicit opt-in.",
    category: "trading",
    synonyms: ["dry run", "simulate"],
  },

  // ── model ──
  {
    id: "shadowMinSignals",
    label: "Shadow min signals",
    description: "Gate: minimum shadow signals before a program may graduate to pilot.",
    category: "model",
  },
  {
    id: "killBrierDriftPct",
    label: "Kill Brier drift %",
    description: "Gate: kill program if Brier score drifts this % above baseline.",
    category: "model",
  },
  {
    id: "graduationMinRealizedEdgeCentsPerFill",
    label: "Graduation edge ¢/fill",
    description: "Gate: realized edge per fill needed for pilot→live.",
    category: "model",
  },

  // ── tournament ──
  {
    id: "league",
    label: "League",
    description: "Professional circuit derived from Kalshi series (ATP, WTA, Challenger, ITF).",
    category: "tournament",
    synonyms: ["series", "tour"],
    values: ["ATP", "WTA", "ATP Challenger", "WTA 125", "ITF Men", "ITF Women"],
  },
  {
    id: "tier",
    label: "Tier",
    description: "Competition level (GS, 1000, 500, 250, CH, ITF15–100, …).",
    category: "tournament",
    synonyms: ["level"],
  },
  {
    id: "surface",
    label: "Surface",
    description: "Court type: Hard, Clay, Grass, Carpet (from event or tournament seed).",
    category: "tournament",
    values: ["Hard", "Clay", "Grass", "Carpet"],
  },
  {
    id: "round",
    label: "Round",
    description: "Match round within the tournament (R16, QF, SF, F, …).",
    category: "tournament",
  },

  // ── warehouse ──
  {
    id: "playerProfiles",
    label: "Player profiles",
    description:
      "Derived from event-store player_profiles (SSOT): appearances, W–L, surfaces, avgKalshiVolumeFp. Rebuild: bun run tennis:profiles:build. Meta: docs/PLAYER_PROFILES_META.md",
    category: "warehouse",
    synonyms: ["profiles"],
  },
  {
    id: "lastSeenAtMs",
    label: "Last seen",
    description:
      "Epoch millis of latest event start for this player (player_profiles.last_seen_ts). Capped ≤ now. Event-store ms, not Kalshi wire seconds.",
    category: "warehouse",
    synonyms: ["last seen", "lastSeenMs"],
  },
  {
    id: "profilesSource",
    label: "Profiles source",
    description:
      "warehouse = rows from event-store; seed = unavailable / fixture path (no live profiles).",
    category: "warehouse",
    values: ["warehouse", "seed"],
  },
  {
    id: "coverage",
    label: "Coverage",
    description: "Data completeness for a tour/surface slice (events with books, links, scores).",
    category: "warehouse",
  },
  {
    id: "surfaceEdge",
    label: "Surface edge",
    description:
      "Dampened percentage-point edge from each player's historical surface win rates vs the match surface.",
    category: "warehouse",
    synonyms: ["surface edge"],
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

/** Payload for GET /api/glossary — panel + tips + codes. */
export function buildGlossaryApiPayload() {
  return {
    schemaVersion: 1,
    tooltips: TOOLTIPS,
    entries: GLOSSARY_ENTRIES.map((e) => ({ ...e })),
    categories: (Object.keys(GLOSSARY_CATEGORY_LABELS) as GlossaryCategory[]).map((id) => ({
      id,
      label: GLOSSARY_CATEGORY_LABELS[id],
    })),
    codes: CODES,
    units: UNITS,
  };
}
