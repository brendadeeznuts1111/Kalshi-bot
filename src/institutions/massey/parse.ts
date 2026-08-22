/**
 * Pure parse layer for Massey ratings tables (no network, no WebView).
 *
 * Verified table shape (cvol/ncaa-d1, 2026-08-22):
 *   headers: Team, Rec, Δ, Rat, Pwr, HFA, SoS, SSF, EW, EL
 *   rows:    team cell "NebraskaBig 10", record "0-0 0.000", rat "19.25", …
 *   meta rows to skip: "Correlation" row, empty spacer rows.
 *
 * Columns are mapped by header name so reordered tables still parse.
 */

export type MasseyRatingRow = {
  /** 1-based row position in the table (spacer/meta rows skipped). */
  rank: number;
  /** Team name with conference suffix stripped when detectable. */
  team: string;
  /** Conference suffix ('' when not detectable). */
  conference: string;
  /** Raw team cell ("NebraskaBig 10"). */
  teamCell: string;
  /** Raw record cell ("0-0 0.000"). */
  record: string;
  wins: number | null;
  losses: number | null;
  winPct: number | null;
  /** Δ — rating change vs previous poll. */
  delta: number | null;
  rating: number | null;
  power: number | null;
  hfa: number | null;
  sos: number | null;
  ssf: number | null;
  /** Expected wins / losses (season projection). */
  ew: number | null;
  el: number | null;
};

export type MasseyParseOptions = {
  /** Conference names used to strip the suffix from team cells. */
  knownConferences?: readonly string[];
  /** Row limit (0 = all). */
  limit?: number;
};

/** Parse a numeric cell: '' / 'NaN' / '-' → null. */
export function parseMasseyNumber(value: string): number | null {
  const s = value.trim();
  if (!s || s === 'NaN' || s === '-' || s === '—') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Parse record cell "0-0 0.000" → { wins, losses, winPct }. */
export function parseMasseyRecord(value: string): {
  wins: number | null;
  losses: number | null;
  winPct: number | null;
} {
  const s = value.trim();
  if (!s) return { wins: null, losses: null, winPct: null };
  const m = s.match(/^(\d+)-(\d+)(?:\s+([\d.]+))?/);
  if (!m) return { wins: null, losses: null, winPct: null };
  return {
    wins: Number(m[1]),
    losses: Number(m[2]),
    winPct: m[3] ? parseMasseyNumber(m[3]!) : null,
  };
}

/** Split "NebraskaBig 10" → { team: "Nebraska", conference: "Big 10" }. */
export function splitMasseyTeamConference(
  cell: string,
  knownConferences: readonly string[],
): { team: string; conference: string } {
  const raw = cell.trim();
  if (!raw) return { team: raw, conference: '' };
  // Longest conference suffix match wins (case-insensitive, anchored at end).
  let best: { conf: string; team: string } | null = null;
  for (const conf of knownConferences) {
    const c = conf.trim();
    if (!c) continue;
    if (raw.length > c.length && raw.toLowerCase().endsWith(c.toLowerCase())) {
      const team = raw.slice(0, raw.length - c.length).trim();
      if (team && (!best || c.length > best.conf.length)) {
        best = { conf: c, team };
      }
    }
  }
  if (best) return { team: best.team, conference: best.conf };
  return { team: raw, conference: '' };
}

/** Default conference list (volleyball-heavy, covers most NCAA team cells). */
export const DEFAULT_MASSEY_CONFERENCES: readonly string[] = [
  'Big 10', 'Big Ten', 'Big 12', 'Big East', 'Big Sky', 'Big South', 'Big West',
  'Atlantic Coast', 'Atlantic Sun', 'America East', 'Conference USA', 'Horizon',
  'Coastal', 'U-Sports', 'Pac-12', 'Southeastern', 'SEC', 'Mountain West',
  'Missouri Valley', 'Ivy League', 'Patriot', 'West Coast', 'WCC', 'Summit',
  'Southland', 'Sun Belt', 'Mid-American', 'MAC', 'CAA', 'AAC',
  'American Athletic', 'Ohio Valley', 'Big West', 'Western Athletic', 'WAC',
  'Northeast', 'Metro Atlantic', 'MAAC', 'Big South', 'Southwestern', 'SWAC',
];

/** Map a header to its column index by name (lenient). */
function headerIndex(headers: readonly string[], names: readonly string[]): number {
  for (const n of names) {
    const i = headers.findIndex((h) => h.trim().toLowerCase() === n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Parse a raw table (headers + rows) into typed rating rows.
 * Skips "Correlation" meta row, empty rows, and rows shorter than the header count.
 */
export function parseMasseyRatingRows(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  options: MasseyParseOptions = {},
): MasseyRatingRow[] {
  const confs = options.knownConferences ?? DEFAULT_MASSEY_CONFERENCES;
  const iTeam = headerIndex(headers, ['Team']);
  const iRec = headerIndex(headers, ['Rec', 'Record']);
  const iDelta = headerIndex(headers, ['Δ', 'Delta']);
  const iRat = headerIndex(headers, ['Rat', 'Rating']);
  const iPwr = headerIndex(headers, ['Pwr', 'Power']);
  const iHfa = headerIndex(headers, ['HFA']);
  const iSos = headerIndex(headers, ['SoS']);
  const iSsf = headerIndex(headers, ['SSF']);
  const iEw = headerIndex(headers, ['EW']);
  const iEl = headerIndex(headers, ['EL']);
  if (iTeam < 0) return [];

  const out: MasseyRatingRow[] = [];
  let rank = 0;
  for (const row of rows) {
    if (row.length === 0) continue;
    const teamCell = iTeam < row.length ? row[iTeam]!.trim() : '';
    if (!teamCell) continue;
    if (/^correlation$/i.test(teamCell)) continue;
    if (options.limit && out.length >= options.limit) break;
    rank += 1;
    const { team, conference } = splitMasseyTeamConference(teamCell, confs);
    const rec = parseMasseyRecord(iRec >= 0 && iRec < row.length ? row[iRec]! : '');
    const cell = (i: number): string => (i >= 0 && i < row.length ? row[i]! : '');
    out.push({
      rank,
      team,
      conference,
      teamCell,
      record: cell(iRec),
      wins: rec.wins,
      losses: rec.losses,
      winPct: rec.winPct,
      delta: parseMasseyNumber(cell(iDelta)),
      rating: parseMasseyNumber(cell(iRat)),
      power: parseMasseyNumber(cell(iPwr)),
      hfa: parseMasseyNumber(cell(iHfa)),
      sos: parseMasseyNumber(cell(iSos)),
      ssf: parseMasseyNumber(cell(iSsf)),
      ew: parseMasseyNumber(cell(iEw)),
      el: parseMasseyNumber(cell(iEl)),
    });
  }
  return out;
}
