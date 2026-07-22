/** Canonical cross-venue event key — SSOT join for ticks, signals, positions. */
export type CanonicalEventId = string & { readonly __brand: unique symbol };

export function asCanonicalEventId(raw: string): CanonicalEventId {
  const id = raw.trim();
  if (!id) throw new Error("CanonicalEventId required");
  return id as CanonicalEventId;
}

export function tryCanonicalEventId(raw: string | undefined): CanonicalEventId | undefined {
  if (!raw?.trim()) return undefined;
  return asCanonicalEventId(raw);
}

export type TennisTour = "ATP" | "WTA";

export type TennisMatchOutcome = "completed" | "retirement" | "walkover" | "unknown";

/** Normalized row from tennis-data.co.uk (or compatible CSV). */
export type TennisHistoryMatch = {
  tour: TennisTour;
  level: string;
  tournament: string;
  location: string;
  surface: string;
  court: string;
  round: string;
  bestOf: number | null;
  /** Alphabetically first player name — stable event identity. */
  playerA: string;
  /** Alphabetically second player name. */
  playerB: string;
  winner: string;
  loser: string;
  startTs: string;
  outcome: TennisMatchOutcome;
  winnerRank: number | null;
  loserRank: number | null;
  /** Pinnacle closing decimal odds (PSW / PSL columns). */
  pinnacle: { winner: number | null; loser: number | null };
  bet365: { winner: number | null; loser: number | null };
  sourceFile: string;
  sourceRow: number;
  sourceRowHash: string;
  eventId: CanonicalEventId;
};

export type IngestSummary = {
  filesRead: number;
  rowsParsed: number;
  eventsInserted: number;
  eventsSkipped: number;
  oddsInserted: number;
  resolutionsInserted: number;
};

export type EventStoreSummaryRow = {
  tour: string;
  surface: string;
  year: string;
  count: number;
};
