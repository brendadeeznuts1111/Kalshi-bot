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
  inventoryBucket: string;
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
    providerMappings: { plive: { inventoryBucket: 'baseball', leagueKey: 'Mexico LMB' } },
  },
  {
    id: 'baseball.triple_a_minor_league',
    sportId: 'baseball',
    displayName: 'Triple A Minor League',
    aliases: ['Triple A Minor League'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'baseball', leagueKey: 'Triple A Minor League' },
    },
  },
  {
    id: 'basketball.ipbl_pro_division',
    sportId: 'basketball',
    displayName: 'IPBL. Pro Division',
    aliases: ['IPBL. Pro Division'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'basketball', leagueKey: 'IPBL. Pro Division' },
    },
  },
  {
    id: 'basketball.ipbl_pro_division_women',
    sportId: 'basketball',
    displayName: 'IPBL. Pro Division. Women',
    aliases: ['IPBL. Pro Division. Women'],
    gender: 'women',
    providerMappings: {
      plive: { inventoryBucket: 'basketball', leagueKey: 'IPBL. Pro Division. Women' },
    },
  },
  {
    id: 'cricket.india_indoor_series',
    sportId: 'cricket',
    displayName: 'India. Indoor Series',
    aliases: ['India. Indoor Series'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'cricket', leagueKey: 'India. Indoor Series' },
    },
  },
  {
    id: 'cricket.chennai_daily_cricket',
    sportId: 'cricket',
    displayName: 'Chennai daily cricket',
    aliases: ['Chennai daily cricket'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'cricket', leagueKey: 'Chennai daily cricket' },
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
        inventoryBucket: 'cricket',
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
      plive: { inventoryBucket: 'cricket', leagueKey: 'USA. Dallas Premier League Summer' },
    },
  },
  {
    id: 'cricket.gujrat_district_cup',
    sportId: 'cricket',
    displayName: 'Gujrat District Cup',
    aliases: ['Gujrat District Cup'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'cricket', leagueKey: 'Gujrat District Cup' },
    },
  },
  {
    id: 'cricket.chandigarh_league',
    sportId: 'cricket',
    displayName: 'Chandigarh League',
    aliases: ['Chandigarh League'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'cricket', leagueKey: 'Chandigarh League' },
    },
  },
  {
    id: 'cricket.caribbean_premier_league_2026',
    sportId: 'cricket',
    displayName: 'Caribbean Premier League 2026',
    aliases: ['Caribbean Premier League 2026'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'cricket', leagueKey: 'Caribbean Premier League 2026' },
    },
  },
  {
    id: 'cricket.1st_t20_match',
    sportId: 'cricket',
    displayName: '1st T20 Match',
    aliases: ['1st T20 Match'],
    gender: 'unknown',
    providerMappings: { plive: { inventoryBucket: 'cricket', leagueKey: '1st T20 Match' } },
  },
  {
    id: 'horse_racing.usa',
    sportId: 'horse_racing',
    displayName: 'USA',
    aliases: ['USA'],
    gender: 'unknown',
    providerMappings: { plive: { inventoryBucket: 'horse_racing', leagueKey: 'USA' } },
  },
  {
    id: 'horse_racing.japan_morioka',
    sportId: 'horse_racing',
    displayName: 'Japan. Morioka',
    aliases: ['Japan. Morioka'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'horse_racing', leagueKey: 'Japan. Morioka' },
    },
  },
  {
    id: 'horse_racing.australia_pakenham',
    sportId: 'horse_racing',
    displayName: 'Australia. Pakenham',
    aliases: ['Australia. Pakenham'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'horse_racing', leagueKey: 'Australia. Pakenham' },
    },
  },
  {
    id: 'horse_racing.australia_nowra',
    sportId: 'horse_racing',
    displayName: 'Australia. Nowra',
    aliases: ['Australia. Nowra'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'horse_racing', leagueKey: 'Australia. Nowra' },
    },
  },
  {
    id: 'horse_racing.australia_kilcoy',
    sportId: 'horse_racing',
    displayName: 'Australia. Kilcoy',
    aliases: ['Australia. Kilcoy'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'horse_racing', leagueKey: 'Australia. Kilcoy' },
    },
  },
  {
    id: 'horse_racing.australia_dubbo',
    sportId: 'horse_racing',
    displayName: 'Australia. Dubbo',
    aliases: ['Australia. Dubbo'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'horse_racing', leagueKey: 'Australia. Dubbo' },
    },
  },
  {
    id: 'ice_hockey.rhl',
    sportId: 'ice_hockey',
    displayName: 'RHL',
    aliases: ['RHL'],
    gender: 'unknown',
    providerMappings: { plive: { inventoryBucket: 'ice_hockey', leagueKey: 'RHL' } },
  },
  {
    id: 'ice_hockey.3hl_league',
    sportId: 'ice_hockey',
    displayName: '3HL League',
    aliases: ['3HL League'],
    gender: 'unknown',
    providerMappings: { plive: { inventoryBucket: 'ice_hockey', leagueKey: '3HL League' } },
  },
  {
    id: 'ice_hockey.russia_mnhl',
    sportId: 'ice_hockey',
    displayName: 'Russia. MNHL',
    aliases: ['Russia. MNHL'],
    gender: 'unknown',
    providerMappings: { plive: { inventoryBucket: 'ice_hockey', leagueKey: 'Russia. MNHL' } },
  },
  {
    id: 'soccer.usa_mpl',
    sportId: 'soccer',
    displayName: 'USA MPL',
    aliases: ['USA MPL'],
    gender: 'unknown',
    providerMappings: { plive: { inventoryBucket: 'football', leagueKey: 'USA MPL' } },
  },
  {
    id: 'soccer.leagues_cup',
    sportId: 'soccer',
    displayName: 'Leagues Cup',
    aliases: ['Leagues Cup'],
    gender: 'unknown',
    providerMappings: { plive: { inventoryBucket: 'football', leagueKey: 'Leagues Cup' } },
  },
  {
    id: 'sports_channels.usa',
    sportId: 'sports_channels',
    displayName: 'USA',
    aliases: ['USA'],
    gender: 'unknown',
    providerMappings: { plive: { inventoryBucket: 'sports_channels', leagueKey: 'USA' } },
  },
  {
    id: 'table_tennis.setka_cup',
    sportId: 'table_tennis',
    displayName: 'Setka Cup',
    aliases: ['Setka Cup'],
    gender: 'unknown',
    providerMappings: { plive: { inventoryBucket: 'table_tennis', leagueKey: 'Setka Cup' } },
  },
  {
    id: 'table_tennis.masters_russia',
    sportId: 'table_tennis',
    displayName: 'Masters. Russia',
    aliases: ['Masters. Russia'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'table_tennis', leagueKey: 'Masters. Russia' },
    },
  },
  {
    id: 'table_tennis.masters_belarus',
    sportId: 'table_tennis',
    displayName: 'Masters. Belarus',
    aliases: ['Masters. Belarus'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'table_tennis', leagueKey: 'Masters. Belarus' },
    },
  },
  {
    id: 'table_tennis.masters_poland',
    sportId: 'table_tennis',
    displayName: 'Masters. Poland',
    aliases: ['Masters. Poland'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'table_tennis', leagueKey: 'Masters. Poland' },
    },
  },
  {
    id: 'table_tennis.masters_spain',
    sportId: 'table_tennis',
    displayName: 'Masters. Spain',
    aliases: ['Masters. Spain'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'table_tennis', leagueKey: 'Masters. Spain' },
    },
  },
  {
    id: 'table_tennis.masters_poland_women',
    sportId: 'table_tennis',
    displayName: 'Masters. Poland. Women',
    aliases: ['Masters. Poland. Women'],
    gender: 'women',
    providerMappings: {
      plive: { inventoryBucket: 'table_tennis', leagueKey: 'Masters. Poland. Women' },
    },
  },
  {
    id: 'table_tennis.masters_china',
    sportId: 'table_tennis',
    displayName: 'Masters. China',
    aliases: ['Masters. China'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'table_tennis', leagueKey: 'Masters. China' },
    },
  },
  {
    id: 'table_tennis.masters_super_league',
    sportId: 'table_tennis',
    displayName: 'Masters. Super League',
    aliases: ['Masters. Super League'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'table_tennis', leagueKey: 'Masters. Super League' },
    },
  },
  {
    id: 'table_tennis.masters_argentina',
    sportId: 'table_tennis',
    displayName: 'Masters. Argentina',
    aliases: ['Masters. Argentina'],
    gender: 'unknown',
    providerMappings: {
      plive: { inventoryBucket: 'table_tennis', leagueKey: 'Masters. Argentina' },
    },
  },
  {
    id: 'table_tennis.masters_russia_women',
    sportId: 'table_tennis',
    displayName: 'Masters. Russia. Women',
    aliases: ['Masters. Russia. Women'],
    gender: 'women',
    providerMappings: {
      plive: { inventoryBucket: 'table_tennis', leagueKey: 'Masters. Russia. Women' },
    },
  },
  {
    id: 'tennis.yaponiya',
    sportId: 'tennis',
    displayName: 'Yaponiya',
    aliases: ['Yaponiya'],
    gender: 'unknown',
    providerMappings: { plive: { inventoryBucket: 'tennis', leagueKey: 'Yaponiya' } },
  },
  {
    id: 'tennis.att_togliatti',
    sportId: 'tennis',
    displayName: 'ATT Togliatti',
    aliases: ['ATT Togliatti'],
    gender: 'unknown',
    providerMappings: { plive: { inventoryBucket: 'tennis', leagueKey: 'ATT Togliatti' } },
  },
  {
    id: 'volleyball.upvl_nations_league_women',
    sportId: 'volleyball',
    displayName: 'UPVL. Nations League. Women',
    aliases: ['UPVL. Nations League. Women'],
    gender: 'women',
    providerMappings: {
      plive: { inventoryBucket: 'volleyball', leagueKey: 'UPVL. Nations League. Women' },
    },
  },
  {
    id: "soccer.regional_league_a",
    sportId: "soccer",
    displayName: "Regional League. A",
    aliases: ["Regional League. A"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "football", leagueKey: "Regional League. A" } },
  },
  {
    id: "basketball.premier_league",
    sportId: "basketball",
    displayName: "Premier League",
    aliases: ["Premier League"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "basketball", leagueKey: "Premier League" } },
  },
  {
    id: "basketball.ipbl_prime_division",
    sportId: "basketball",
    displayName: "IPBL. Prime Division",
    aliases: ["IPBL. Prime Division"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "basketball", leagueKey: "IPBL. Prime Division" } },
  },
  {
    id: "basketball.bskt_cup",
    sportId: "basketball",
    displayName: "BSKT CUP",
    aliases: ["BSKT CUP"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "basketball", leagueKey: "BSKT CUP" } },
  },
  {
    id: "snooker.china_open_2026_2026_2027",
    sportId: "snooker",
    displayName: "China Open 2026 - 2026/2027",
    aliases: ["China Open 2026 - 2026/2027"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "snooker", leagueKey: "China Open 2026 - 2026/2027" } },
  },
  {
    id: "soccer.regional_league_w",
    sportId: "soccer",
    displayName: "Regional League. W",
    aliases: ["Regional League. W"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "football", leagueKey: "Regional League. W" } },
  },
  {
    id: "soccer.angola_liga_bantu",
    sportId: "soccer",
    displayName: "Angola. Liga Bantu",
    aliases: ["Angola. Liga Bantu"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "football", leagueKey: "Angola. Liga Bantu" } },
  },
  {
    id: "basketball.ipbl_cage",
    sportId: "basketball",
    displayName: "IPBL. CAGE",
    aliases: ["IPBL. CAGE"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "basketball", leagueKey: "IPBL. CAGE" } },
  },
  {
    id: "basketball.ipbl_prime_division_women",
    sportId: "basketball",
    displayName: "IPBL. Prime Division. Women",
    aliases: ["IPBL. Prime Division. Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "IPBL. Prime Division. Women" },
    },
  },
  {
    id: "basketball.china_cdbl",
    sportId: "basketball",
    displayName: "China. CDBL",
    aliases: ["China. CDBL"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "basketball", leagueKey: "China. CDBL" } },
  },
  {
    id: "basketball.u23_nations_league",
    sportId: "basketball",
    displayName: "U23 Nations League",
    aliases: ["U23 Nations League"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "basketball", leagueKey: "U23 Nations League" } },
  },
  {
    id: "basketball.pro_division_woman",
    sportId: "basketball",
    displayName: "PRO Division Woman",
    aliases: ["PRO Division Woman"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "basketball", leagueKey: "PRO Division Woman" } },
  },
  {
    id: "basketball.u23_nations_league_women",
    sportId: "basketball",
    displayName: "U23 Nations League, Women",
    aliases: ["U23 Nations League, Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "U23 Nations League, Women" },
    },
  },
  {
    id: "tennis.russia_league_pro",
    sportId: "tennis",
    displayName: "Russia. League Pro",
    aliases: ["Russia. League Pro"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "tennis", leagueKey: "Russia. League Pro" } },
  },
  {
    id: "tennis.atp_challenger_astana_kazakhstan_men_singles",
    sportId: "tennis",
    displayName: "ATP Challenger Astana, Kazakhstan Men Singles",
    aliases: ["ATP Challenger Astana, Kazakhstan Men Singles"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Challenger Astana, Kazakhstan Men Singles" },
    },
  },
  {
    id: "ice_hockey.dream_league",
    sportId: "ice_hockey",
    displayName: "Dream League",
    aliases: ["Dream League"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "ice_hockey", leagueKey: "Dream League" } },
  },
  {
    id: "ice_hockey.nhl_26_blast_hockey_league",
    sportId: "ice_hockey",
    displayName: "NHL 26. Blast hockey league",
    aliases: ["NHL 26. Blast hockey league"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "ice_hockey", leagueKey: "NHL 26. Blast hockey league" } },
  },
  {
    id: "ice_hockey.tournament_magnitka_open",
    sportId: "ice_hockey",
    displayName: "Tournament Magnitka Open",
    aliases: ["Tournament Magnitka Open"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "ice_hockey", leagueKey: "Tournament Magnitka Open" } },
  },
  {
    id: "volleyball.russia_league_pro_women",
    sportId: "volleyball",
    displayName: "Russia. League Pro. Women",
    aliases: ["Russia. League Pro. Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "Russia. League Pro. Women" },
    },
  },
  {
    id: "volleyball.belarus_liga_pro",
    sportId: "volleyball",
    displayName: "Belarus. Liga Pro",
    aliases: ["Belarus. Liga Pro"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "volleyball", leagueKey: "Belarus. Liga Pro" } },
  },
  {
    id: "cricket.india_zeo_corporate_league",
    sportId: "cricket",
    displayName: "India. Zeo Corporate League",
    aliases: ["India. Zeo Corporate League"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "cricket", leagueKey: "India. Zeo Corporate League" } },
  },
  {
    id: "cricket.india_rajwar_premier_league",
    sportId: "cricket",
    displayName: "India. Rajwar Premier League",
    aliases: ["India. Rajwar Premier League"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "cricket", leagueKey: "India. Rajwar Premier League" } },
  },
  {
    id: "cricket.india_visakhapatnam_champions_premier_league",
    sportId: "cricket",
    displayName: "India. Visakhapatnam Champions Premier League",
    aliases: ["India. Visakhapatnam Champions Premier League"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "cricket", leagueKey: "India. Visakhapatnam Champions Premier League" } },
  },
  {
    id: "cricket.karachi_challenge_cup",
    sportId: "cricket",
    displayName: "Karachi Challenge Cup",
    aliases: ["Karachi Challenge Cup"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "cricket", leagueKey: "Karachi Challenge Cup" } },
  },
  {
    id: "horse_racing.japan_kanazawa",
    sportId: "horse_racing",
    displayName: "Japan. Kanazawa",
    aliases: ["Japan. Kanazawa"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "horse_racing", leagueKey: "Japan. Kanazawa" } },
  },
  {
    id: "horse_racing.japan_urawa",
    sportId: "horse_racing",
    displayName: "Japan. Urawa",
    aliases: ["Japan. Urawa"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "horse_racing", leagueKey: "Japan. Urawa" } },
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
