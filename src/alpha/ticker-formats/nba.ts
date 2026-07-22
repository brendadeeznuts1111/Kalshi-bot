/** Kalshi KXNBAGAME ticker parsing — YES = home team wins (suffix home+away codes). */

export const NBA_TEAM_CODES: Record<string, string> = {
  ATL: "Hawks",
  BOS: "Celtics",
  BKN: "Nets",
  CHA: "Hornets",
  CHI: "Bulls",
  CLE: "Cavaliers",
  DAL: "Mavericks",
  DEN: "Nuggets",
  DET: "Pistons",
  GSW: "Warriors",
  HOU: "Rockets",
  IND: "Pacers",
  LAC: "Clippers",
  LAL: "Lakers",
  MEM: "Grizzlies",
  MIA: "Heat",
  MIL: "Bucks",
  MIN: "Timberwolves",
  NOP: "Pelicans",
  NYK: "Knicks",
  OKC: "Thunder",
  ORL: "Magic",
  PHI: "76ers",
  PHX: "Suns",
  POR: "Trail Blazers",
  SAC: "Kings",
  SAS: "Spurs",
  TOR: "Raptors",
  UTA: "Jazz",
  WAS: "Wizards",
};

export function isNbaGameTicker(ticker: string): boolean {
  return ticker.startsWith("KXNBAGAME-");
}

/** Parse KXNBAGAME suffix into [homeCode, awayCode] (Kalshi home+away order). */
export function parseNbaGameTeamCodes(ticker: string): [string, string] | null {
  const m = ticker.match(/^KXNBAGAME-\d{2}[A-Z]{3}\d{2}([A-Z]{6})/);
  if (!m) return null;
  const blob = m[1]!;
  return [blob.slice(0, 3), blob.slice(3, 6)];
}

export function nbaTeamNameMatchesCode(code: string, teamName: string): boolean {
  const needle = NBA_TEAM_CODES[code];
  if (!needle) return teamName.toUpperCase().includes(code);
  return teamName.toLowerCase().includes(needle.toLowerCase());
}

/** YES contract pays if home team wins. */
export function nbaYesTeamCodes(ticker: string): [string, string] | null {
  return parseNbaGameTeamCodes(ticker);
}

export function nbaYesIsHomeTeam(_ticker: string): boolean {
  return true;
}
