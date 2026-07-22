/** Kalshi KXMLBGAME — one market per team; YES = suffix team wins. */

export const MLB_TEAM_CODES: Record<string, string> = {
  ARI: "Diamondbacks",
  ATH: "Athletics",
  ATL: "Braves",
  BAL: "Orioles",
  BOS: "Red Sox",
  CHC: "Cubs",
  CIN: "Reds",
  CLE: "Guardians",
  COL: "Rockies",
  CWS: "White Sox",
  DET: "Tigers",
  HOU: "Astros",
  KC: "Royals",
  LAA: "Angels",
  LAD: "Dodgers",
  MIA: "Marlins",
  MIL: "Brewers",
  MIN: "Twins",
  NYM: "Mets",
  NYY: "Yankees",
  OAK: "Athletics",
  PHI: "Phillies",
  PIT: "Pirates",
  SD: "Padres",
  SEA: "Mariners",
  SF: "Giants",
  STL: "Cardinals",
  TB: "Rays",
  TEX: "Rangers",
  TOR: "Blue Jays",
  WSH: "Nationals",
};

export function isMlbGameTicker(ticker: string): boolean {
  return ticker.startsWith("KXMLBGAME-");
}

/** Market suffix team code — YES pays if this team wins. */
export function parseMlbYesTeamCode(ticker: string): string | null {
  const m = ticker.match(/^KXMLBGAME-[A-Z0-9]+-([A-Z]{2,4})$/);
  return m?.[1] ?? null;
}

/** Event matchup blob between date+time and team suffix (e.g. ATHMIN). */
export function parseMlbMatchupBlob(ticker: string): string | null {
  const m = ticker.match(/^KXMLBGAME-(\d{2}[A-Z]{3}\d{2})(\d{4})([A-Z]+)-[A-Z]{2,4}$/);
  return m?.[3] ?? null;
}

export function splitMlbMatchupBlob(blob: string): [string, string] | null {
  const codes = Object.keys(MLB_TEAM_CODES).sort((a, b) => b.length - a.length);
  for (const a of codes) {
    if (!blob.startsWith(a)) continue;
    const rest = blob.slice(a.length);
    if (rest && codes.includes(rest)) return [a, rest];
  }
  for (const b of codes) {
    if (!blob.endsWith(b)) continue;
    const rest = blob.slice(0, blob.length - b.length);
    if (rest && codes.includes(rest)) return [rest, b];
  }
  return null;
}

export function mlbTeamNameMatchesCode(code: string, teamName: string): boolean {
  const needle = MLB_TEAM_CODES[code];
  if (!needle) return teamName.toUpperCase().includes(code);
  return teamName.toLowerCase().includes(needle.toLowerCase());
}

export function mlbYesTeamCodes(ticker: string): [string, string] | null {
  const yes = parseMlbYesTeamCode(ticker);
  const blob = parseMlbMatchupBlob(ticker);
  if (!yes || !blob) return null;
  const pair = splitMlbMatchupBlob(blob);
  if (!pair) return null;
  const [a, b] = pair;
  if (a === yes || b === yes) return pair;
  return null;
}

export function mlbYesIsHomeTeam(ticker: string, homeTeam: string, awayTeam: string): boolean {
  const yes = parseMlbYesTeamCode(ticker);
  if (!yes) return true;
  if (mlbTeamNameMatchesCode(yes, homeTeam)) return true;
  if (mlbTeamNameMatchesCode(yes, awayTeam)) return false;
  return true;
}
