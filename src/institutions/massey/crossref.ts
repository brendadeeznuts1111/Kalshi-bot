/**
 * Crossref: Massey Ratings vs the plive/ezlive book (fantasy402).
 *
 * Joins the latest Massey snapshot for a sport bucket against book events
 * (event-store.db skin_events): normalizes team names, attempts home/away
 * matches, and derives a Massey-implied win probability per team.
 *
 * Implied probability: EW/(EW+EL) when the snapshot has season projections
 * (volleyball NCAA rows carry EW/EL); otherwise winPct (record); else null
 * (rating-diff derivation is left for calibration, not assumed).
 */
import type { Database } from "bun:sqlite";
import { latestMasseyRatings } from "./store.ts";
import type { MasseyRatingRow } from "./parse.ts";
import { masseyTargetsForBucket, type MasseySportTarget } from "./sports.ts";

export type MatchQuality = "exact" | "strong" | "none";

export type MasseyCrossrefRow = {
  bookLeague: string;
  bookHome: string;
  bookAway: string;
  competitionId: string | null;
  masseyTarget: string | null;
  homeMatch: { team: string; quality: MatchQuality } | null;
  awayMatch: { team: string; quality: MatchQuality } | null;
  homeWinPct: number | null;
  awayWinPct: number | null;
  /** True when at least one side matched a Massey team. */
  covered: boolean;
};

/**
 * Derive a Massey-implied win probability from a rating row.
 * Prefers season projections (EW/EL), then record win pct.
 */
export function masseyImpliedProbability(row: MasseyRatingRow): number | null {
  if (row.ew != null && row.el != null && row.ew + row.el > 0) {
    return row.ew / (row.ew + row.el);
  }
  if (row.wins != null && row.losses != null && row.wins + row.losses > 0) {
    return row.wins / (row.wins + row.losses);
  }
  return null;
}

/**
 * Normalize a team name for matching: lower, strip non-alphanumerics,
 * reorder "LAST, First" to "first last", drop trailing qualifiers.
 */
export function normalizeTeamName(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/\([^)]*\)/g, " "); // drop (women), (zh), etc.
  const comma = s.indexOf(",");
  if (comma >= 0) {
    const last = s.slice(0, comma).trim();
    const first = s.slice(comma + 1).trim();
    s = first ? first + " " + last : last;
  }
  return s.replace(/[^a-z0-9]+/g, "");
}

/** Match quality between two normalized names. */
export function matchQuality(a: string, b: string): MatchQuality {
  if (!a || !b) return "none";
  if (a === b) return "exact";
  if (a.includes(b) || b.includes(a)) {
    return a.length >= 4 && b.length >= 4 ? "strong" : "none";
  }
  return "none";
}

/**
 * Look up a normalized name in a Massey snapshot; best-quality match wins.
 */
export function findMasseyMatch(
  normalized: string,
  index: Map<string, MasseyRatingRow>,
  strongIndex: Map<string, MasseyRatingRow>,
): { team: string; quality: MatchQuality } | null {
  if (!normalized) return null;
  const exact = index.get(normalized);
  if (exact) return { team: exact.team, quality: "exact" };
  for (const [key, row] of strongIndex) {
    if (
      key.length >= 4 &&
      normalized.length >= 4 &&
      (normalized.includes(key) || key.includes(normalized))
    ) {
      return { team: row.team, quality: "strong" };
    }
  }
  return null;
}

export type BookSkinEvent = {
  league: string;
  home: string | null;
  away: string | null;
  competitionId: string | null;
};

/**
 * Build a match index for the latest Massey snapshot of a target.
 */
export function buildMasseyIndex(
  rows: MasseyRatingRow[],
): { exact: Map<string, MasseyRatingRow>; strong: Map<string, MasseyRatingRow> } {
  const exact = new Map<string, MasseyRatingRow>();
  const strong = new Map<string, MasseyRatingRow>();
  for (const r of rows) {
    const key = normalizeTeamName(r.team);
    if (!key) continue;
    if (!exact.has(key)) exact.set(key, r);
    if (key.length >= 4 && !strong.has(key)) strong.set(key, r);
  }
  return { exact, strong };
}

/**
 * Crossref one book event against Massey snapshots for the sport bucket.
 * masseyByTarget: target -> latest rating rows (from latestMasseyRatings).
 */
export function crossrefBookEvent(
  ev: BookSkinEvent,
  masseyByTarget: Map<string, MasseyRatingRow[]>,
): MasseyCrossrefRow {
  const homeN = normalizeTeamName(ev.home ?? "");
  const awayN = normalizeTeamName(ev.away ?? "");
  let best: { target: string; homeMatch: MasseyCrossrefRow["homeMatch"]; awayMatch: MasseyCrossrefRow["awayMatch"] } | null = null;
  for (const [target, rows] of masseyByTarget) {
    const idx = buildMasseyIndex(rows);
    const homeMatch = findMasseyMatch(homeN, idx.exact, idx.strong);
    const awayMatch = findMasseyMatch(awayN, idx.exact, idx.strong);
    const score = (homeMatch ? 2 : 0) + (awayMatch ? 1 : 0);
    if (score > 0 && (!best || score > ((best.homeMatch ? 2 : 0) + (best.awayMatch ? 1 : 0)))) {
      best = { target, homeMatch, awayMatch };
    }
  }

  const covered = best !== null && (best.homeMatch !== null || best.awayMatch !== null);
  const homeRow = best?.homeMatch ? lookupRow(masseyByTarget, best.target, best.homeMatch.team) : null;
  const awayRow = best?.awayMatch ? lookupRow(masseyByTarget, best.target, best.awayMatch.team) : null;
  return {
    bookLeague: ev.league,
    bookHome: ev.home ?? "",
    bookAway: ev.away ?? "",
    competitionId: ev.competitionId,
    masseyTarget: best?.target ?? null,
    homeMatch: best?.homeMatch ?? null,
    awayMatch: best?.awayMatch ?? null,
    homeWinPct: homeRow ? masseyImpliedProbability(homeRow) : null,
    awayWinPct: awayRow ? masseyImpliedProbability(awayRow) : null,
    covered,
  };
}

function lookupRow(
  masseyByTarget: Map<string, MasseyRatingRow[]>,
  target: string,
  team: string,
): MasseyRatingRow | null {
  const rows = masseyByTarget.get(target);
  if (!rows) return null;
  const key = normalizeTeamName(team);
  for (const r of rows) {
    if (normalizeTeamName(r.team) === key) return r;
  }
  return rows.find((r) => r.team === team) ?? null;
}

/**
 * Load the latest Massey snapshot rows for every target of a sport bucket
 * from the Massey cache DB. Targets without a snapshot are omitted.
 */
export function loadMasseySnapshotsForBucket(
  masseyDb: Database,
  bucket: string,
): Map<string, MasseyRatingRow[]> {
  const out = new Map<string, MasseyRatingRow[]>();
  for (const target of masseyTargetsForBucket(bucket)) {
    const rows = latestMasseyRatings(masseyDb, target);
    if (rows.length > 0) out.set(targetKey(target), rows);
  }
  return out;
}

export function targetKey(target: MasseySportTarget): string {
  return target.masseySport + "/" + (target.subdivision || "-");
}

/**
 * Cross-reference all book events of a sport against the Massey cache.
 * Returns rows + coverage summary.
 */
export function crossrefSport(
  masseyDb: Database,
  events: BookSkinEvent[],
  bucket: string,
): { rows: MasseyCrossrefRow[]; covered: number; total: number } {
  const masseyByTarget = loadMasseySnapshotsForBucket(masseyDb, bucket);
  const rows = events.map((ev) => crossrefBookEvent(ev, masseyByTarget));
  return {
    rows,
    covered: rows.filter((r) => r.covered).length,
    total: rows.length,
  };
}
