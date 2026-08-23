/**
 * Canonical event identity + unified side vocabulary.
 *
 * The event-store used four event-id namespaces (canonical 32-hex hash,
 * fantasy402 numeric `odds_event_id`, Kalshi ticker, readable `match_key`)
 * and four side dialects (`home`/`away`, `winner`/`loser`, selection
 * `1`/`2`, yes/no). This module is the SSOT that unifies them:
 *
 *   - `match_key` (day|lane|sorted-last-names) is the canonical event key;
 *     `canonicalMatchKey` re-exports the single builder and
 *     `parseCanonicalMatchKey` parses it back.
 *   - `normalizeSideToHomeAway` maps every side dialect to `home`/`away`
 *     (winner/loser resolve by comparing competitor names).
 *
 * @see docs/DATA_MODEL.md — the unified model this implements
 * @see src/institutions/event-store/odds-ticks-store.ts — consumer
 */
import { buildMatchKey } from "./stadion-kalshi-bridge.ts";

export type MatchKeyParts = {
  day: string;
  lane: string;
  playerA: string;
  playerB: string;
  format: "singles" | "doubles";
};

/** Canonical event key: day|lane|sorted-last-names (null when unbuildable). */
export function canonicalMatchKey(parts: MatchKeyParts): string | null {
  return buildMatchKey(parts);
}

export type ParsedMatchKey = {
  day: string;
  lane: string;
  /** Sorted competitor last names. */
  competitors: string[];
};

/** Parse a match_key back into its parts; null when malformed (< 3 segments). */
export function parseCanonicalMatchKey(key: string): ParsedMatchKey | null {
  const parts = key.split("|");
  if (parts.length < 3 || parts.some((p) => p.length === 0)) return null;
  return { day: parts[0]!, lane: parts[1]!, competitors: parts.slice(2) };
}

const HOME_SIDES = new Set(["home", "1", "yes"]);
const AWAY_SIDES = new Set(["away", "2", "no"]);
const WINNER_LOSER = new Set(["winner", "loser"]);

export type SideResolutionNames = {
  /** The competitor the side refers to (required for `winner`/`loser`). */
  competitor?: string | null;
  home?: string | null;
  away?: string | null;
};

/**
 * Map any side dialect to canonical `home`/`away`.
 *
 * `home`/`away`, selection `1`/`2`, and yes/no map directly. `winner`/
 * `loser` resolve by comparing the winning/losing competitor's name
 * (`opts.competitor`) against the home/away names — the side of the
 * competitor named by the row. Null when names are missing or the match is
 * ambiguous (matches both or neither).
 */
export function normalizeSideToHomeAway(
  side: string | null | undefined,
  names: SideResolutionNames = {},
): "home" | "away" | null {
  const s = side?.trim().toLowerCase();
  if (!s) return null;
  if (HOME_SIDES.has(s)) return "home";
  if (AWAY_SIDES.has(s)) return "away";
  if (!WINNER_LOSER.has(s)) return null;
  // winner/loser: the competitor named on this side decides home vs away.
  const competitor = names.competitor?.trim();
  const home = names.home?.trim();
  const away = names.away?.trim();
  if (!competitor || !home || !away) return null;
  const c = competitor.toLowerCase();
  const h = home.toLowerCase();
  const a = away.toLowerCase();
  const isHome = c === h || c.includes(h) || h.includes(c);
  const isAway = c === a || c.includes(a) || a.includes(c);
  if (isHome === isAway) return null; // ambiguous or unmatched
  return isHome ? "home" : "away";
}
