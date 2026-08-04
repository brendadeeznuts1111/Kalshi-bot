/**
 * Fantasy402 Ultra Live wire types (boundary).
 * Observed 2026-08-04 against getUltraLiveURL + stream-list-v2.
 */

export type FantasyUltraCredentials = {
  customerID: string;
  agentID: string;
  password: string;
  /** Browser JWT used as Authorization: Bearer … */
  bearerToken: string;
  domain: string;
  skin: number;
  currency: string;
  lang?: string;
  module?: string;
};

/** POST /cloud/api/Provider/getUltraLiveURL */
export type FantasyUltraLiveUrlWire = {
  URL?: {
    DESKTOP?: string;
    MOBILE?: string;
  };
  // tolerate alternate casings / shapes
  liveUrl?: string;
  desktop?: string;
  mobile?: string;
  error?: string | boolean;
  message?: string;
};

/** One stream-list event. Upstream typo: competitiors. */
export type FantasyStreamEventWire = {
  sport?: string;
  league?: string;
  competitiors?: {
    home?: string;
    away?: string;
  };
  competitors?: {
    home?: string;
    away?: string;
  };
  stream_id?: number | string;
  feed_id?: number | string;
  donbest_id?: string;
  donbest_id_multi?: unknown[];
};

export type FantasyStreamSportBucket = {
  events?: Record<string, FantasyStreamEventWire> | FantasyStreamEventWire[];
  count?: number;
};

/** GET https://api-gs.player-us.xyz/stream-list-v2/?tv=usa */
export type FantasyStreamListWire = {
  sports?: Record<string, FantasyStreamSportBucket>;
  error?: boolean;
  error_explain?: string | null;
  modified_time?: number;
};

export const FANTASY_ULTRA_DEFAULTS = {
  domain: "https://fantasy402.com",
  ultraLivePath: "/cloud/api/Provider/getUltraLiveURL",
  /** POST application/x-www-form-urlencoded */
  sportsLeaguesPath: "/cloud/api/League/Get_SportsLeagues",
  /** POST empty form body; response { code: jwt } */
  renewTokenPath: "/cloud/api/System/renewToken",
  /** Optional stream token for pandora/ganchrow (path observed in network captures). */
  streamTokenPath: "/betFactoryV2/api/streamToken.php",
  streamListUrl: "https://api-gs.player-us.xyz/stream-list-v2/?tv=usa",
  streamOrigin: "https://plive.sportswidgets.pro",
  streamReferer: "https://plive.sportswidgets.pro/",
  /**
   * Statscore public livescore booking API (widget referer).
   * product=livescorepro only — product=odds is rejected for this client_id.
   */
  statscoreBookedEventsUrl: "https://api.statscore.com/v2/booked-events",
  statscoreClientId: "311",
  statscoreProduct: "livescorepro",
  skin: 2,
  currency: "USD",
  lang: "English",
  module: "sports.html",
  partnerId: "fantasy402" as const,
} as const;

/** api.statscore.com/v2/booked-events wire (subset). */
export type StatscoreBookedEventWire = {
  id?: number | string;
  client_event_id?: string | number;
  name?: string;
  sport_id?: number | string;
  sport_name?: string;
  competition_short_name?: string;
  competition_name?: string;
  start_date?: string;
  status_name?: string;
  status_type?: string;
  bet_status?: string;
  relation_status?: string;
};

export type StatscoreBookedEventsResponse = {
  api?: {
    error?: { message?: string; status?: number };
    method?: { total_items?: number | string };
    data?: {
      booked_events?: StatscoreBookedEventWire[];
    };
  };
};

/**
 * Place-bet / open-ticket wire (captured Ultra response).
 * Decimal odds; risk = stake; e=0 success.
 */
export type FantasyComponentBetWire = {
  betId?: number;
  sequenceNumber?: number;
  sportId?: number;
  countryId?: number;
  leagueId?: number;
  leagueName?: string;
  eventId?: number | string;
  logTime?: number;
  betType?: number;
  eventStartTime?: number;
  finalOdds?: number;
  uncorrFinalOdds?: number;
  periodId?: string;
  marketId?: string | number;
  marketStyleId?: number;
  key?: string | number;
  subKey?: string;
  team1?: string;
  team2?: string;
  description?: string;
  state?: number;
  isCashout?: boolean;
  canCashout?: boolean;
  premiumizedOdds?: number;
};

export type FantasyBetGroupWire = {
  betGroupId?: number;
  ticketNumber?: number | string;
  finalOdds?: number;
  risk?: number;
  toWin?: number;
  toWinTaxAmount?: number;
  result?: number;
  state?: number;
  acceptTime?: number;
  betType?: number;
  currency?: string;
  delay?: number;
  isFreePlay?: boolean;
  isWin?: number;
  ifableAmount?: number;
  componentBets?: FantasyComponentBetWire[];
};

export type FantasyBetGroupsResponseWire = {
  betGroups?: FantasyBetGroupWire[];
  /** 0 = ok */
  e?: number;
  d?: string;
};

/** One row from Get_SportsLeagues.Leagues[] */
export type FantasySportsLeagueWire = {
  SportType?: string;
  SportSubType?: string;
  SportSubTypeDisplay?: string;
  SportTypeDisplay?: string;
  SequenceNumber?: number;
  Active?: number;
  PeriodDescription?: string;
  PeriodNumber?: number;
  Grouping?: string;
  SportSubTypeBind?: string;
  SportSubType2?: string;
};

export type FantasySportsLeaguesWire = {
  Leagues?: FantasySportsLeagueWire[];
};

export type FantasyRenewTokenWire = {
  /** Observed field name for refreshed JWT */
  code?: string;
  token?: string;
  authorization?: string;
  access_token?: string;
};
