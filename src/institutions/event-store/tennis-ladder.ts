/**
 * Kalshi tennis ladder series — match winner + micro-markets that share a matchup blob.
 * @see docs/TENNIS_PROGRAM_ARCHETYPES.md
 */

export type TennisMarketKind =
  | "match_winner"
  | "set_winner"
  | "s1_game"
  | "s2_game"
  | "s3_game"
  | "s4_game"
  | "s5_game"
  | "game_winner"
  | "game_spread"
  | "game_total"
  | "exact_score"
  | "exact_sets"
  | "total_sets"
  | "tiebreak"
  | "other";

export type TennisLadderFamily = "itf" | "atp" | "wta" | "challenger" | "exhibition";

/** Per-point books — REST intervals ≥ point duration are archaeology → WebSocket cue. */
export const PER_POINT_MARKET_KINDS: ReadonlySet<TennisMarketKind> = new Set([
  "s1_game",
  "s2_game",
  "s3_game",
  "s4_game",
  "s5_game",
  "game_winner",
]);

export const TENNIS_LADDER_SERIES: Record<TennisLadderFamily, readonly string[]> = {
  itf: ["KXITFMATCH", "KXITFWMATCH", "KXITFDOUBLES", "KXITFWDOUBLES"],
  atp: [
    "KXATPMATCH",
    "KXATPGAME",
    "KXATPSETWINNER",
    "KXATPS1GWINNER",
    "KXATPS2GWINNER",
    "KXATPS3GWINNER",
    "KXATPS4GWINNER",
    "KXATPS5GWINNER",
    "KXATPGWINNER",
    "KXATPGAMESPREAD",
    "KXATPGSPREAD",
    "KXATPGAMETOTAL",
    "KXATPGTOTAL",
    "KXATPEXACTMATCH",
    "KXATPEXACTSETS",
    "KXATPTOTALSETS",
    "KXATPTIEBREAK",
    "KXATPANYSET",
    "KXATPDOUBLES",
  ],
  wta: [
    "KXWTAMATCH",
    "KXWTAGAME",
    "KXWTASETWINNER",
    "KXWTAEXACTMATCH",
    "KXWTADOUBLES",
  ],
  challenger: [
    "KXATPCHALLENGERMATCH",
    "KXCHALLENGERMATCH",
    "KXWTACHALLENGERMATCH",
  ],
  exhibition: ["KXEXHIBITIONMEN", "KXEXHIBITIONWOMEN", "KXTENNISEXHIBITION"],
};

const SERIES_KIND: Record<string, TennisMarketKind> = {
  KXITFMATCH: "match_winner",
  KXITFWMATCH: "match_winner",
  KXITFDOUBLES: "match_winner",
  KXITFWDOUBLES: "match_winner",
  KXATPMATCH: "match_winner",
  KXATPGAME: "match_winner",
  KXWTAMATCH: "match_winner",
  KXWTAGAME: "match_winner",
  KXATPCHALLENGERMATCH: "match_winner",
  KXCHALLENGERMATCH: "match_winner",
  KXWTACHALLENGERMATCH: "match_winner",
  KXATPDOUBLES: "match_winner",
  KXWTADOUBLES: "match_winner",
  KXEXHIBITIONMEN: "match_winner",
  KXEXHIBITIONWOMEN: "match_winner",
  KXTENNISEXHIBITION: "match_winner",
  KXATPSETWINNER: "set_winner",
  KXWTASETWINNER: "set_winner",
  KXATPS1GWINNER: "s1_game",
  KXATPS2GWINNER: "s2_game",
  KXATPS3GWINNER: "s3_game",
  KXATPS4GWINNER: "s4_game",
  KXATPS5GWINNER: "s5_game",
  KXATPGWINNER: "game_winner",
  KXATPGAMESPREAD: "game_spread",
  KXATPGSPREAD: "game_spread",
  KXATPGAMETOTAL: "game_total",
  KXATPGTOTAL: "game_total",
  KXATPEXACTMATCH: "exact_score",
  KXWTAEXACTMATCH: "exact_score",
  KXATPEXACTSETS: "exact_sets",
  KXATPTOTALSETS: "total_sets",
  KXATPTIEBREAK: "tiebreak",
  KXATPANYSET: "set_winner",
};

export function parseTennisSeriesPrefix(ticker: string): string | null {
  const dash = ticker.indexOf("-");
  if (dash <= 0) return null;
  return ticker.slice(0, dash);
}

export function marketKindFromSeries(series: string): TennisMarketKind {
  return SERIES_KIND[series] ?? "other";
}

export function marketKindFromTicker(ticker: string): TennisMarketKind {
  const series = parseTennisSeriesPrefix(ticker);
  return series ? marketKindFromSeries(series) : "other";
}

/** Date + compressed matchup blob shared across sibling ladder series (e.g. 26JUL22BORBUR). */
export function extractMatchupDateBlob(tickerOrEvent: string): string | null {
  const m = tickerOrEvent.match(/(\d{2}[A-Z]{3}\d{2}[A-Z]+)/);
  return m?.[1] ?? null;
}

export function ladderFamilyFromSeries(series: string): TennisLadderFamily | null {
  for (const [family, list] of Object.entries(TENNIS_LADDER_SERIES) as Array<
    [TennisLadderFamily, readonly string[]]
  >) {
    if (list.includes(series)) return family;
  }
  return null;
}

export function ladderFamilyFromTicker(ticker: string): TennisLadderFamily | null {
  const series = parseTennisSeriesPrefix(ticker);
  return series ? ladderFamilyFromSeries(series) : null;
}

export function ladderSeriesForTicker(ticker: string): readonly string[] {
  const family = ladderFamilyFromTicker(ticker);
  return family ? TENNIS_LADDER_SERIES[family] : [];
}

export type LadderCoverage = {
  family: TennisLadderFamily | null;
  matchupBlob: string | null;
  byKind: Record<string, number>;
  tickers: string[];
  perPointOpen: boolean;
  /** True when family has ladder series beyond match_winner but none were open. */
  ladderEmpty: boolean;
};

export function summarizeLadderCoverage(
  family: TennisLadderFamily | null,
  matchupBlob: string | null,
  tickers: string[],
): LadderCoverage {
  const byKind: Record<string, number> = {};
  for (const t of tickers) {
    const kind = marketKindFromTicker(t);
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  const expectedLadder = (family ? TENNIS_LADDER_SERIES[family] : []).filter(
    (s) => marketKindFromSeries(s) !== "match_winner",
  );
  const hasNonWinner = tickers.some((t) => marketKindFromTicker(t) !== "match_winner");
  return {
    family,
    matchupBlob,
    byKind,
    tickers,
    perPointOpen: tickers.some((t) => PER_POINT_MARKET_KINDS.has(marketKindFromTicker(t))),
    ladderEmpty: expectedLadder.length > 0 && !hasNonWinner,
  };
}

export function formatLadderCoverage(c: LadderCoverage): string {
  const kinds = Object.entries(c.byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}:${n}`)
    .join(" ");
  const bits = [
    `family=${c.family ?? "?"}`,
    `blob=${c.matchupBlob ?? "?"}`,
    `markets=${c.tickers.length}`,
    kinds || "kinds=none",
  ];
  if (c.ladderEmpty) bits.push("LADDER_EMPTY");
  if (c.perPointOpen) bits.push("WS_CUE:per-point books open — REST is archaeology");
  return bits.join(" · ");
}
