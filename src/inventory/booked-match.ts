/**
 * Sport-scoped soft match: inventory home/away (+ sport/league) → Statscore booked name.
 * Used by inventory enrich to set odds_event_id (metadata only).
 */

export type BookedMatchEntry = {
  oddsEventId: string;
  name: string;
  sportName?: string | null;
  competition?: string | null;
};

type BookedMatchQuery = {
  home: string | null;
  away: string | null;
  /** Inventory sport id / bucket / display (e.g. table_tennis, tennis). */
  sport?: string | null;
  /** Stream league label — soft preference only. */
  league?: string | null;
};

/** Inventory / stream sport → normalized Statscore sport_name aliases. */
const SPORT_CATALOG_ALIASES: Record<string, string[]> = {
  table_tennis: ['table tennis', 'tabletennis'],
  tennis: ['tennis'],
  soccer: ['soccer', 'football'],
  football: ['soccer', 'football'], // stream bucket
  baseball: ['baseball'],
  basketball: ['basketball'],
  ice_hockey: ['ice hockey', 'hockey'],
  hockey: ['ice hockey', 'hockey'],
  volleyball: ['volleyball'],
  handball: ['handball'],
  cricket: ['cricket'],
  snooker: ['snooker'],
  golf: ['golf'],
  boxing: ['boxing', 'fighting'],
  fighting: ['boxing', 'fighting'],
  rugby: ['rugby', 'rugby union', 'rugby league'],
  futsal: ['futsal'],
  badminton: ['badminton'],
  darts: ['darts'],
  motorsport: ['motor racing', 'motorsport', 'formula 1', 'nascar'],
  formula_1: ['formula 1', 'motor racing'],
  horse_racing: ['horse racing', 'horses'],
  american_football: ['am. football', 'american football', 'am football', 'football'],
  australian_rules: ['australian rules', 'aussie rules'],
  bandy: ['bandy'],
  floorball: ['floorball'],
  cycling: ['cycling', 'bicycle'],
  ufc: ['mma', 'ufc', 'martial arts'],
  martial_arts: ['mma', 'martial arts', 'ufc'],
  billiards: ['billiards', 'pool'],
};

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip team/player noise common on stream-list wire. */
function stripCompetitorNoise(raw: string): string {
  let s = String(raw ?? '').trim();
  // trailing dash / emdash
  s = s.replace(/[-–—]+$/g, '').trim();
  // parenthetical country/role: (IND), (Women), (univ)
  s = s.replace(/\([^)]*\)/g, ' ');
  // common club/noise tokens
  s = s.replace(
    /\b(fc|cf|sc|ac|fk|sk|bk|afc|cfc|u19|u20|u21|u23|women|men|w|univ|pro|xi|cc)\b/gi,
    ' '
  );
  return s.replace(/\s+/g, ' ').trim();
}

/** "LAST, FIRST" / trailing dash → tokens (len ≥ 3). */
export function competitorNameTokens(raw: string): string[] {
  let s = stripCompetitorNoise(raw);
  if (!s) return [];
  if (s.includes(',')) {
    const [last, ...rest] = s.split(',').map(p => p.trim());
    s = `${rest.join(' ')} ${last ?? ''}`.trim();
  }
  return normalizeName(s)
    .split(' ')
    .filter(t => t.length >= 3);
}

export function foldCompetitorToken(t: string): string {
  let x = t.toLowerCase();
  x = x
    .replace(/yurii/g, 'yuri')
    .replace(/yuriy/g, 'yuri')
    .replace(/oleksandr/g, 'aleksandr')
    .replace(/oleksander/g, 'aleksandr')
    .replace(/vladyslav/g, 'vladislav')
    .replace(/dmitriy/g, 'dmitry')
    .replace(/dmytro/g, 'dmitry')
    .replace(/sergey/g, 'sergei')
    .replace(/serhii/g, 'sergei')
    .replace(/volodymyr/g, 'vladimir')
    .replace(/andrii/g, 'andrey')
    .replace(/andriy/g, 'andrey');
  if (x.endsWith('iy') && x.length > 4) x = x.slice(0, -2) + 'y';
  return x;
}

/** Aliases for an inventory sport key (id or display). */
export function catalogSportAliases(sport: string | null | undefined): string[] {
  if (!sport?.trim()) return [];
  const raw = sport.trim().toLowerCase().replace(/\s+/g, '_');
  const fromMap = SPORT_CATALOG_ALIASES[raw];
  if (fromMap) return fromMap;
  // "Table Tennis" / "Ice Hockey"
  const spaced = normalizeKey(sport.replace(/_/g, ' '));
  for (const [id, aliases] of Object.entries(SPORT_CATALOG_ALIASES)) {
    if (aliases.includes(spaced) || id.replace(/_/g, ' ') === spaced) {
      return aliases;
    }
  }
  return [spaced];
}

/**
 * Whether a catalog row's sportName matches inventory sport.
 * Empty catalog sportName → allow (legacy injected lists).
 * Empty inventory sport → allow all (caller should prefer scoping).
 */
export function bookedEntryMatchesSport(
  entry: BookedMatchEntry,
  inventorySport: string | null | undefined
): boolean {
  const aliases = catalogSportAliases(inventorySport);
  if (aliases.length === 0) return true;
  const sn = normalizeKey(entry.sportName ?? '');
  if (!sn) return true; // unknown catalog sport — don't hard-drop
  // American football vs soccer: do not let bare "football" match Am. football only
  // when inventory is soccer (aliases include football for soccer carefully)
  for (const a of aliases) {
    // Exact match, or catalog sport starts with / equals multi-word alias.
    // Avoid: inventory "tennis" matching catalog "table tennis" via includes("tennis").
    let hit = sn === a;
    if (!hit && a.length >= 4) {
      if (a.includes(' ')) {
        // multi-word alias: catalog may be "table tennis" or "table tennis men"
        hit = sn === a || sn.startsWith(a + ' ') || sn.includes(a);
      } else {
        // single-word: whole-token only
        hit = new RegExp(`(?:^|\\s)${escapeRe(a)}(?:\\s|$)`).test(sn);
        // "table tennis" token "tennis" would still match — block known supersets
        if (hit && a === 'tennis' && /\btable\s+tennis\b/.test(sn)) hit = false;
        if (hit && a === 'hockey' && /\bfield\s+hockey\b/.test(sn)) hit = false;
      }
    }
    if (!hit) continue;
    // Disambiguate soccer vs american football
    if (
      inventorySport &&
      /soccer|football/.test(inventorySport.toLowerCase()) &&
      !/american|am\.?/.test(inventorySport.toLowerCase())
    ) {
      if (/am\.?\s*football|american football/.test(sn)) continue;
    }
    if (
      inventorySport &&
      /american_football|am\.?\s*football/.test(
        inventorySport.toLowerCase().replace(/\s+/g, '_')
      )
    ) {
      if (sn === 'soccer') continue;
    }
    return true;
  }
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function leagueTokenBoost(
  league: string | null | undefined,
  entry: BookedMatchEntry
): number {
  if (!league?.trim()) return 0;
  const hay = normalizeName(
    `${entry.name} ${entry.competition ?? ''} ${entry.sportName ?? ''}`
  );
  const tokens = normalizeName(league)
    .split(' ')
    .filter(t => t.length >= 4);
  let hits = 0;
  for (const t of tokens) {
    if (hay.includes(t)) hits++;
  }
  if (hits === 0) return 0;
  return Math.min(20, hits * 5);
}

/**
 * Score a catalog row against home/away (higher better). null = no match.
 * 100 full substring, 90 reordered names, 80 first+last both sides,
 * 70 last-name tokens + league boost, 65 last-name + strong league.
 */
function scoreBookedMatch(
  query: BookedMatchQuery,
  entry: BookedMatchEntry
): number | null {
  const home = query.home;
  const away = query.away;
  if (!home || !away) return null;
  if (!bookedEntryMatchesSport(entry, query.sport)) return null;

  const h = normalizeName(stripCompetitorNoise(home));
  const a = normalizeName(stripCompetitorNoise(away));
  if (!h || !a) return null;
  const n = normalizeName(entry.name);
  const boost = leagueTokenBoost(query.league, entry);

  if (n.includes(h) && n.includes(a)) return 100 + boost;

  const hTokens = competitorNameTokens(home);
  const aTokens = competitorNameTokens(away);
  const hRe = hTokens.join(' ');
  const aRe = aTokens.join(' ');
  if (hRe && aRe && (hRe !== h || aRe !== a)) {
    if (n.includes(hRe) && n.includes(aRe)) return 90 + boost;
  }

  // First + last on both sides (len≥3) present as tokens in catalog name
  const nFoldTokens = new Set(
    competitorNameTokens(entry.name).map(foldCompetitorToken)
  );
  if (hTokens.length >= 2 && aTokens.length >= 2) {
    const hFirst = foldCompetitorToken(hTokens[0]!);
    const hLast = foldCompetitorToken(hTokens[hTokens.length - 1]!);
    const aFirst = foldCompetitorToken(aTokens[0]!);
    const aLast = foldCompetitorToken(aTokens[aTokens.length - 1]!);
    if (
      hFirst.length >= 3 &&
      aFirst.length >= 3 &&
      hLast.length >= 3 &&
      aLast.length >= 3 &&
      nFoldTokens.has(hFirst) &&
      nFoldTokens.has(hLast) &&
      nFoldTokens.has(aFirst) &&
      nFoldTokens.has(aLast)
    ) {
      return 80 + boost;
    }
  }

  const hLast = hTokens[hTokens.length - 1];
  const aLast = aTokens[aTokens.length - 1];
  // Single-token team names (Leon, Tabasco) — use full token as last
  const hKey =
    hLast && hLast.length >= 3
      ? hLast
      : hTokens[0] && hTokens[0].length >= 3
        ? hTokens[0]
        : h.length >= 3
          ? h
          : null;
  const aKey =
    aLast && aLast.length >= 3
      ? aLast
      : aTokens[0] && aTokens[0].length >= 3
        ? aTokens[0]
        : a.length >= 3
          ? a
          : null;
  if (!hKey || !aKey) return null;
  const hFold = foldCompetitorToken(hKey);
  const aFold = foldCompetitorToken(aKey);
  if (hFold === aFold) return null;
  const set = nFoldTokens.size
    ? nFoldTokens
    : new Set(competitorNameTokens(entry.name).map(foldCompetitorToken));
  // Also allow raw includes for short team names not split into tokens
  const nHas = (tok: string) =>
    set.has(tok) || (tok.length >= 4 && n.includes(tok));

  if (nHas(hFold) && nHas(aFold)) {
    // Strong league agreement can accept slightly shorter tokens
    if (hFold.length >= 4 && aFold.length >= 4) return 70 + boost;
    if (boost >= 10 && hFold.length >= 3 && aFold.length >= 3) return 65 + boost;
  }
  return null;
}

/**
 * Soft match inventory home/away to Statscore booked name (sport-scoped).
 */
export function matchBookedOddsEventId(
  home: string | null,
  away: string | null,
  booked: BookedMatchEntry[],
  options: { sport?: string | null; league?: string | null } = {}
): string | null {
  if (!home || !away || booked.length === 0) return null;
  const query: BookedMatchQuery = {
    home,
    away,
    sport: options.sport,
    league: options.league,
  };

  let bestId: string | null = null;
  let bestScore = -1;
  let second = -1;

  // Prefer sport-scoped pool; if empty, do not fall back to all sports (false positives)
  const scoped = options.sport
    ? booked.filter(b => bookedEntryMatchesSport(b, options.sport))
    : booked;
  const pool = scoped.length > 0 ? scoped : options.sport ? [] : booked;

  for (const b of pool) {
    const sc = scoreBookedMatch(query, b);
    if (sc == null) continue;
    if (sc > bestScore) {
      second = bestScore;
      bestScore = sc;
      bestId = b.oddsEventId;
    } else if (sc > second) {
      second = sc;
    }
  }

  // Ambiguous: two strong scores within 5 points → skip
  if (bestId && second >= 65 && bestScore - second < 5) return null;
  if (bestScore < 65) return null;
  return bestId;
}

/** Catalog fetch sport filter string for includes-match against sport_name. */
export function catalogFetchSportFilter(
  inventorySport: string | undefined
): string | undefined {
  if (!inventorySport || inventorySport === 'all') return undefined;
  const aliases = catalogSportAliases(inventorySport);
  // Prefer multi-word alias that matches Statscore ("table tennis", "ice hockey")
  const best = aliases.find(a => a.includes(' ')) ?? aliases[0];
  return best;
}
