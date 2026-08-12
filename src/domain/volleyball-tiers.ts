/**
 * Volleyball competition desk tiers + NCAA seed keys.
 *
 * Tier is operator sizing SSOT (not feed-native). Prefer
 * {@link resolveVolleyballCompetitionTier} over hardcoding A/B/C/D at call sites.
 *
 * @see docs/VOLLEYBALL-TIERS.md
 */

import type { CompetitionRecord } from './competitions.ts';

/** Desk sizing tiers for volleyball inventory / analyze. */
export const VOLLEYBALL_COMPETITION_TIERS = ['A', 'B', 'C', 'D'] as const;
export type VolleyballCompetitionTier = (typeof VOLLEYBALL_COMPETITION_TIERS)[number];

/**
 * Explicit tier by competition id (overrides label heuristics).
 * Keep in sync when promoting new volleyball comps.
 */
export const VOLLEYBALL_TIER_BY_COMPETITION_ID: Readonly<
  Record<string, VolleyballCompetitionTier>
> = {
  // ── National / continental flagship (A) ───────────────────────────────
  'volleyball.international_nations_league_women': 'A',
  'volleyball.upvl_nations_league_women': 'A',
  'volleyball.olympics_volleyball_men': 'A',
  'volleyball.olympics_volleyball_women': 'A',
  'volleyball.international_fivb_championship_women': 'A',
  'volleyball.international_world_championship_2022_w': 'A',
  'volleyball.international_cev_champions_league': 'A',
  'volleyball.ncaa_women_s_volleyball': 'A',
  'volleyball.ncaa_women_s_volleyball_tournament': 'A',
  'volleyball.ncaa_big_ten_women': 'A',
  'volleyball.ncaa_sec_women': 'A',
  'volleyball.ncaa_acc_women': 'A',
  'volleyball.ncaa_big_12_women': 'A',

  // ── Strong club / cup / beach elite (B) ───────────────────────────────
  'volleyball.international_cev_cup_women_1_16_finals': 'B',
  'volleyball.international_champion_league': 'B',
  'volleyball.international_copa_sudamericana': 'B',
  'volleyball.italy_italian_championships_women': 'B',
  'volleyball.russia_league_pro_women': 'B',
  'volleyball.south_korea_v_league_women': 'B',
  'volleyball.germany_beach_pro_tour_elite_16_hamburg_men': 'B',
  'volleyball.germany_beach_pro_tour_elite_16_hamburg_women': 'B',
  'volleyball.ncaa_beach_volleyball': 'B',
  'volleyball.ncaa_men_s_volleyball': 'B',

  // ── Mid domestic / regional / beach mid (C) ───────────────────────────
  'volleyball.belarus_liga_pro': 'C',
  'volleyball.israel_premier_league_women': 'C',
  'volleyball.vietnam_premier_league_w': 'C',
  'volleyball.vietnam_championship_women': 'C',
  'volleyball.argentina_torneo_argentino': 'C',
  'volleyball.brazil_open_women': 'C',
  'volleyball.costa_rica_primera_division': 'C',
  'volleyball.international_central_american_and_caribbean_games_women': 'C',
  'volleyball.international_liga_pro_challenge_tour': 'C',
  'volleyball.germany_beach_pro_tour_hamburg': 'C',
  'volleyball.germany_beach_pro_tour_hamburg_women': 'C',
  'volleyball.beach_volleyball': 'C',
  'volleyball.ncaa_dii_women': 'C',
  'volleyball.ncaa_diii_women': 'C',

  // ── Thin / friendly / obscure (D) ─────────────────────────────────────
  'volleyball.friendly_international': 'D',
  'volleyball.international_friendly_women': 'D',
  'volleyball.gambia_national_championship_w': 'D',
  /** Feed country bucket (RU “Indiya” = India); branch/cup noise. */
  'volleyball.indiya': 'D',
};

/**
 * Infer desk tier from a feed league label when id is unmapped.
 * Conservative: unknown NCAA → A (DI women is the default college product).
 */
export function inferVolleyballTierFromLeagueLabel(
  leagueKey: string,
): VolleyballCompetitionTier | null {
  const s = leagueKey.trim();
  if (!s) return null;
  const low = s.toLowerCase();

  // Beach
  if (/beach/.test(low)) {
    if (/elite\s*16|elite16/.test(low)) return 'B';
    if (/ncaa|college/.test(low)) return 'B';
    return 'C';
  }

  // NCAA / college
  if (/\bncaa\b|\bcollege\b|\bncaaw\b/.test(low)) {
    if (/diii|d3|division\s*iii/.test(low)) return 'C';
    if (/dii\b|d2\b|division\s*ii/.test(low)) return 'C';
    if (/\bmen\b/.test(low) && !/\bwomen\b/.test(low)) return 'B';
    if (/big\s*ten|big\s*10|sec\b|acc\b|big\s*12|big\s*twelve/.test(low)) return 'A';
    if (/tournament|championship|final\s*four|ncaa\s*tournament/.test(low)) return 'A';
    return 'A';
  }

  // National team flagship
  if (
    /nations\s*league|\bvnl\b|olympics?|world\s*championship|fivb\s*championship/.test(
      low,
    )
  ) {
    return 'A';
  }

  // Club Europe top cups + elite domestics
  if (
    /cev\s*champions|champions\s*league|superlega|plusliga|superliga|efeler|sultanlar|v-?league/.test(
      low,
    )
  ) {
    return 'A';
  }
  if (/cev\s*cup|challenge\s*cup|serie\s*a|tauron/.test(low)) return 'B';

  // Friendlies / thin
  if (/friend|friendl/.test(low)) return 'D';
  // Country-only feed buckets (translit)
  if (/^(indiya|india|rossiya|belarusy|niderlandi)$/.test(low)) return 'D';

  // Default unmapped volleyball league → mid desk caution
  return 'C';
}

/**
 * Resolve desk tier for a volleyball competition id and/or league label.
 * Prefers id map; falls back to label heuristics.
 */
export function resolveVolleyballCompetitionTier(input: {
  competitionId?: string | null;
  leagueKey?: string | null;
}): VolleyballCompetitionTier | null {
  const id = input.competitionId?.trim();
  if (id && VOLLEYBALL_TIER_BY_COMPETITION_ID[id]) {
    return VOLLEYBALL_TIER_BY_COMPETITION_ID[id]!;
  }
  if (input.leagueKey?.trim()) {
    return inferVolleyballTierFromLeagueLabel(input.leagueKey);
  }
  if (id?.startsWith('volleyball.')) return 'C';
  return null;
}

export function isVolleyballCompetitionTier(
  value: string,
): value is VolleyballCompetitionTier {
  return (VOLLEYBALL_COMPETITION_TIERS as readonly string[]).includes(value);
}

/**
 * NCAA / college volleyball seed rows for COMPETITIONS promote.
 * Aliases cover common plive/Pandora label variants before first live sighting.
 */
export const NCAA_VOLLEYBALL_COMPETITION_SEEDS: readonly CompetitionRecord[] = [
  {
    id: 'volleyball.ncaa_women_s_volleyball',
    sportId: 'volleyball',
    displayName: "NCAA Women's Volleyball",
    aliases: [
      "NCAA Women's Volleyball",
      'NCAA Volleyball Women',
      'NCAA Volleyball',
      'College Volleyball',
      "College Volleyball Women",
      "NCAA DI Women's Volleyball",
      "NCAA Division I Women's Volleyball",
      'NCAAW Volleyball',
    ],
    gender: 'women',
    providerMappings: {
      plive: {
        inventoryBucket: 'volleyball',
        leagueKey: "NCAA Women's Volleyball",
      },
    },
  },
  {
    id: 'volleyball.ncaa_women_s_volleyball_tournament',
    sportId: 'volleyball',
    displayName: "NCAA Women's Volleyball Tournament",
    aliases: [
      "NCAA Women's Volleyball Tournament",
      'NCAA Volleyball Tournament Women',
      "NCAA Tournament Women's Volleyball",
      'NCAA Volleyball Championship Women',
    ],
    gender: 'women',
    providerMappings: {
      plive: {
        inventoryBucket: 'volleyball',
        leagueKey: "NCAA Women's Volleyball Tournament",
      },
    },
  },
  {
    id: 'volleyball.ncaa_big_ten_women',
    sportId: 'volleyball',
    displayName: "NCAA Big Ten Women's Volleyball",
    aliases: [
      "NCAA Big Ten Women's Volleyball",
      'NCAA Big Ten Women Volleyball',
      'Big Ten Volleyball Women',
      "Big Ten Women's Volleyball",
      'Big Ten Women Volleyball',
      'NCAA Big 10 Volleyball Women',
      'NCAA Big Ten Volleyball Women',
    ],
    gender: 'women',
    providerMappings: {
      plive: {
        inventoryBucket: 'volleyball',
        leagueKey: "NCAA Big Ten Women's Volleyball",
      },
    },
  },
  {
    id: 'volleyball.ncaa_sec_women',
    sportId: 'volleyball',
    displayName: "NCAA SEC Women's Volleyball",
    aliases: [
      "NCAA SEC Women's Volleyball",
      'NCAA SEC Women Volleyball',
      'SEC Volleyball Women',
      "SEC Women's Volleyball",
      'SEC Women Volleyball',
      'NCAA SEC Volleyball Women',
    ],
    gender: 'women',
    providerMappings: {
      plive: {
        inventoryBucket: 'volleyball',
        leagueKey: "NCAA SEC Women's Volleyball",
      },
    },
  },
  {
    id: 'volleyball.ncaa_acc_women',
    sportId: 'volleyball',
    displayName: "NCAA ACC Women's Volleyball",
    aliases: [
      "NCAA ACC Women's Volleyball",
      'NCAA ACC Women Volleyball',
      'ACC Volleyball Women',
      "ACC Women's Volleyball",
      'ACC Women Volleyball',
      'NCAA ACC Volleyball Women',
    ],
    gender: 'women',
    providerMappings: {
      plive: {
        inventoryBucket: 'volleyball',
        leagueKey: "NCAA ACC Women's Volleyball",
      },
    },
  },
  {
    id: 'volleyball.ncaa_big_12_women',
    sportId: 'volleyball',
    displayName: "NCAA Big 12 Women's Volleyball",
    aliases: [
      "NCAA Big 12 Women's Volleyball",
      'NCAA Big 12 Women Volleyball',
      'Big 12 Volleyball Women',
      "Big 12 Women's Volleyball",
      'Big 12 Women Volleyball',
      'NCAA Big Twelve Volleyball Women',
      'NCAA Big 12 Volleyball Women',
    ],
    gender: 'women',
    providerMappings: {
      plive: {
        inventoryBucket: 'volleyball',
        leagueKey: "NCAA Big 12 Women's Volleyball",
      },
    },
  },
  {
    id: 'volleyball.ncaa_men_s_volleyball',
    sportId: 'volleyball',
    displayName: "NCAA Men's Volleyball",
    aliases: [
      "NCAA Men's Volleyball",
      'NCAA Volleyball Men',
      "College Volleyball Men",
      "NCAA DI Men's Volleyball",
    ],
    gender: 'men',
    providerMappings: {
      plive: {
        inventoryBucket: 'volleyball',
        leagueKey: "NCAA Men's Volleyball",
      },
    },
  },
  {
    id: 'volleyball.ncaa_beach_volleyball',
    sportId: 'volleyball',
    displayName: 'NCAA Beach Volleyball',
    aliases: [
      'NCAA Beach Volleyball',
      "NCAA Women's Beach Volleyball",
      'College Beach Volleyball',
    ],
    gender: 'women',
    providerMappings: {
      plive: {
        inventoryBucket: 'volleyball',
        leagueKey: 'NCAA Beach Volleyball',
      },
    },
  },
  {
    id: 'volleyball.ncaa_dii_women',
    sportId: 'volleyball',
    displayName: "NCAA DII Women's Volleyball",
    aliases: [
      "NCAA DII Women's Volleyball",
      "NCAA Division II Women's Volleyball",
      'NCAA D2 Volleyball Women',
    ],
    gender: 'women',
    providerMappings: {
      plive: {
        inventoryBucket: 'volleyball',
        leagueKey: "NCAA DII Women's Volleyball",
      },
    },
  },
  {
    id: 'volleyball.ncaa_diii_women',
    sportId: 'volleyball',
    displayName: "NCAA DIII Women's Volleyball",
    aliases: [
      "NCAA DIII Women's Volleyball",
      "NCAA Division III Women's Volleyball",
      'NCAA D3 Volleyball Women',
    ],
    gender: 'women',
    providerMappings: {
      plive: {
        inventoryBucket: 'volleyball',
        leagueKey: "NCAA DIII Women's Volleyball",
      },
    },
  },
];

/** All volleyball competition ids that have an explicit tier pin. */
export function listVolleyballTieredCompetitionIds(): string[] {
  return Object.keys(VOLLEYBALL_TIER_BY_COMPETITION_ID).sort();
}

export function listVolleyballCompetitionIdsByTier(
  tier: VolleyballCompetitionTier,
): string[] {
  return Object.entries(VOLLEYBALL_TIER_BY_COMPETITION_ID)
    .filter(([, t]) => t === tier)
    .map(([id]) => id)
    .sort();
}
