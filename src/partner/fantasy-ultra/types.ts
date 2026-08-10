/**
 * Fantasy402 Ultra Live wire types (boundary).
 * Observed 2026-08-04 against getUltraLiveURL + stream-list-v2.
 *
 * Desk `domain` default comes from SKINS (Ultra mapper hosts) — not a hard-coded book URL.
 * Stream / Statscore URLs come from domain live-product endpoints SSOT.
 */

import {
  PLIVE_STREAM_ENDPOINTS,
  STATSCORE_BOOKED_EVENTS,
  ULTRA_DESK_API_PATHS,
  requireDefaultUrlForUltraMapper,
} from '../../domain/index.ts';

export type FantasyUltraCredentials = {
  customerID: string;
  agentID: string;
  password: string;
  /** Browser JWT used as Authorization: Bearer … */
  bearerToken: string;
  domain: string;
  /**
   * Live-product wire for getUltraLiveURL — numeric id (`2`) or name
   * (`ezlive`, `dark`). Field name is Ultra form `skin` (not desk SkinId).
   * Credentials are per-out; this only changes limits/payload product.
   */
  skin: string | number;
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

/** GET stream-list-v2 wire (URL from PLIVE_STREAM_ENDPOINTS.streamListUrl). */
export type FantasyStreamListWire = {
  sports?: Record<string, FantasyStreamSportBucket>;
  error?: boolean;
  error_explain?: string | null;
  modified_time?: number;
};

export const FANTASY_ULTRA_DEFAULTS = {
  /** Resolved from SKINS Ultra-mapper hosts at module load. */
  domain: requireDefaultUrlForUltraMapper(),
  ultraLivePath: ULTRA_DESK_API_PATHS.ultraLive,
  /** POST application/x-www-form-urlencoded */
  sportsLeaguesPath: ULTRA_DESK_API_PATHS.sportsLeagues,
  /** POST empty form body; response { code: jwt } */
  renewTokenPath: ULTRA_DESK_API_PATHS.renewToken,
  /** Optional stream token for pandora/ganchrow (path observed in network captures). */
  streamTokenPath: ULTRA_DESK_API_PATHS.streamToken,
  streamListUrl: PLIVE_STREAM_ENDPOINTS.streamListUrl,
  streamOrigin: PLIVE_STREAM_ENDPOINTS.streamOrigin,
  streamReferer: PLIVE_STREAM_ENDPOINTS.streamReferer,
  /**
   * Statscore public livescore booking API (widget referer).
   * product=livescorepro only — product=odds is rejected for this client_id.
   */
  statscoreBookedEventsUrl: STATSCORE_BOOKED_EVENTS.url,
  statscoreClientId: STATSCORE_BOOKED_EVENTS.clientId,
  statscoreProduct: STATSCORE_BOOKED_EVENTS.product,
  /** Default Ultra live-product wire (not desk SkinId). */
  liveProduct: 2,
  currency: 'USD',
  lang: 'English',
  module: 'sports.html',
  partnerId: 'fantasy402' as const,
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
