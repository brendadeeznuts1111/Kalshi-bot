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
  skin: 2,
  currency: "USD",
  lang: "English",
  module: "sports.html",
  partnerId: "fantasy402" as const,
} as const;

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
