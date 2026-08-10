/**
 * Canonical competitions (leagues) under sports — provider-/skin-agnostic ids.
 *
 * Plive inventory wire: stream-list-v2 bucket + league string (no markets).
 * ezlive shares the plive shell mapping via resolveCompetition fallback.
 */

import { getSport, type SportId } from './sports.ts';

export const COMPETITION_GENDERS = ['men', 'women', 'mixed', 'unknown'] as const;
export type CompetitionGender = (typeof COMPETITION_GENDERS)[number];

export type PliveCompetitionMapping = {
  /** Wire sport bucket key (e.g. table_tennis, football). */
  streamBucket: string;
  /** Exact feed league string. */
  leagueKey: string;
};

export type CompetitionRecord = {
  id: string;
  sportId: SportId;
  displayName: string;
  aliases: string[];
  gender: CompetitionGender;
  providerMappings: {
    plive?: PliveCompetitionMapping;
  };
};

/**
 * Seeded from observed Buckeye/Plive stream-list + skin_events leagues.
 * Junk matchup blobs / person-like league labels intentionally omitted.
 */
export const COMPETITIONS = [
  {
    id: 'baseball.mexico_lmb',
    sportId: 'baseball',
    displayName: 'Mexico LMB',
    aliases: ['Mexico LMB'],
    gender: 'unknown',
    providerMappings: { plive: { streamBucket: 'baseball', leagueKey: 'Mexico LMB' } },
  },
  {
    id: 'baseball.triple_a_minor_league',
    sportId: 'baseball',
    displayName: 'Triple A Minor League',
    aliases: ['Triple A Minor League'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'baseball', leagueKey: 'Triple A Minor League' },
    },
  },
  {
    id: 'basketball.ipbl_pro_division',
    sportId: 'basketball',
    displayName: 'IPBL. Pro Division',
    aliases: ['IPBL. Pro Division'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'basketball', leagueKey: 'IPBL. Pro Division' },
    },
  },
  {
    id: 'basketball.ipbl_pro_division_women',
    sportId: 'basketball',
    displayName: 'IPBL. Pro Division. Women',
    aliases: ['IPBL. Pro Division. Women'],
    gender: 'women',
    providerMappings: {
      plive: { streamBucket: 'basketball', leagueKey: 'IPBL. Pro Division. Women' },
    },
  },
  {
    id: 'cricket.india_indoor_series',
    sportId: 'cricket',
    displayName: 'India. Indoor Series',
    aliases: ['India. Indoor Series'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'cricket', leagueKey: 'India. Indoor Series' },
    },
  },
  {
    id: 'cricket.chennai_daily_cricket',
    sportId: 'cricket',
    displayName: 'Chennai daily cricket',
    aliases: ['Chennai daily cricket'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'cricket', leagueKey: 'Chennai daily cricket' },
    },
  },
  {
    id: 'cricket.usa_keenstack_champions_premier_league',
    sportId: 'cricket',
    displayName: 'USA. Keenstack Champions Premier League',
    aliases: ['USA. Keenstack Champions Premier League'],
    gender: 'unknown',
    providerMappings: {
      plive: {
        streamBucket: 'cricket',
        leagueKey: 'USA. Keenstack Champions Premier League',
      },
    },
  },
  {
    id: 'cricket.usa_dallas_premier_league_summer',
    sportId: 'cricket',
    displayName: 'USA. Dallas Premier League Summer',
    aliases: ['USA. Dallas Premier League Summer'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'cricket', leagueKey: 'USA. Dallas Premier League Summer' },
    },
  },
  {
    id: 'cricket.gujrat_district_cup',
    sportId: 'cricket',
    displayName: 'Gujrat District Cup',
    aliases: ['Gujrat District Cup'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'cricket', leagueKey: 'Gujrat District Cup' },
    },
  },
  {
    id: 'cricket.chandigarh_league',
    sportId: 'cricket',
    displayName: 'Chandigarh League',
    aliases: ['Chandigarh League'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'cricket', leagueKey: 'Chandigarh League' },
    },
  },
  {
    id: 'cricket.caribbean_premier_league_2026',
    sportId: 'cricket',
    displayName: 'Caribbean Premier League 2026',
    aliases: ['Caribbean Premier League 2026'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'cricket', leagueKey: 'Caribbean Premier League 2026' },
    },
  },
  {
    id: 'cricket.1st_t20_match',
    sportId: 'cricket',
    displayName: '1st T20 Match',
    aliases: ['1st T20 Match'],
    gender: 'unknown',
    providerMappings: { plive: { streamBucket: 'cricket', leagueKey: '1st T20 Match' } },
  },
  {
    id: 'horse_racing.usa',
    sportId: 'horse_racing',
    displayName: 'USA',
    aliases: ['USA'],
    gender: 'unknown',
    providerMappings: { plive: { streamBucket: 'horse_racing', leagueKey: 'USA' } },
  },
  {
    id: 'horse_racing.japan_morioka',
    sportId: 'horse_racing',
    displayName: 'Japan. Morioka',
    aliases: ['Japan. Morioka'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'horse_racing', leagueKey: 'Japan. Morioka' },
    },
  },
  {
    id: 'horse_racing.australia_pakenham',
    sportId: 'horse_racing',
    displayName: 'Australia. Pakenham',
    aliases: ['Australia. Pakenham'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'horse_racing', leagueKey: 'Australia. Pakenham' },
    },
  },
  {
    id: 'horse_racing.australia_nowra',
    sportId: 'horse_racing',
    displayName: 'Australia. Nowra',
    aliases: ['Australia. Nowra'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'horse_racing', leagueKey: 'Australia. Nowra' },
    },
  },
  {
    id: 'horse_racing.australia_kilcoy',
    sportId: 'horse_racing',
    displayName: 'Australia. Kilcoy',
    aliases: ['Australia. Kilcoy'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'horse_racing', leagueKey: 'Australia. Kilcoy' },
    },
  },
  {
    id: 'horse_racing.australia_dubbo',
    sportId: 'horse_racing',
    displayName: 'Australia. Dubbo',
    aliases: ['Australia. Dubbo'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'horse_racing', leagueKey: 'Australia. Dubbo' },
    },
  },
  {
    id: 'ice_hockey.rhl',
    sportId: 'ice_hockey',
    displayName: 'RHL',
    aliases: ['RHL'],
    gender: 'unknown',
    providerMappings: { plive: { streamBucket: 'ice_hockey', leagueKey: 'RHL' } },
  },
  {
    id: 'ice_hockey.3hl_league',
    sportId: 'ice_hockey',
    displayName: '3HL League',
    aliases: ['3HL League'],
    gender: 'unknown',
    providerMappings: { plive: { streamBucket: 'ice_hockey', leagueKey: '3HL League' } },
  },
  {
    id: 'ice_hockey.russia_mnhl',
    sportId: 'ice_hockey',
    displayName: 'Russia. MNHL',
    aliases: ['Russia. MNHL'],
    gender: 'unknown',
    providerMappings: { plive: { streamBucket: 'ice_hockey', leagueKey: 'Russia. MNHL' } },
  },
  {
    id: 'soccer.usa_mpl',
    sportId: 'soccer',
    displayName: 'USA MPL',
    aliases: ['USA MPL'],
    gender: 'unknown',
    providerMappings: { plive: { streamBucket: 'football', leagueKey: 'USA MPL' } },
  },
  {
    id: 'soccer.leagues_cup',
    sportId: 'soccer',
    displayName: 'Leagues Cup',
    aliases: ['Leagues Cup'],
    gender: 'unknown',
    providerMappings: { plive: { streamBucket: 'football', leagueKey: 'Leagues Cup' } },
  },
  {
    id: 'sports_channels.usa',
    sportId: 'sports_channels',
    displayName: 'USA',
    aliases: ['USA'],
    gender: 'unknown',
    providerMappings: { plive: { streamBucket: 'sports_channels', leagueKey: 'USA' } },
  },
  {
    id: 'table_tennis.setka_cup',
    sportId: 'table_tennis',
    displayName: 'Setka Cup',
    aliases: ['Setka Cup'],
    gender: 'unknown',
    providerMappings: { plive: { streamBucket: 'table_tennis', leagueKey: 'Setka Cup' } },
  },
  {
    id: 'table_tennis.masters_russia',
    sportId: 'table_tennis',
    displayName: 'Masters. Russia',
    aliases: ['Masters. Russia'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'table_tennis', leagueKey: 'Masters. Russia' },
    },
  },
  {
    id: 'table_tennis.masters_belarus',
    sportId: 'table_tennis',
    displayName: 'Masters. Belarus',
    aliases: ['Masters. Belarus'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'table_tennis', leagueKey: 'Masters. Belarus' },
    },
  },
  {
    id: 'table_tennis.masters_poland',
    sportId: 'table_tennis',
    displayName: 'Masters. Poland',
    aliases: ['Masters. Poland'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'table_tennis', leagueKey: 'Masters. Poland' },
    },
  },
  {
    id: 'table_tennis.masters_spain',
    sportId: 'table_tennis',
    displayName: 'Masters. Spain',
    aliases: ['Masters. Spain'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'table_tennis', leagueKey: 'Masters. Spain' },
    },
  },
  {
    id: 'table_tennis.masters_poland_women',
    sportId: 'table_tennis',
    displayName: 'Masters. Poland. Women',
    aliases: ['Masters. Poland. Women'],
    gender: 'women',
    providerMappings: {
      plive: { streamBucket: 'table_tennis', leagueKey: 'Masters. Poland. Women' },
    },
  },
  {
    id: 'table_tennis.masters_china',
    sportId: 'table_tennis',
    displayName: 'Masters. China',
    aliases: ['Masters. China'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'table_tennis', leagueKey: 'Masters. China' },
    },
  },
  {
    id: 'table_tennis.masters_super_league',
    sportId: 'table_tennis',
    displayName: 'Masters. Super League',
    aliases: ['Masters. Super League'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'table_tennis', leagueKey: 'Masters. Super League' },
    },
  },
  {
    id: 'table_tennis.masters_argentina',
    sportId: 'table_tennis',
    displayName: 'Masters. Argentina',
    aliases: ['Masters. Argentina'],
    gender: 'unknown',
    providerMappings: {
      plive: { streamBucket: 'table_tennis', leagueKey: 'Masters. Argentina' },
    },
  },
  {
    id: 'table_tennis.masters_russia_women',
    sportId: 'table_tennis',
    displayName: 'Masters. Russia. Women',
    aliases: ['Masters. Russia. Women'],
    gender: 'women',
    providerMappings: {
      plive: { streamBucket: 'table_tennis', leagueKey: 'Masters. Russia. Women' },
    },
  },
  {
    id: 'tennis.yaponiya',
    sportId: 'tennis',
    displayName: 'Yaponiya',
    aliases: ['Yaponiya'],
    gender: 'unknown',
    providerMappings: { plive: { streamBucket: 'tennis', leagueKey: 'Yaponiya' } },
  },
  {
    id: 'tennis.att_togliatti',
    sportId: 'tennis',
    displayName: 'ATT Togliatti',
    aliases: ['ATT Togliatti'],
    gender: 'unknown',
    providerMappings: { plive: { streamBucket: 'tennis', leagueKey: 'ATT Togliatti' } },
  },
  {
    id: 'volleyball.upvl_nations_league_women',
    sportId: 'volleyball',
    displayName: 'UPVL. Nations League. Women',
    aliases: ['UPVL. Nations League. Women'],
    gender: 'women',
    providerMappings: {
      plive: { streamBucket: 'volleyball', leagueKey: 'UPVL. Nations League. Women' },
    },
  },
] as const satisfies readonly CompetitionRecord[];

export type CompetitionId = (typeof COMPETITIONS)[number]['id'];

const byId = new Map<string, (typeof COMPETITIONS)[number]>(COMPETITIONS.map(c => [c.id, c]));

/** Normalize league wire for matching (trim, collapse space, lower). */
export function normalizeLeagueKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Infer gender from feed league label (. Women / Women suffix). */
export function inferGenderFromLeagueLabel(league: string): CompetitionGender {
  if (/\bwomen\b/i.test(league)) return 'women';
  if (/\bmen\b/i.test(league) && !/\bwomen\b/i.test(league)) return 'men';
  return 'unknown';
}

export function competitionSlugFromLeague(league: string): string {
  return league
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .replace(/_+/g, '_');
}

export function isCompetitionId(value: string): value is CompetitionId {
  return byId.has(value.trim());
}

export function getCompetition(id: string): (typeof COMPETITIONS)[number] | undefined {
  return byId.get(id.trim());
}

export function listCompetitions(): readonly (typeof COMPETITIONS)[number][] {
  return COMPETITIONS;
}

export function listCompetitionsBySport(
  sportId: SportId
): readonly (typeof COMPETITIONS)[number][] {
  if (!getSport(sportId)) return [];
  return COMPETITIONS.filter(c => c.sportId === sportId);
}
