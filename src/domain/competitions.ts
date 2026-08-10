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

/** Pandora / SportsWidgets feed league id (from live.leagues room). */
export type PandoraCompetitionMapping = {
  /** Feed league id (stringified). */
  leagueId: string;
  /** Feed sport id on live.leagues.sportId. */
  feedSportId: string;
};

export type CompetitionRecord = {
  id: string;
  sportId: SportId;
  displayName: string;
  aliases: string[];
  gender: CompetitionGender;
  providerMappings: {
    plive?: PliveCompetitionMapping;
    /** Optional Pandora external id for priced-plane / widget domain harvest. */
    pandora?: PandoraCompetitionMapping;
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
  {
    id: "tennis.att_saransk",
    sportId: "tennis",
    displayName: "ATT. Saransk",
    aliases: ["ATT. Saransk"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "tennis", leagueKey: "ATT. Saransk" } },
  },
  {
    id: "cricket.evropeyskaya_seriya",
    sportId: "cricket",
    displayName: "Evropeyskaya seriya",
    aliases: ["Evropeyskaya seriya"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "cricket", leagueKey: "Evropeyskaya seriya" } },
  },
  {
    id: "cricket.pakistan_escribir_academy_grassroots_tournament",
    sportId: "cricket",
    displayName: "Pakistan. Escribir Academy Grassroots Tournament",
    aliases: ["Pakistan. Escribir Academy Grassroots Tournament"],
    gender: "unknown",
    providerMappings: { plive: { inventoryBucket: "cricket", leagueKey: "Pakistan. Escribir Academy Grassroots Tournament" } },
  },
  {
    id: "soccer.afc_world_cup_qualifiers",
    sportId: "soccer",
    displayName: "AFC World Cup Qualifiers",
    aliases: ["AFC World Cup Qualifiers"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "AFC World Cup Qualifiers" },
      pandora: { leagueId: "9086", feedSportId: "5" },
    },
  },
  {
    id: "soccer.argentina_championship_women",
    sportId: "soccer",
    displayName: "Argentina Championship - Women",
    aliases: ["Argentina Championship - Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Argentina Championship - Women" },
      pandora: { leagueId: "16317", feedSportId: "5" },
    },
  },
  {
    id: "soccer.argentina_copa_liga_profesional",
    sportId: "soccer",
    displayName: "Argentina Copa Liga Profesional",
    aliases: ["Argentina Copa Liga Profesional"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Argentina Copa Liga Profesional" },
      pandora: { leagueId: "11984", feedSportId: "5" },
    },
  },
  {
    id: "soccer.argentina_cup",
    sportId: "soccer",
    displayName: "Argentina Cup",
    aliases: ["Argentina Cup"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Argentina Cup" },
      pandora: { leagueId: "5523", feedSportId: "5" },
    },
  },
  {
    id: "soccer.argentina_liga_profesional",
    sportId: "soccer",
    displayName: "Argentina Liga Profesional",
    aliases: ["Argentina Liga Profesional"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Argentina Liga Profesional" },
      pandora: { leagueId: "12156", feedSportId: "5" },
    },
  },
  {
    id: "soccer.argentina_primera_b",
    sportId: "soccer",
    displayName: "Argentina Primera B",
    aliases: ["Argentina Primera B"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Argentina Primera B" },
      pandora: { leagueId: "1960", feedSportId: "5" },
    },
  },
  {
    id: "soccer.argentina_primera_nacional",
    sportId: "soccer",
    displayName: "Argentina Primera Nacional",
    aliases: ["Argentina Primera Nacional"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Argentina Primera Nacional" },
      pandora: { leagueId: "8971", feedSportId: "5" },
    },
  },
  {
    id: "soccer.argentina_reserve_league",
    sportId: "soccer",
    displayName: "Argentina Reserve League",
    aliases: ["Argentina Reserve League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Argentina Reserve League" },
      pandora: { leagueId: "4898", feedSportId: "5" },
    },
  },
  {
    id: "soccer.argentina_torneo_federal_a",
    sportId: "soccer",
    displayName: "Argentina Torneo Federal A",
    aliases: ["Argentina Torneo Federal A"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Argentina Torneo Federal A" },
      pandora: { leagueId: "4452", feedSportId: "5" },
    },
  },
  {
    id: "soccer.armenia_premier_league",
    sportId: "soccer",
    displayName: "Armenia Premier League",
    aliases: ["Armenia Premier League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Armenia Premier League" },
      pandora: { leagueId: "1841", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_a_league",
    sportId: "soccer",
    displayName: "Australia A-League",
    aliases: ["Australia A-League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia A-League" },
      pandora: { leagueId: "217", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_capital_territory_premier_league",
    sportId: "soccer",
    displayName: "Australia Capital Territory - Premier League",
    aliases: ["Australia Capital Territory - Premier League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia Capital Territory - Premier League" },
      pandora: { leagueId: "22381", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_capital_territory_npl_premier_league",
    sportId: "soccer",
    displayName: "Australia Capital Territory NPL - Premier League",
    aliases: ["Australia Capital Territory NPL - Premier League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia Capital Territory NPL - Premier League" },
      pandora: { leagueId: "22675", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_capital_territory_npl_2",
    sportId: "soccer",
    displayName: "Australia Capital Territory NPL 2",
    aliases: ["Australia Capital Territory NPL 2"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia Capital Territory NPL 2" },
      pandora: { leagueId: "11177", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_cup",
    sportId: "soccer",
    displayName: "Australia Cup",
    aliases: ["Australia Cup"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia Cup" },
      pandora: { leagueId: "20442", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_northern_nsw",
    sportId: "soccer",
    displayName: "Australia Northern NSW",
    aliases: ["Australia Northern NSW"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia Northern NSW" },
      pandora: { leagueId: "3712", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_northern_nsw_npl",
    sportId: "soccer",
    displayName: "Australia Northern NSW NPL",
    aliases: ["Australia Northern NSW NPL"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia Northern NSW NPL" },
      pandora: { leagueId: "14182", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_northern_territory_npl",
    sportId: "soccer",
    displayName: "Australia Northern Territory NPL",
    aliases: ["Australia Northern Territory NPL"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia Northern Territory NPL" },
      pandora: { leagueId: "14202", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_npl_south_australia",
    sportId: "soccer",
    displayName: "Australia NPL South Australia",
    aliases: ["Australia NPL South Australia"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia NPL South Australia" },
      pandora: { leagueId: "4199", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_nsw_npl",
    sportId: "soccer",
    displayName: "Australia NSW NPL",
    aliases: ["Australia NSW NPL"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia NSW NPL" },
      pandora: { leagueId: "4200", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_nsw_premier_league_w",
    sportId: "soccer",
    displayName: "Australia NSW Premier League W",
    aliases: ["Australia NSW Premier League W"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia NSW Premier League W" },
      pandora: { leagueId: "30586", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_queensland_national_premiere_league",
    sportId: "soccer",
    displayName: "Australia Queensland - National Premiere League",
    aliases: ["Australia Queensland - National Premiere League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia Queensland - National Premiere League" },
      pandora: { leagueId: "14178", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_queensland_league",
    sportId: "soccer",
    displayName: "Australia Queensland League",
    aliases: ["Australia Queensland League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia Queensland League" },
      pandora: { leagueId: "3649", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_queensland_npl",
    sportId: "soccer",
    displayName: "Australia Queensland NPL",
    aliases: ["Australia Queensland NPL"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia Queensland NPL" },
      pandora: { leagueId: "5729", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_queensland_premier_league",
    sportId: "soccer",
    displayName: "Australia Queensland Premier League",
    aliases: ["Australia Queensland Premier League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia Queensland Premier League" },
      pandora: { leagueId: "6933", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_queensland_premier_league_2",
    sportId: "soccer",
    displayName: "Australia Queensland Premier League 2",
    aliases: ["Australia Queensland Premier League 2"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia Queensland Premier League 2" },
      pandora: { leagueId: "29383", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_tasmania_npl",
    sportId: "soccer",
    displayName: "Australia Tasmania NPL",
    aliases: ["Australia Tasmania NPL"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia Tasmania NPL" },
      pandora: { leagueId: "3645", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_victoria_npl",
    sportId: "soccer",
    displayName: "Australia Victoria NPL",
    aliases: ["Australia Victoria NPL"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia Victoria NPL" },
      pandora: { leagueId: "14195", feedSportId: "5" },
    },
  },
  {
    id: "soccer.australia_western_australia_npl",
    sportId: "soccer",
    displayName: "Australia Western Australia NPL",
    aliases: ["Australia Western Australia NPL"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Australia Western Australia NPL" },
      pandora: { leagueId: "14196", feedSportId: "5" },
    },
  },
  {
    id: "soccer.austria_2_liga",
    sportId: "soccer",
    displayName: "Austria 2. Liga",
    aliases: ["Austria 2. Liga"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Austria 2. Liga" },
      pandora: { leagueId: "6672", feedSportId: "5" },
    },
  },
  {
    id: "soccer.austria_bundesliga",
    sportId: "soccer",
    displayName: "Austria Bundesliga",
    aliases: ["Austria Bundesliga"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Austria Bundesliga" },
      pandora: { leagueId: "2110", feedSportId: "5" },
    },
  },
  {
    id: "soccer.belarus_premier_league",
    sportId: "soccer",
    displayName: "Belarus Premier League",
    aliases: ["Belarus Premier League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Belarus Premier League" },
      pandora: { leagueId: "489", feedSportId: "5" },
    },
  },
  {
    id: "soccer.belarus_vysshaya_liga",
    sportId: "soccer",
    displayName: "Belarus Vysshaya Liga",
    aliases: ["Belarus Vysshaya Liga"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Belarus Vysshaya Liga" },
      pandora: { leagueId: "9790", feedSportId: "5" },
    },
  },
  {
    id: "soccer.belgium_challenger_pro_league_u23",
    sportId: "soccer",
    displayName: "Belgium Challenger Pro League - U23",
    aliases: ["Belgium Challenger Pro League - U23"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Belgium Challenger Pro League - U23" },
      pandora: { leagueId: "17634", feedSportId: "5" },
    },
  },
  {
    id: "soccer.belgium_jupiler_league",
    sportId: "soccer",
    displayName: "Belgium Jupiler League",
    aliases: ["Belgium Jupiler League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Belgium Jupiler League" },
      pandora: { leagueId: "104", feedSportId: "5" },
    },
  },
  {
    id: "soccer.belgium_proximus_league",
    sportId: "soccer",
    displayName: "Belgium Proximus League",
    aliases: ["Belgium Proximus League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Belgium Proximus League" },
      pandora: { leagueId: "7517", feedSportId: "5" },
    },
  },
  {
    id: "soccer.bhutan_premier_league",
    sportId: "soccer",
    displayName: "Bhutan Premier League",
    aliases: ["Bhutan Premier League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Bhutan Premier League" },
      pandora: { leagueId: "11295", feedSportId: "5" },
    },
  },
  {
    id: "soccer.bolivia_copa_division_profesional",
    sportId: "soccer",
    displayName: "Bolivia - Copa Division Profesional",
    aliases: ["Bolivia - Copa Division Profesional"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Bolivia - Copa Division Profesional" },
      pandora: { leagueId: "18519", feedSportId: "5" },
    },
  },
  {
    id: "soccer.bolivia_lfpb",
    sportId: "soccer",
    displayName: "Bolivia LFPB",
    aliases: ["Bolivia LFPB"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Bolivia LFPB" },
      pandora: { leagueId: "2298", feedSportId: "5" },
    },
  },
  {
    id: "soccer.bolivia_lfpb_league_cup",
    sportId: "soccer",
    displayName: "Bolivia LFPB League Cup",
    aliases: ["Bolivia LFPB League Cup"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "football", leagueKey: "Bolivia LFPB League Cup" },
      pandora: { leagueId: "18973", feedSportId: "5" },
    },
  },
  {
    id: "baseball.college_baseball",
    sportId: "baseball",
    displayName: "College Baseball",
    aliases: ["College Baseball"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "baseball", leagueKey: "College Baseball" },
      pandora: { leagueId: "9", feedSportId: "1" },
    },
  },
  {
    id: "baseball.international_baseball_world_cup_u23_mens",
    sportId: "baseball",
    displayName: "International Baseball World Cup U23 Mens",
    aliases: ["International Baseball World Cup U23 Mens"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "baseball", leagueKey: "International Baseball World Cup U23 Mens" },
      pandora: { leagueId: "21638", feedSportId: "1" },
    },
  },
  {
    id: "baseball.international_baseball_world_cup_u23_mens_taiwan",
    sportId: "baseball",
    displayName: "International Baseball World Cup U23 Mens Taiwan",
    aliases: ["International Baseball World Cup U23 Mens Taiwan"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "baseball", leagueKey: "International Baseball World Cup U23 Mens Taiwan" },
      pandora: { leagueId: "17439", feedSportId: "1" },
    },
  },
  {
    id: "baseball.international_exhibition_games",
    sportId: "baseball",
    displayName: "International Exhibition Games",
    aliases: ["International Exhibition Games"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "baseball", leagueKey: "International Exhibition Games" },
      pandora: { leagueId: "22261", feedSportId: "1" },
    },
  },
  {
    id: "baseball.japan_npb",
    sportId: "baseball",
    displayName: "Japan NPB",
    aliases: ["Japan NPB"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "baseball", leagueKey: "Japan NPB" },
      pandora: { leagueId: "1031", feedSportId: "1" },
    },
  },
  {
    id: "baseball.mlb",
    sportId: "baseball",
    displayName: "MLB",
    aliases: ["MLB"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "baseball", leagueKey: "MLB" },
      pandora: { leagueId: "8", feedSportId: "1" },
    },
  },
  {
    id: "baseball.mlb_exhibition",
    sportId: "baseball",
    displayName: "MLB Exhibition",
    aliases: ["MLB Exhibition"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "baseball", leagueKey: "MLB Exhibition" },
      pandora: { leagueId: "957", feedSportId: "1" },
    },
  },
  {
    id: "baseball.mlb_in_progress",
    sportId: "baseball",
    displayName: "MLB In Progress",
    aliases: ["MLB In Progress"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "baseball", leagueKey: "MLB In Progress" },
      pandora: { leagueId: "424", feedSportId: "1" },
    },
  },
  {
    id: "baseball.ncaa_baseball",
    sportId: "baseball",
    displayName: "NCAA Baseball",
    aliases: ["NCAA Baseball"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "baseball", leagueKey: "NCAA Baseball" },
      pandora: { leagueId: "22172", feedSportId: "1" },
    },
  },
  {
    id: "baseball.taiwan_cpbl",
    sportId: "baseball",
    displayName: "Taiwan CPBL",
    aliases: ["Taiwan CPBL"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "baseball", leagueKey: "Taiwan CPBL" },
      pandora: { leagueId: "1033", feedSportId: "1" },
    },
  },
  {
    id: "baseball.united_states",
    sportId: "baseball",
    displayName: "United States",
    aliases: ["United States"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "baseball", leagueKey: "United States" },
      pandora: { leagueId: "23196", feedSportId: "1" },
    },
  },
  {
    id: "baseball.united_states_college_baseball",
    sportId: "baseball",
    displayName: "United States College Baseball",
    aliases: ["United States College Baseball"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "baseball", leagueKey: "United States College Baseball" },
      pandora: { leagueId: "13511", feedSportId: "1" },
    },
  },
  {
    id: "baseball.usa_milb_aaa",
    sportId: "baseball",
    displayName: "USA MiLB AAA",
    aliases: ["USA MiLB AAA"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "baseball", leagueKey: "USA MiLB AAA" },
      pandora: { leagueId: "3415", feedSportId: "1" },
    },
  },
  {
    id: "basketball.argentina_la_liga_federal",
    sportId: "basketball",
    displayName: "Argentina La Liga Federal",
    aliases: ["Argentina La Liga Federal"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "Argentina La Liga Federal" },
      pandora: { leagueId: "24244", feedSportId: "2" },
    },
  },
  {
    id: "basketball.australia_big_v_state_championship_men",
    sportId: "basketball",
    displayName: "Australia Big V - State Championship Men",
    aliases: ["Australia Big V - State Championship Men"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "Australia Big V - State Championship Men" },
      pandora: { leagueId: "3709", feedSportId: "2" },
    },
  },
  {
    id: "basketball.australia_big_v_state_championship_women",
    sportId: "basketball",
    displayName: "Australia Big V - State Championship Women",
    aliases: ["Australia Big V - State Championship Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "Australia Big V - State Championship Women" },
      pandora: { leagueId: "3779", feedSportId: "2" },
    },
  },
  {
    id: "basketball.australia_nbl",
    sportId: "basketball",
    displayName: "Australia NBL",
    aliases: ["Australia NBL"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "Australia NBL" },
      pandora: { leagueId: "954", feedSportId: "2" },
    },
  },
  {
    id: "basketball.australia_nbl_1_women",
    sportId: "basketball",
    displayName: "Australia NBL 1 - Women",
    aliases: ["Australia NBL 1 - Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "Australia NBL 1 - Women" },
      pandora: { leagueId: "8246", feedSportId: "2" },
    },
  },
  {
    id: "basketball.australia_nbl1",
    sportId: "basketball",
    displayName: "Australia NBL1",
    aliases: ["Australia NBL1"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "Australia NBL1" },
      pandora: { leagueId: "7530", feedSportId: "2" },
    },
  },
  {
    id: "basketball.australia_nbl1_women",
    sportId: "basketball",
    displayName: "Australia NBL1 Women",
    aliases: ["Australia NBL1 Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "Australia NBL1 Women" },
      pandora: { leagueId: "7523", feedSportId: "2" },
    },
  },
  {
    id: "basketball.big_3",
    sportId: "basketball",
    displayName: "Big 3",
    aliases: ["Big 3"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "Big 3" },
      pandora: { leagueId: "22900", feedSportId: "2" },
    },
  },
  {
    id: "basketball.brazil_fpb_paulista_league",
    sportId: "basketball",
    displayName: "Brazil FPB Paulista League",
    aliases: ["Brazil FPB Paulista League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "Brazil FPB Paulista League" },
      pandora: { leagueId: "21146", feedSportId: "2" },
    },
  },
  {
    id: "basketball.bulgaria_cup_w",
    sportId: "basketball",
    displayName: "Bulgaria Cup W",
    aliases: ["Bulgaria Cup W"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "Bulgaria Cup W" },
      pandora: { leagueId: "19185", feedSportId: "2" },
    },
  },
  {
    id: "basketball.chile_championship",
    sportId: "basketball",
    displayName: "Chile Championship",
    aliases: ["Chile Championship"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "Chile Championship" },
      pandora: { leagueId: "8736", feedSportId: "2" },
    },
  },
  {
    id: "basketball.chile_lnb_cup",
    sportId: "basketball",
    displayName: "Chile LNB Cup",
    aliases: ["Chile LNB Cup"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "Chile LNB Cup" },
      pandora: { leagueId: "12573", feedSportId: "2" },
    },
  },
  {
    id: "basketball.china_cba_summer_league",
    sportId: "basketball",
    displayName: "China CBA Summer League",
    aliases: ["China CBA Summer League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "China CBA Summer League" },
      pandora: { leagueId: "23341", feedSportId: "2" },
    },
  },
  {
    id: "basketball.college_basketball",
    sportId: "basketball",
    displayName: "College Basketball",
    aliases: ["College Basketball"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "College Basketball" },
      pandora: { leagueId: "22171", feedSportId: "2" },
    },
  },
  {
    id: "basketball.college_basketball_extra",
    sportId: "basketball",
    displayName: "College Basketball Extra",
    aliases: ["College Basketball Extra"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "College Basketball Extra" },
      pandora: { leagueId: "21905", feedSportId: "2" },
    },
  },
  {
    id: "basketball.college_basketball_in_progress",
    sportId: "basketball",
    displayName: "College Basketball In Progress",
    aliases: ["College Basketball In Progress"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "College Basketball In Progress" },
      pandora: { leagueId: "880", feedSportId: "2" },
    },
  },
  {
    id: "basketball.england_slb",
    sportId: "basketball",
    displayName: "England SLB",
    aliases: ["England SLB"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "England SLB" },
      pandora: { leagueId: "29461", feedSportId: "2" },
    },
  },
  {
    id: "basketball.fiba_women_s_world_cup_qualifiers",
    sportId: "basketball",
    displayName: "FIBA Women's World Cup Qualifiers",
    aliases: ["FIBA Women's World Cup Qualifiers"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "FIBA Women's World Cup Qualifiers" },
      pandora: { leagueId: "3088", feedSportId: "2" },
    },
  },
  {
    id: "basketball.france_nationale_1",
    sportId: "basketball",
    displayName: "France Nationale 1",
    aliases: ["France Nationale 1"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "France Nationale 1" },
      pandora: { leagueId: "2766", feedSportId: "2" },
    },
  },
  {
    id: "basketball.hong_kong_silver_shield_cup",
    sportId: "basketball",
    displayName: "Hong Kong Silver Shield Cup",
    aliases: ["Hong Kong Silver Shield Cup"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "Hong Kong Silver Shield Cup" },
      pandora: { leagueId: "30770", feedSportId: "2" },
    },
  },
  {
    id: "basketball.indonesia_basketball_league",
    sportId: "basketball",
    displayName: "Indonesia Basketball League",
    aliases: ["Indonesia Basketball League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "Indonesia Basketball League" },
      pandora: { leagueId: "18165", feedSportId: "2" },
    },
  },
  {
    id: "basketball.indonesia_ibl",
    sportId: "basketball",
    displayName: "Indonesia IBL",
    aliases: ["Indonesia IBL"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "Indonesia IBL" },
      pandora: { leagueId: "4648", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_vtb_united_league",
    sportId: "basketball",
    displayName: "International  VTB United League",
    aliases: ["International  VTB United League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International  VTB United League" },
      pandora: { leagueId: "11621", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_asian_cup",
    sportId: "basketball",
    displayName: "International Asian Cup",
    aliases: ["International Asian Cup"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International Asian Cup" },
      pandora: { leagueId: "9633", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_asian_university_basketball_league",
    sportId: "basketball",
    displayName: "International Asian University Basketball League",
    aliases: ["International Asian University Basketball League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International Asian University Basketball League" },
      pandora: { leagueId: "30897", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_club_friendlies",
    sportId: "basketball",
    displayName: "International Club Friendlies",
    aliases: ["International Club Friendlies"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International Club Friendlies" },
      pandora: { leagueId: "5869", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_club_friendlies_basketball",
    sportId: "basketball",
    displayName: "International Club Friendlies Basketball",
    aliases: ["International Club Friendlies Basketball"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International Club Friendlies Basketball" },
      pandora: { leagueId: "4323", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_eurobasket_u20",
    sportId: "basketball",
    displayName: "International EuroBasket U20",
    aliases: ["International EuroBasket U20"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International EuroBasket U20" },
      pandora: { leagueId: "16758", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_eurocup_women",
    sportId: "basketball",
    displayName: "International Eurocup - Women",
    aliases: ["International Eurocup - Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International Eurocup - Women" },
      pandora: { leagueId: "2687", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_european_championship_u20_women",
    sportId: "basketball",
    displayName: "International European Championship U20 - Women",
    aliases: ["International European Championship U20 - Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International European Championship U20 - Women" },
      pandora: { leagueId: "16709", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_fiba_u18_americup",
    sportId: "basketball",
    displayName: "International FIBA U18 Americup",
    aliases: ["International FIBA U18 Americup"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International FIBA U18 Americup" },
      pandora: { leagueId: "30934", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_fiba_world_championship",
    sportId: "basketball",
    displayName: "International FIBA World Championship",
    aliases: ["International FIBA World Championship"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International FIBA World Championship" },
      pandora: { leagueId: "8952", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_friendly_women",
    sportId: "basketball",
    displayName: "International Friendly - Women",
    aliases: ["International Friendly - Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International Friendly - Women" },
      pandora: { leagueId: "14228", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_frostball",
    sportId: "basketball",
    displayName: "International Frostball",
    aliases: ["International Frostball"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International Frostball" },
      pandora: { leagueId: "30651", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_nba_2k20",
    sportId: "basketball",
    displayName: "International NBA 2K20",
    aliases: ["International NBA 2K20"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International NBA 2K20" },
      pandora: { leagueId: "10240", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_nba_preseason_matches",
    sportId: "basketball",
    displayName: "International NBA. Preseason Matches",
    aliases: ["International NBA. Preseason Matches"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International NBA. Preseason Matches" },
      pandora: { leagueId: "21173", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_olympics_basketball_3x3_men",
    sportId: "basketball",
    displayName: "International Olympics Basketball 3X3 - Men",
    aliases: ["International Olympics Basketball 3X3 - Men"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International Olympics Basketball 3X3 - Men" },
      pandora: { leagueId: "23095", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_premier_league",
    sportId: "basketball",
    displayName: "International Premier League",
    aliases: ["International Premier League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International Premier League" },
      pandora: { leagueId: "30774", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_premier_league_a",
    sportId: "basketball",
    displayName: "International Premier League A",
    aliases: ["International Premier League A"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International Premier League A" },
      pandora: { leagueId: "30658", feedSportId: "2" },
    },
  },
  {
    id: "basketball.international_south_american_championship_women",
    sportId: "basketball",
    displayName: "International South American Championship - Women",
    aliases: ["International South American Championship - Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "basketball", leagueKey: "International South American Championship - Women" },
      pandora: { leagueId: "16877", feedSportId: "2" },
    },
  },
  {
    id: "table_tennis.czech_republic_pro_league_men",
    sportId: "table_tennis",
    displayName: "Czech Republic Pro League Men",
    aliases: ["Czech Republic Pro League Men"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "table_tennis", leagueKey: "Czech Republic Pro League Men" },
      pandora: { leagueId: "23367", feedSportId: "93" },
    },
  },
  {
    id: "table_tennis.international_ittf_world_cup_macao",
    sportId: "table_tennis",
    displayName: "International ITTF World Cup Macao",
    aliases: ["International ITTF World Cup Macao"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "table_tennis", leagueKey: "International ITTF World Cup Macao" },
      pandora: { leagueId: "22494", feedSportId: "93" },
    },
  },
  {
    id: "table_tennis.international_setka_cup_men",
    sportId: "table_tennis",
    displayName: "International Setka Cup Men",
    aliases: ["International Setka Cup Men"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "table_tennis", leagueKey: "International Setka Cup Men" },
      pandora: { leagueId: "23368", feedSportId: "93" },
    },
  },
  {
    id: "table_tennis.international_world_cup",
    sportId: "table_tennis",
    displayName: "International World Cup",
    aliases: ["International World Cup"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "table_tennis", leagueKey: "International World Cup" },
      pandora: { leagueId: "12026", feedSportId: "93" },
    },
  },
  {
    id: "table_tennis.international_world_cup_macao",
    sportId: "table_tennis",
    displayName: "International World Cup Macao",
    aliases: ["International World Cup Macao"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "table_tennis", leagueKey: "International World Cup Macao" },
      pandora: { leagueId: "22489", feedSportId: "93" },
    },
  },
  {
    id: "table_tennis.poland_tt_elite_series_men",
    sportId: "table_tennis",
    displayName: "Poland TT Elite Series Men",
    aliases: ["Poland TT Elite Series Men"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "table_tennis", leagueKey: "Poland TT Elite Series Men" },
      pandora: { leagueId: "23369", feedSportId: "93" },
    },
  },
  {
    id: "table_tennis.table_tennis",
    sportId: "table_tennis",
    displayName: "table tennis",
    aliases: ["table tennis"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "table_tennis", leagueKey: "table tennis" },
      pandora: { leagueId: "23189", feedSportId: "93" },
    },
  },
  {
    id: "ice_hockey.austria_ebel",
    sportId: "ice_hockey",
    displayName: "Austria EBEL",
    aliases: ["Austria EBEL"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "Austria EBEL" },
      pandora: { leagueId: "2723", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.austria_ehl",
    sportId: "ice_hockey",
    displayName: "Austria EHL",
    aliases: ["Austria EHL"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "Austria EHL" },
      pandora: { leagueId: "621", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.canada_ontario_hockey_league",
    sportId: "ice_hockey",
    displayName: "Canada Ontario Hockey League",
    aliases: ["Canada Ontario Hockey League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "Canada Ontario Hockey League" },
      pandora: { leagueId: "2946", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.finland_liiga",
    sportId: "ice_hockey",
    displayName: "Finland Liiga",
    aliases: ["Finland Liiga"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "Finland Liiga" },
      pandora: { leagueId: "1037", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.finland_mestis",
    sportId: "ice_hockey",
    displayName: "Finland Mestis",
    aliases: ["Finland Mestis"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "Finland Mestis" },
      pandora: { leagueId: "619", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.france_ligue_magnus",
    sportId: "ice_hockey",
    displayName: "France Ligue Magnus",
    aliases: ["France Ligue Magnus"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "France Ligue Magnus" },
      pandora: { leagueId: "1038", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.international_champions_league",
    sportId: "ice_hockey",
    displayName: "International Champions League",
    aliases: ["International Champions League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "International Champions League" },
      pandora: { leagueId: "8902", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.international_club_friendlies_hockey",
    sportId: "ice_hockey",
    displayName: "International Club Friendlies Hockey",
    aliases: ["International Club Friendlies Hockey"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "International Club Friendlies Hockey" },
      pandora: { leagueId: "9972", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.international_elite_league",
    sportId: "ice_hockey",
    displayName: "International Elite League",
    aliases: ["International Elite League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "International Elite League" },
      pandora: { leagueId: "23891", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.international_karjala_cup",
    sportId: "ice_hockey",
    displayName: "International Karjala Cup",
    aliases: ["International Karjala Cup"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "International Karjala Cup" },
      pandora: { leagueId: "2815", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.international_wch_u20_iii",
    sportId: "ice_hockey",
    displayName: "International WCH U20 III",
    aliases: ["International WCH U20 III"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "International WCH U20 III" },
      pandora: { leagueId: "5484", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.kazakhstan_championship",
    sportId: "ice_hockey",
    displayName: "Kazakhstan Championship",
    aliases: ["Kazakhstan Championship"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "Kazakhstan Championship" },
      pandora: { leagueId: "18808", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.nhl",
    sportId: "ice_hockey",
    displayName: "NHL",
    aliases: ["NHL"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "NHL" },
      pandora: { leagueId: "10", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.nhl_preseason",
    sportId: "ice_hockey",
    displayName: "NHL  Preseason",
    aliases: ["NHL  Preseason"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "NHL  Preseason" },
      pandora: { leagueId: "8977", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.olympic_winter_games_2022_hockey",
    sportId: "ice_hockey",
    displayName: "Olympic Winter Games 2022. Hockey",
    aliases: ["Olympic Winter Games 2022. Hockey"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "Olympic Winter Games 2022. Hockey" },
      pandora: { leagueId: "15757", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.sweden_shl",
    sportId: "ice_hockey",
    displayName: "Sweden SHL",
    aliases: ["Sweden SHL"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "Sweden SHL" },
      pandora: { leagueId: "23507", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.united_states_ahl",
    sportId: "ice_hockey",
    displayName: "United States AHL",
    aliases: ["United States AHL"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "United States AHL" },
      pandora: { leagueId: "2899", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.united_states_ncaa_men",
    sportId: "ice_hockey",
    displayName: "United States NCAA | Men",
    aliases: ["United States NCAA | Men"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "United States NCAA | Men" },
      pandora: { leagueId: "23957", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.united_states_nhl_20_league_pro",
    sportId: "ice_hockey",
    displayName: "United States NHL 20 League Pro",
    aliases: ["United States NHL 20 League Pro"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "United States NHL 20 League Pro" },
      pandora: { leagueId: "10978", feedSportId: "4" },
    },
  },
  {
    id: "ice_hockey.winter_olympics_hockey_women",
    sportId: "ice_hockey",
    displayName: "Winter Olympics Hockey - Women",
    aliases: ["Winter Olympics Hockey - Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "ice_hockey", leagueKey: "Winter Olympics Hockey - Women" },
      pandora: { leagueId: "28709", feedSportId: "4" },
    },
  },
  {
    id: "cricket.antigua_and_barbuda_abca_t10_splash",
    sportId: "cricket",
    displayName: "Antigua and Barbuda ABCA T10 Splash",
    aliases: ["Antigua and Barbuda ABCA T10 Splash"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "Antigua and Barbuda ABCA T10 Splash" },
      pandora: { leagueId: "18123", feedSportId: "87" },
    },
  },
  {
    id: "cricket.australia_big_bash_league_women",
    sportId: "cricket",
    displayName: "Australia Big Bash League Women",
    aliases: ["Australia Big Bash League Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "Australia Big Bash League Women" },
      pandora: { leagueId: "4610", feedSportId: "87" },
    },
  },
  {
    id: "cricket.australia_western_australia_first_grade",
    sportId: "cricket",
    displayName: "Australia. Western Australia First Grade",
    aliases: ["Australia. Western Australia First Grade"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "Australia. Western Australia First Grade" },
      pandora: { leagueId: "21269", feedSportId: "87" },
    },
  },
  {
    id: "cricket.england_metro_bank_one_day_cup",
    sportId: "cricket",
    displayName: "England Metro Bank One-Day Cup",
    aliases: ["England Metro Bank One-Day Cup"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "England Metro Bank One-Day Cup" },
      pandora: { leagueId: "24892", feedSportId: "87" },
    },
  },
  {
    id: "cricket.england_natwest_t20_blast",
    sportId: "cricket",
    displayName: "England NatWest T20 Blast",
    aliases: ["England NatWest T20 Blast"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "England NatWest T20 Blast" },
      pandora: { leagueId: "19628", feedSportId: "87" },
    },
  },
  {
    id: "cricket.england_the_hundred",
    sportId: "cricket",
    displayName: "England The Hundred",
    aliases: ["England The Hundred"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "England The Hundred" },
      pandora: { leagueId: "14066", feedSportId: "87" },
    },
  },
  {
    id: "cricket.england_the_hundred_women",
    sportId: "cricket",
    displayName: "England The Hundred Women",
    aliases: ["England The Hundred Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "England The Hundred Women" },
      pandora: { leagueId: "14067", feedSportId: "87" },
    },
  },
  {
    id: "cricket.global_t20_canada",
    sportId: "cricket",
    displayName: "Global T20 Canada",
    aliases: ["Global T20 Canada"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "Global T20 Canada" },
      pandora: { leagueId: "3855", feedSportId: "87" },
    },
  },
  {
    id: "cricket.great_britain_county_championship_division_2",
    sportId: "cricket",
    displayName: "Great Britain County Championship Division 2",
    aliases: ["Great Britain County Championship Division 2"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "Great Britain County Championship Division 2" },
      pandora: { leagueId: "19982", feedSportId: "87" },
    },
  },
  {
    id: "cricket.great_britain_county_championship_division_one",
    sportId: "cricket",
    displayName: "Great Britain County Championship Division One",
    aliases: ["Great Britain County Championship Division One"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "Great Britain County Championship Division One" },
      pandora: { leagueId: "19917", feedSportId: "87" },
    },
  },
  {
    id: "cricket.india_abca_t10_splash",
    sportId: "cricket",
    displayName: "India Abca T10 Splash",
    aliases: ["India Abca T10 Splash"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "India Abca T10 Splash" },
      pandora: { leagueId: "18115", feedSportId: "87" },
    },
  },
  {
    id: "cricket.india_assam_premier_league",
    sportId: "cricket",
    displayName: "India Assam Premier League",
    aliases: ["India Assam Premier League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "India Assam Premier League" },
      pandora: { leagueId: "30911", feedSportId: "87" },
    },
  },
  {
    id: "cricket.india_delhi_premier_league",
    sportId: "cricket",
    displayName: "India Delhi Premier League",
    aliases: ["India Delhi Premier League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "India Delhi Premier League" },
      pandora: { leagueId: "23297", feedSportId: "87" },
    },
  },
  {
    id: "cricket.india_legends_league_cricket",
    sportId: "cricket",
    displayName: "India Legends League Cricket",
    aliases: ["India Legends League Cricket"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "India Legends League Cricket" },
      pandora: { leagueId: "18593", feedSportId: "87" },
    },
  },
  {
    id: "cricket.india_premier_league_tamil_nadu",
    sportId: "cricket",
    displayName: "India Premier League Tamil Nadu",
    aliases: ["India Premier League Tamil Nadu"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "India Premier League Tamil Nadu" },
      pandora: { leagueId: "14797", feedSportId: "87" },
    },
  },
  {
    id: "cricket.india_senior_t20_w",
    sportId: "cricket",
    displayName: "India Senior T20 W",
    aliases: ["India Senior T20 W"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "India Senior T20 W" },
      pandora: { leagueId: "17411", feedSportId: "87" },
    },
  },
  {
    id: "cricket.india_t20_birsa_munda_trophy",
    sportId: "cricket",
    displayName: "India T20 Birsa Munda Trophy",
    aliases: ["India T20 Birsa Munda Trophy"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "India T20 Birsa Munda Trophy" },
      pandora: { leagueId: "24269", feedSportId: "87" },
    },
  },
  {
    id: "cricket.india_tamil_nadu_premiere_league",
    sportId: "cricket",
    displayName: "India Tamil Nadu Premiere League",
    aliases: ["India Tamil Nadu Premiere League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "India Tamil Nadu Premiere League" },
      pandora: { leagueId: "14068", feedSportId: "87" },
    },
  },
  {
    id: "cricket.international_bago_t10_blast",
    sportId: "cricket",
    displayName: "International Bago T10 Blast",
    aliases: ["International Bago T10 Blast"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "International Bago T10 Blast" },
      pandora: { leagueId: "21555", feedSportId: "87" },
    },
  },
  {
    id: "cricket.international_caribbean_premier_league",
    sportId: "cricket",
    displayName: "International Caribbean Premier League",
    aliases: ["International Caribbean Premier League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "International Caribbean Premier League" },
      pandora: { leagueId: "4111", feedSportId: "87" },
    },
  },
  {
    id: "cricket.international_cwc_challenge_league",
    sportId: "cricket",
    displayName: "International CWC Challenge League",
    aliases: ["International CWC Challenge League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "International CWC Challenge League" },
      pandora: { leagueId: "16853", feedSportId: "87" },
    },
  },
  {
    id: "cricket.international_eci_t10",
    sportId: "cricket",
    displayName: "International ECI. T10",
    aliases: ["International ECI. T10"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "International ECI. T10" },
      pandora: { leagueId: "19229", feedSportId: "87" },
    },
  },
  {
    id: "cricket.international_european_cricket_series_t10",
    sportId: "cricket",
    displayName: "International European Cricket Series T10",
    aliases: ["International European Cricket Series T10"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "International European Cricket Series T10" },
      pandora: { leagueId: "22378", feedSportId: "87" },
    },
  },
  {
    id: "cricket.international_great_britain_county_championship_division_one",
    sportId: "cricket",
    displayName: "International Great Britain | County Championship Division One",
    aliases: ["International Great Britain | County Championship Division One"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "International Great Britain | County Championship Division One" },
      pandora: { leagueId: "20093", feedSportId: "87" },
    },
  },
  {
    id: "cricket.international_icc_cricket_world_cup_league_2",
    sportId: "cricket",
    displayName: "International ICC Cricket World Cup League 2",
    aliases: ["International ICC Cricket World Cup League 2"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "International ICC Cricket World Cup League 2" },
      pandora: { leagueId: "17759", feedSportId: "87" },
    },
  },
  {
    id: "cricket.international_icc_odi_matches",
    sportId: "cricket",
    displayName: "International ICC ODI Matches",
    aliases: ["International ICC ODI Matches"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "International ICC ODI Matches" },
      pandora: { leagueId: "30881", feedSportId: "87" },
    },
  },
  {
    id: "cricket.international_icc_world_cup_w",
    sportId: "cricket",
    displayName: "International ICC World Cup W",
    aliases: ["International ICC World Cup W"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "International ICC World Cup W" },
      pandora: { leagueId: "19745", feedSportId: "87" },
    },
  },
  {
    id: "cricket.international_odi_series_west_indies_academy_vs_ireland_emerging",
    sportId: "cricket",
    displayName: "International ODI Series West Indies Academy Vs Ireland Emerging",
    aliases: ["International ODI Series West Indies Academy Vs Ireland Emerging"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "International ODI Series West Indies Academy Vs Ireland Emerging" },
      pandora: { leagueId: "21563", feedSportId: "87" },
    },
  },
  {
    id: "cricket.international_south_american_championship",
    sportId: "cricket",
    displayName: "International South American Championship",
    aliases: ["International South American Championship"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "International South American Championship" },
      pandora: { leagueId: "30929", feedSportId: "87" },
    },
  },
  {
    id: "cricket.international_t20_africa_cup",
    sportId: "cricket",
    displayName: "International T20 Africa Cup",
    aliases: ["International T20 Africa Cup"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "International T20 Africa Cup" },
      pandora: { leagueId: "21712", feedSportId: "87" },
    },
  },
  {
    id: "cricket.international_t20_matches",
    sportId: "cricket",
    displayName: "International T20 Matches",
    aliases: ["International T20 Matches"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "International T20 Matches" },
      pandora: { leagueId: "22828", feedSportId: "87" },
    },
  },
  {
    id: "cricket.international_t20_matches_women",
    sportId: "cricket",
    displayName: "International T20 Matches Women",
    aliases: ["International T20 Matches Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "International T20 Matches Women" },
      pandora: { leagueId: "21683", feedSportId: "87" },
    },
  },
  {
    id: "cricket.international_twenty20_series",
    sportId: "cricket",
    displayName: "International Twenty20 Series",
    aliases: ["International Twenty20 Series"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "International Twenty20 Series" },
      pandora: { leagueId: "19993", feedSportId: "87" },
    },
  },
  {
    id: "cricket.international_west_indies_vs_india_test_series",
    sportId: "cricket",
    displayName: "International West Indies vs India (Test Series)",
    aliases: ["International West Indies vs India (Test Series)"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "International West Indies vs India (Test Series)" },
      pandora: { leagueId: "20379", feedSportId: "87" },
    },
  },
  {
    id: "cricket.kuwait_kcc_friendi_mobile_t20_desert_league",
    sportId: "cricket",
    displayName: "Kuwait KCC FRiENDi Mobile T20 Desert League",
    aliases: ["Kuwait KCC FRiENDi Mobile T20 Desert League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "Kuwait KCC FRiENDi Mobile T20 Desert League" },
      pandora: { leagueId: "20380", feedSportId: "87" },
    },
  },
  {
    id: "cricket.kuwait_kcc_t20_desert_league",
    sportId: "cricket",
    displayName: "Kuwait KCC T20 Desert League",
    aliases: ["Kuwait KCC T20 Desert League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "Kuwait KCC T20 Desert League" },
      pandora: { leagueId: "21482", feedSportId: "87" },
    },
  },
  {
    id: "cricket.one_day_international_women",
    sportId: "cricket",
    displayName: "One Day International - Women",
    aliases: ["One Day International - Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "One Day International - Women" },
      pandora: { leagueId: "3384", feedSportId: "87" },
    },
  },
  {
    id: "cricket.pakistan_changan_karachi_motors_night_auction_premier_league",
    sportId: "cricket",
    displayName: "Pakistan Changan Karachi Motors Night Auction Premier League",
    aliases: ["Pakistan Changan Karachi Motors Night Auction Premier League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "Pakistan Changan Karachi Motors Night Auction Premier League" },
      pandora: { leagueId: "19716", feedSportId: "87" },
    },
  },
  {
    id: "cricket.pakistan_sheikh_premier_league_season_4",
    sportId: "cricket",
    displayName: "Pakistan Sheikh Premier League Season 4",
    aliases: ["Pakistan Sheikh Premier League Season 4"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "Pakistan Sheikh Premier League Season 4" },
      pandora: { leagueId: "20299", feedSportId: "87" },
    },
  },
  {
    id: "cricket.sri_lanka_major_clubs_limited_over_tournament",
    sportId: "cricket",
    displayName: "Sri Lanka Major Clubs Limited Over Tournament",
    aliases: ["Sri Lanka Major Clubs Limited Over Tournament"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "cricket", leagueKey: "Sri Lanka Major Clubs Limited Over Tournament" },
      pandora: { leagueId: "21756", feedSportId: "87" },
    },
  },
  {
    id: "volleyball.argentina_torneo_argentino",
    sportId: "volleyball",
    displayName: "Argentina Torneo Argentino",
    aliases: ["Argentina Torneo Argentino"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "Argentina Torneo Argentino" },
      pandora: { leagueId: "9735", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.beach_volleyball",
    sportId: "volleyball",
    displayName: "beach volleyball",
    aliases: ["beach volleyball"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "beach volleyball" },
      pandora: { leagueId: "23172", feedSportId: "110" },
    },
  },
  {
    id: "volleyball.brazil_open_women",
    sportId: "volleyball",
    displayName: "Brazil Open | Women",
    aliases: ["Brazil Open | Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "Brazil Open | Women" },
      pandora: { leagueId: "28638", feedSportId: "110" },
    },
  },
  {
    id: "volleyball.costa_rica_primera_division",
    sportId: "volleyball",
    displayName: "Costa Rica Primera Division",
    aliases: ["Costa Rica Primera Division"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "Costa Rica Primera Division" },
      pandora: { leagueId: "14231", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.friendly_international",
    sportId: "volleyball",
    displayName: "Friendly International",
    aliases: ["Friendly International"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "Friendly International" },
      pandora: { leagueId: "3486", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.gambia_national_championship_w",
    sportId: "volleyball",
    displayName: "Gambia National Championship W",
    aliases: ["Gambia National Championship W"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "Gambia National Championship W" },
      pandora: { leagueId: "24691", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.germany_beach_pro_tour_elite_16_hamburg_men",
    sportId: "volleyball",
    displayName: "Germany Beach Pro Tour | Elite 16 - Hamburg | Men",
    aliases: ["Germany Beach Pro Tour | Elite 16 - Hamburg | Men"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "Germany Beach Pro Tour | Elite 16 - Hamburg | Men" },
      pandora: { leagueId: "30933", feedSportId: "110" },
    },
  },
  {
    id: "volleyball.germany_beach_pro_tour_elite_16_hamburg_women",
    sportId: "volleyball",
    displayName: "Germany Beach Pro Tour | Elite 16 - Hamburg | Women",
    aliases: ["Germany Beach Pro Tour | Elite 16 - Hamburg | Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "Germany Beach Pro Tour | Elite 16 - Hamburg | Women" },
      pandora: { leagueId: "30932", feedSportId: "110" },
    },
  },
  {
    id: "volleyball.germany_beach_pro_tour_hamburg",
    sportId: "volleyball",
    displayName: "Germany Beach Pro Tour Hamburg",
    aliases: ["Germany Beach Pro Tour Hamburg"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "Germany Beach Pro Tour Hamburg" },
      pandora: { leagueId: "30930", feedSportId: "110" },
    },
  },
  {
    id: "volleyball.germany_beach_pro_tour_hamburg_women",
    sportId: "volleyball",
    displayName: "Germany Beach Pro Tour Hamburg Women",
    aliases: ["Germany Beach Pro Tour Hamburg Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "Germany Beach Pro Tour Hamburg Women" },
      pandora: { leagueId: "16954", feedSportId: "110" },
    },
  },
  {
    id: "volleyball.international_central_american_and_caribbean_games_women",
    sportId: "volleyball",
    displayName: "International Central American and Caribbean Games Women",
    aliases: ["International Central American and Caribbean Games Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "International Central American and Caribbean Games Women" },
      pandora: { leagueId: "4030", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.international_cev_champions_league",
    sportId: "volleyball",
    displayName: "International CEV Champions League",
    aliases: ["International CEV Champions League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "International CEV Champions League" },
      pandora: { leagueId: "9276", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.international_cev_cup_women_1_16_finals",
    sportId: "volleyball",
    displayName: "International CEV Cup - Women - 1/16 Finals",
    aliases: ["International CEV Cup - Women - 1/16 Finals"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "International CEV Cup - Women - 1/16 Finals" },
      pandora: { leagueId: "15386", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.international_champion_league",
    sportId: "volleyball",
    displayName: "International Champion League",
    aliases: ["International Champion League"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "International Champion League" },
      pandora: { leagueId: "12734", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.international_copa_sudamericana",
    sportId: "volleyball",
    displayName: "International Copa Sudamericana",
    aliases: ["International Copa Sudamericana"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "International Copa Sudamericana" },
      pandora: { leagueId: "30924", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.international_fivb_championship_women",
    sportId: "volleyball",
    displayName: "International FIVB Championship Women",
    aliases: ["International FIVB Championship Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "International FIVB Championship Women" },
      pandora: { leagueId: "21116", feedSportId: "110" },
    },
  },
  {
    id: "volleyball.international_friendly_women",
    sportId: "volleyball",
    displayName: "International Friendly Women",
    aliases: ["International Friendly Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "International Friendly Women" },
      pandora: { leagueId: "11089", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.international_liga_pro_challenge_tour",
    sportId: "volleyball",
    displayName: "International Liga Pro Challenge Tour",
    aliases: ["International Liga Pro Challenge Tour"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "International Liga Pro Challenge Tour" },
      pandora: { leagueId: "10623", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.international_nations_league_women",
    sportId: "volleyball",
    displayName: "International Nations League - Women",
    aliases: ["International Nations League - Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "International Nations League - Women" },
      pandora: { leagueId: "8409", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.international_world_championship_2022_w",
    sportId: "volleyball",
    displayName: "International World Championship 2022 W",
    aliases: ["International World Championship 2022 W"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "International World Championship 2022 W" },
      pandora: { leagueId: "16558", feedSportId: "110" },
    },
  },
  {
    id: "volleyball.israel_premier_league_women",
    sportId: "volleyball",
    displayName: "Israel Premier League Women",
    aliases: ["Israel Premier League Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "Israel Premier League Women" },
      pandora: { leagueId: "12834", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.italy_italian_championships_women",
    sportId: "volleyball",
    displayName: "Italy Italian Championships Women",
    aliases: ["Italy Italian Championships Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "Italy Italian Championships Women" },
      pandora: { leagueId: "14581", feedSportId: "110" },
    },
  },
  {
    id: "volleyball.olympics_volleyball_men",
    sportId: "volleyball",
    displayName: "Olympics Volleyball - Men",
    aliases: ["Olympics Volleyball - Men"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "Olympics Volleyball - Men" },
      pandora: { leagueId: "14120", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.olympics_volleyball_women",
    sportId: "volleyball",
    displayName: "Olympics Volleyball - Women",
    aliases: ["Olympics Volleyball - Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "Olympics Volleyball - Women" },
      pandora: { leagueId: "14123", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.south_korea_v_league_women",
    sportId: "volleyball",
    displayName: "South Korea V-League - Women",
    aliases: ["South Korea V-League - Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "South Korea V-League - Women" },
      pandora: { leagueId: "7388", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.vietnam_championship_women",
    sportId: "volleyball",
    displayName: "Vietnam Championship Women",
    aliases: ["Vietnam Championship Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "Vietnam Championship Women" },
      pandora: { leagueId: "3868", feedSportId: "88" },
    },
  },
  {
    id: "volleyball.vietnam_premier_league_w",
    sportId: "volleyball",
    displayName: "Vietnam Premier League W",
    aliases: ["Vietnam Premier League W"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "volleyball", leagueKey: "Vietnam Premier League W" },
      pandora: { leagueId: "10925", feedSportId: "88" },
    },
  },
  {
    id: "handball.argentina_championship",
    sportId: "handball",
    displayName: "Argentina Championship",
    aliases: ["Argentina Championship"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "handball", leagueKey: "Argentina Championship" },
      pandora: { leagueId: "14502", feedSportId: "86" },
    },
  },
  {
    id: "handball.international_central_american_and_caribbean_games",
    sportId: "handball",
    displayName: "International Central American And Caribbean Games",
    aliases: ["International Central American And Caribbean Games"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "handball", leagueKey: "International Central American And Caribbean Games" },
      pandora: { leagueId: "20181", feedSportId: "86" },
    },
  },
  {
    id: "handball.international_club_friendly",
    sportId: "handball",
    displayName: "International Club Friendly",
    aliases: ["International Club Friendly"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "handball", leagueKey: "International Club Friendly" },
      pandora: { leagueId: "4178", feedSportId: "86" },
    },
  },
  {
    id: "handball.international_club_friendly_women",
    sportId: "handball",
    displayName: "International Club Friendly Women",
    aliases: ["International Club Friendly Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "handball", leagueKey: "International Club Friendly Women" },
      pandora: { leagueId: "11241", feedSportId: "86" },
    },
  },
  {
    id: "handball.senegal_championnat_elite",
    sportId: "handball",
    displayName: "Senegal Championnat Elite",
    aliases: ["Senegal Championnat Elite"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "handball", leagueKey: "Senegal Championnat Elite" },
      pandora: { leagueId: "22955", feedSportId: "86" },
    },
  },
  {
    id: "handball.senegal_championship_women",
    sportId: "handball",
    displayName: "Senegal Championship Women",
    aliases: ["Senegal Championship Women"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "handball", leagueKey: "Senegal Championship Women" },
      pandora: { leagueId: "22947", feedSportId: "86" },
    },
  },
  {
    id: "handball.slovakia_cup",
    sportId: "handball",
    displayName: "Slovakia Cup",
    aliases: ["Slovakia Cup"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "handball", leagueKey: "Slovakia Cup" },
      pandora: { leagueId: "18282", feedSportId: "86" },
    },
  },
  {
    id: "handball.turkey_super_lig",
    sportId: "handball",
    displayName: "Turkey Super lig",
    aliases: ["Turkey Super lig"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "handball", leagueKey: "Turkey Super lig" },
      pandora: { leagueId: "24904", feedSportId: "86" },
    },
  },
  {
    id: "tennis.argentina_itf_cordoba_arg_men_singles",
    sportId: "tennis",
    displayName: "Argentina ITF Cordoba [ ARG] |  Men | Singles",
    aliases: ["Argentina ITF Cordoba [ ARG] |  Men | Singles"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "Argentina ITF Cordoba [ ARG] |  Men | Singles" },
      pandora: { leagueId: "24525", feedSportId: "8" },
    },
  },
  {
    id: "tennis.argentina_itf_cordoba_l_men_l_doubles",
    sportId: "tennis",
    displayName: "Argentina ITF Cordoba l Men l Doubles",
    aliases: ["Argentina ITF Cordoba l Men l Doubles"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "Argentina ITF Cordoba l Men l Doubles" },
      pandora: { leagueId: "23470", feedSportId: "8" },
    },
  },
  {
    id: "tennis.argentina_itf_men_m25_tucuman_doubles",
    sportId: "tennis",
    displayName: "Argentina ITF Men M25 - Tucuman - Doubles",
    aliases: ["Argentina ITF Men M25 - Tucuman - Doubles"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "Argentina ITF Men M25 - Tucuman - Doubles" },
      pandora: { leagueId: "18684", feedSportId: "8" },
    },
  },
  {
    id: "tennis.argentina_itf_men_m25_tucuman_singles",
    sportId: "tennis",
    displayName: "Argentina ITF Men M25 - Tucuman - Singles",
    aliases: ["Argentina ITF Men M25 - Tucuman - Singles"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "Argentina ITF Men M25 - Tucuman - Singles" },
      pandora: { leagueId: "18671", feedSportId: "8" },
    },
  },
  {
    id: "tennis.argentina_itf_pilar_singles",
    sportId: "tennis",
    displayName: "Argentina ITF Pilar | Singles",
    aliases: ["Argentina ITF Pilar | Singles"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "Argentina ITF Pilar | Singles" },
      pandora: { leagueId: "23587", feedSportId: "8" },
    },
  },
  {
    id: "tennis.argentina_itf_pilar_women_singles",
    sportId: "tennis",
    displayName: "Argentina ITF Pilar | Women | Singles",
    aliases: ["Argentina ITF Pilar | Women | Singles"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "Argentina ITF Pilar | Women | Singles" },
      pandora: { leagueId: "23147", feedSportId: "8" },
    },
  },
  {
    id: "tennis.argentina_itf_tucuman_women_singles",
    sportId: "tennis",
    displayName: "Argentina ITF Tucuman | Women | Singles",
    aliases: ["Argentina ITF Tucuman | Women | Singles"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "Argentina ITF Tucuman | Women | Singles" },
      pandora: { leagueId: "22144", feedSportId: "8" },
    },
  },
  {
    id: "tennis.argentina_itf_w25_women_buenos_aires_singles",
    sportId: "tennis",
    displayName: "Argentina ITF W25 Women - Buenos Aires - Singles",
    aliases: ["Argentina ITF W25 Women - Buenos Aires - Singles"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "Argentina ITF W25 Women - Buenos Aires - Singles" },
      pandora: { leagueId: "18136", feedSportId: "8" },
    },
  },
  {
    id: "tennis.argentina_itf_women_mar_del_plata_arg_doubles",
    sportId: "tennis",
    displayName: "Argentina ITF Women - Mar Del Plata (ARG) -  Doubles",
    aliases: ["Argentina ITF Women - Mar Del Plata (ARG) -  Doubles"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "Argentina ITF Women - Mar Del Plata (ARG) -  Doubles" },
      pandora: { leagueId: "17791", feedSportId: "8" },
    },
  },
  {
    id: "tennis.argentina_itf_women_buenos_aires_arg_doubles",
    sportId: "tennis",
    displayName: "Argentina ITF Women Buenos Aires (ARG), Doubles",
    aliases: ["Argentina ITF Women Buenos Aires (ARG), Doubles"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "Argentina ITF Women Buenos Aires (ARG), Doubles" },
      pandora: { leagueId: "17836", feedSportId: "8" },
    },
  },
  {
    id: "tennis.argentina_itf_women_buenos_aires_arg_singles",
    sportId: "tennis",
    displayName: "Argentina ITF Women Buenos Aires (ARG), Singles",
    aliases: ["Argentina ITF Women Buenos Aires (ARG), Singles"],
    gender: "women",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "Argentina ITF Women Buenos Aires (ARG), Singles" },
      pandora: { leagueId: "17833", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp",
    sportId: "tennis",
    displayName: "ATP",
    aliases: ["ATP"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP" },
      pandora: { leagueId: "1930", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_challenger_poznan_men_singles",
    sportId: "tennis",
    displayName: "ATP  Challenger Poznan | Men | Singles",
    aliases: ["ATP  Challenger Poznan | Men | Singles"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP  Challenger Poznan | Men | Singles" },
      pandora: { leagueId: "22860", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_doubles_adelaide_australia",
    sportId: "tennis",
    displayName: "ATP  Doubles Adelaide , Australia",
    aliases: ["ATP  Doubles Adelaide , Australia"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP  Doubles Adelaide , Australia" },
      pandora: { leagueId: "21868", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_geneva_men_doubles",
    sportId: "tennis",
    displayName: "ATP  Geneva | Men | Doubles",
    aliases: ["ATP  Geneva | Men | Doubles"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP  Geneva | Men | Doubles" },
      pandora: { leagueId: "22729", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_estoril_men_singles",
    sportId: "tennis",
    displayName: "ATP - Estoril | Men | Singles",
    aliases: ["ATP - Estoril | Men | Singles"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP - Estoril | Men | Singles" },
      pandora: { leagueId: "22350", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_french_open_roland_garros_doubles",
    sportId: "tennis",
    displayName: "ATP - French Open (Roland Garros) - Doubles",
    aliases: ["ATP - French Open (Roland Garros) - Doubles"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP - French Open (Roland Garros) - Doubles" },
      pandora: { leagueId: "19733", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_french_open_roland_garros_singles",
    sportId: "tennis",
    displayName: "ATP - French Open (Roland Garros) - Singles",
    aliases: ["ATP - French Open (Roland Garros) - Singles"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP - French Open (Roland Garros) - Singles" },
      pandora: { leagueId: "19644", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_geneva_sui_singles",
    sportId: "tennis",
    displayName: "ATP - Geneva (SUI) - Singles",
    aliases: ["ATP - Geneva (SUI) - Singles"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP - Geneva (SUI) - Singles" },
      pandora: { leagueId: "19624", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_acapulco_men_doubles",
    sportId: "tennis",
    displayName: "ATP Acapulco | Men | Doubles",
    aliases: ["ATP Acapulco | Men | Doubles"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Acapulco | Men | Doubles" },
      pandora: { leagueId: "22115", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_adelaide_2_australia",
    sportId: "tennis",
    displayName: "ATP Adelaide 2, Australia",
    aliases: ["ATP Adelaide 2, Australia"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Adelaide 2, Australia" },
      pandora: { leagueId: "15609", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_adelaide_australia",
    sportId: "tennis",
    displayName: "ATP Adelaide, Australia",
    aliases: ["ATP Adelaide, Australia"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Adelaide, Australia" },
      pandora: { leagueId: "21866", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_almaty_kazakhstan",
    sportId: "tennis",
    displayName: "ATP Almaty, Kazakhstan",
    aliases: ["ATP Almaty, Kazakhstan"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Almaty, Kazakhstan" },
      pandora: { leagueId: "23712", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_antwerp_belgium",
    sportId: "tennis",
    displayName: "ATP Antwerp, Belgium",
    aliases: ["ATP Antwerp, Belgium"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Antwerp, Belgium" },
      pandora: { leagueId: "15034", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_athens_greece",
    sportId: "tennis",
    displayName: "ATP Athens, Greece",
    aliases: ["ATP Athens, Greece"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Athens, Greece" },
      pandora: { leagueId: "27163", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_auckland_new_zealand",
    sportId: "tennis",
    displayName: "ATP Auckland, New Zealand",
    aliases: ["ATP Auckland, New Zealand"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Auckland, New Zealand" },
      pandora: { leagueId: "24013", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_australian_open",
    sportId: "tennis",
    displayName: "ATP Australian Open",
    aliases: ["ATP Australian Open"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Australian Open" },
      pandora: { leagueId: "23930", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_australian_open_australia",
    sportId: "tennis",
    displayName: "ATP Australian Open, Australia",
    aliases: ["ATP Australian Open, Australia"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Australian Open, Australia" },
      pandora: { leagueId: "18127", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_banja_luka_bosnia_herz",
    sportId: "tennis",
    displayName: "ATP Banja Luka, Bosnia-Herz",
    aliases: ["ATP Banja Luka, Bosnia-Herz"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Banja Luka, Bosnia-Herz" },
      pandora: { leagueId: "19275", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_barcelona_spain",
    sportId: "tennis",
    displayName: "ATP Barcelona, Spain",
    aliases: ["ATP Barcelona, Spain"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Barcelona, Spain" },
      pandora: { leagueId: "22470", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_basel_men_doubles",
    sportId: "tennis",
    displayName: "ATP Basel | Men | Doubles",
    aliases: ["ATP Basel | Men | Doubles"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Basel | Men | Doubles" },
      pandora: { leagueId: "23735", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_basel_men_singles",
    sportId: "tennis",
    displayName: "ATP Basel | Men | Singles",
    aliases: ["ATP Basel | Men | Singles"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Basel | Men | Singles" },
      pandora: { leagueId: "23729", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_basel_switzerland",
    sportId: "tennis",
    displayName: "ATP Basel Switzerland",
    aliases: ["ATP Basel Switzerland"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Basel Switzerland" },
      pandora: { leagueId: "17495", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_bastad_men_doubles",
    sportId: "tennis",
    displayName: "ATP Bastad | Men | Doubles",
    aliases: ["ATP Bastad | Men | Doubles"],
    gender: "men",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Bastad | Men | Doubles" },
      pandora: { leagueId: "23018", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_bastad_sweden",
    sportId: "tennis",
    displayName: "ATP Bastad, Sweden",
    aliases: ["ATP Bastad, Sweden"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Bastad, Sweden" },
      pandora: { leagueId: "23021", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_beijing_china",
    sportId: "tennis",
    displayName: "ATP Beijing, China",
    aliases: ["ATP Beijing, China"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Beijing, China" },
      pandora: { leagueId: "23598", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_belgrade_serbia",
    sportId: "tennis",
    displayName: "ATP Belgrade, Serbia",
    aliases: ["ATP Belgrade, Serbia"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Belgrade, Serbia" },
      pandora: { leagueId: "23825", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_brisbane_australia",
    sportId: "tennis",
    displayName: "ATP Brisbane, Australia",
    aliases: ["ATP Brisbane, Australia"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Brisbane, Australia" },
      pandora: { leagueId: "21848", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_brussels_belgium",
    sportId: "tennis",
    displayName: "ATP Brussels, Belgium",
    aliases: ["ATP Brussels, Belgium"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Brussels, Belgium" },
      pandora: { leagueId: "25659", feedSportId: "8" },
    },
  },
  {
    id: "tennis.atp_bucharest_romania",
    sportId: "tennis",
    displayName: "ATP Bucharest, Romania",
    aliases: ["ATP Bucharest, Romania"],
    gender: "unknown",
    providerMappings: {
      plive: { inventoryBucket: "tennis", leagueKey: "ATP Bucharest, Romania" },
      pandora: { leagueId: "22478", feedSportId: "8" },
    },
  },
] as const satisfies readonly CompetitionRecord[];

export type CompetitionId = (typeof COMPETITIONS)[number]['id'];

const byId = new Map<string, (typeof COMPETITIONS)[number]>(COMPETITIONS.map(c => [c.id, c]));

/**
 * Normalize league wire for matching / storage keys (trim, collapse space, lower).
 * Keeps punctuation so display-adjacent norms stay stable in inventory_leagues PK.
 */
export function normalizeLeagueKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Loose match form for resolve / promote: dots & underscores → spaces.
 * `"ATT. Togliatti"` and `"ATT Togliatti"` both → `"att togliatti"`.
 */
export function matchLeagueKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
