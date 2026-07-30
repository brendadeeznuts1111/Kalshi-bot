/**
 * Tennis metadata enrichment — league, tournament, round, and geo derived
 * from Kalshi wire fields (series_ticker, product_metadata, rules_primary)
 * plus curated seed maps under research/seed/. Pure functions + cached seed
 * loaders; unknown values return null, never guesses.
 */
import { readFileSync, existsSync } from "node:fs";
import { joinPath } from "./paths.ts";

const SEED_DIR = joinPath(import.meta.dir, "../../research/seed");

// ── League / tour from series ticker ──

export type TennisLeague = {
  /** Display label: ATP, WTA, ATP Challenger, WTA 125, ITF Men, ITF Women. */
  league: string;
  /** Governing tour: ATP | WTA | ITF. */
  tour: "ATP" | "WTA" | "ITF";
  /** Competitive level: tour | challenger | itf. */
  level: "tour" | "challenger" | "itf";
};

const LEAGUE_BY_SERIES: Record<string, TennisLeague> = {
  KXATPMATCH: { league: "ATP", tour: "ATP", level: "tour" },
  KXWTAMATCH: { league: "WTA", tour: "WTA", level: "tour" },
  KXATPCHALLENGERMATCH: { league: "ATP Challenger", tour: "ATP", level: "challenger" },
  KXWTACHALLENGERMATCH: { league: "WTA 125", tour: "WTA", level: "challenger" },
  KXITFMATCH: { league: "ITF Men", tour: "ITF", level: "itf" },
  KXITFWMATCH: { league: "ITF Women", tour: "ITF", level: "itf" },
  KXITFDOUBLES: { league: "ITF Men Doubles", tour: "ITF", level: "itf" },
  KXITFWDOUBLES: { league: "ITF Women Doubles", tour: "ITF", level: "itf" },
};

export function leagueFromSeries(series: string): TennisLeague | null {
  return LEAGUE_BY_SERIES[series] ?? null;
}

// ── Tournament / round parsed from rules_primary ──
// Kalshi: "…wins the Roddick vs Gamble professional tennis match in the
// 2026 M25 Edwardsville IL Round of 16 after a ball has been played…"

export type RulesTournament = {
  year: number;
  /** e.g. "M25 Edwardsville IL", "ATP Los Cabos". */
  tournament: string;
  /** e.g. "Round of 16", "Quarterfinal", "Final". */
  round: string;
};

const RULES_RE =
  /in the (\d{4}) (.+?) (Round [Oo]f \d+|Quarterfinals?|Semifinals?|Finals?)\b/;

export function parseRulesTournament(rulesPrimary: string | null | undefined): RulesTournament | null {
  if (!rulesPrimary) return null;
  const m = RULES_RE.exec(rulesPrimary);
  if (!m) return null;
  return { year: Number(m[1]), tournament: m[2]!.trim(), round: m[3]! };
}

// ── Normalization + seed lookups ──

/** Lowercase, strip accents + parenthetical disambiguators, collapse to single spaces. */
export function normalizeKey(s: string): string {
  return s
    .replace(/\([^)]*\)/g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type IsoCountry = { iso3: string; country: string };

function loadSeed<T>(file: string): Record<string, T> {
  const path = joinPath(SEED_DIR, file);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, T>;
    const out: Record<string, T> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k.startsWith("$")) continue;
      out[normalizeKey(k)] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Load a TOML seed file with same key normalization as loadSeed. */
function loadTomlSeed<T>(file: string): Record<string, T> {
  const path = joinPath(SEED_DIR, file);
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = Bun.TOML.parse(raw) as Record<string, T>;
    const out: Record<string, T> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k.startsWith("$")) continue;
      out[normalizeKey(k)] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Manual overrides — plain name → country string (curated, wins over harvested). */
let geoSeed: Record<string, string> | null = null;
let playerSeed: Record<string, string> | null = null;
/** Harvested from ITF Stadion — normalized name/city → {iso3, country}. */
let nationalityDict: Record<string, IsoCountry> | null = null;
let venueGeoDict: Record<string, IsoCountry> | null = null;

/** Test hook — drop cached seeds. */
export function resetTennisMetaSeeds(): void {
  geoSeed = null;
  playerSeed = null;
  nationalityDict = null;
  venueGeoDict = null;
  tierSeed = null;
  surfaceSeed = null;
}

/** Country (ISO + name) for a tournament/city string. Stadion venue geo first, manual seed as fallback. */
export function geoForTournament(name: string | null | undefined): IsoCountry | null {
  if (!name) return null;
  venueGeoDict ??= loadTomlSeed<IsoCountry>("venue-geo.toml") ?? loadSeed<IsoCountry>("venue-geo.json");
  geoSeed ??= loadTomlSeed<string>("tennis-geo.toml") ?? loadSeed<string>("tennis-geo.json");
  const key = normalizeKey(name);
  const candidates: string[] = [key];
  const tokens = key.split(" ");
  for (let i = 1; i < tokens.length; i++) candidates.push(tokens.slice(i).join(" "));
  if (/ [a-z]{2}$/.test(key)) candidates.push(key.replace(/ [a-z]{2}$/, ""));
  for (const c of candidates) {
    const hit = venueGeoDict[c];
    if (hit) return hit;
    const manual = geoSeed[c];
    if (manual) return { iso3: "", country: manual };
  }
  return null;
}

/**
 * Country name for a tournament/city string. Tries the full string first, then
 * progressively drops leading tokens (handles "M25 Edwardsville IL",
 * "ATP Challenger Bonn", "W75 Cordenons").
 */
export function countryForTournament(name: string | null | undefined): string | null {
  return geoForTournament(name)?.country ?? null;
}

/** Player nationality (ISO + name). Manual curated seed wins; Stadion harvest is the bulk source. */
export function nationalityForPlayer(name: string | null | undefined): IsoCountry | null {
  if (!name) return null;
  playerSeed ??= loadTomlSeed<string>("player-countries.toml") ?? loadSeed<string>("player-countries.json");
  nationalityDict ??= loadTomlSeed<IsoCountry>("player-nationalities.toml") ?? loadSeed<IsoCountry>("player-nationalities.json");
  const key = normalizeKey(name);
  const manual = playerSeed[key];
  if (manual) return { iso3: "", country: manual };
  return nationalityDict[key] ?? null;
}

export function countryForPlayer(name: string | null | undefined): string | null {
  return nationalityForPlayer(name)?.country ?? null;
}

/** City portion of a tournament string: drop leading level tokens. */
export function cityFromTournament(name: string | null | undefined): string | null {
  if (!name) return null;
  const cleaned = name
    .replace(/^(ATP Challenger|WTA \d+K|ATP|WTA|[MW]\d{2}(?:\s+[MD])?)\s+/i, "")
    .trim();
  return cleaned || null;
}

// ── Tournament tier from the tournament string ──
// ITF: M15/M25/W15…W100 · Challenger: CH/ATP Challenger/WTA 125 ·
// Tour: 250/500/1000 · Grand Slams by name.

export type TournamentTier =
  | "GS" | "SPECIAL" | "1000" | "500" | "250" | "CH" | "W125"
  | "ITF100" | "ITF75" | "ITF60" | "ITF50" | "ITF40" | "ITF35" | "ITF25" | "ITF15" | null;

// ── Surface lookup (harvested tournament → surface seed) ──

let surfaceSeed: Record<string, string> | null = null;

/**
 * Surface for a tournament string ("Hard" | "Clay" | "Grass" | "Carpet").
 * Tries full tournament, then the city portion. Null when unknown — never guess.
 */
export function surfaceForTournament(name: string | null | undefined): string | null {
  if (!name) return null;
  surfaceSeed ??= loadTomlSeed<string>("tournament-surfaces.toml") ?? loadSeed<string>("tournament-surfaces.json");
  const key = normalizeKey(name);
  if (surfaceSeed[key]) return surfaceSeed[key]!;
  const city = cityFromTournament(name);
  if (city) {
    const ck = normalizeKey(city);
    if (surfaceSeed[ck]) return surfaceSeed[ck]!;
  }
  return null;
}

const GRAND_SLAMS = /wimbledon|roland garros|french open|us open|australian open/i;
const SPECIAL_EVENTS = /finals|olympics|davis cup|billie jean king cup|united cup|next gen|laver cup|exhibition/i;

let tierSeed: Record<string, string> | null = null;

export function tierFromTournament(tournament: string | null | undefined): TournamentTier {
  if (!tournament) return null;
  if (GRAND_SLAMS.test(tournament)) return "GS";
  if (SPECIAL_EVENTS.test(tournament)) return "SPECIAL";
  const m = /\b[MW](15|25|35|40|50|60|75|100)\b/.exec(tournament);
  if (m) return `ITF${m[1]}` as TournamentTier;
  if (/\bWTA\s*125|125K/i.test(tournament)) return "W125";
  if (/\bchallenger\b/i.test(tournament)) return "CH";
  const n = /\b(1000|500|250)\b/.exec(tournament);
  if (n) return n[1] as TournamentTier;
  // Named tour events without a numeric level — curated truth table
  tierSeed ??= loadTomlSeed<string>("tournament-tiers.toml") ?? loadSeed<string>("tournament-tiers.json");
  const seeded = tierSeed[normalizeKey(tournament)];
  return (seeded as TournamentTier) ?? null;
}
