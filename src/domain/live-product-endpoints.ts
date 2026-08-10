/**
 * Live-product wire endpoints (stream widget / inventory / livescore).
 * These are product infra URLs — not white-label desk hosts (see SKINS[].hosts).
 */

import type { LiveProductId } from './live-products.ts';

export type LiveStreamEndpoints = {
  /** Origin used for Origin / CORS on stream fetches. */
  streamOrigin: string;
  /** Default Referer for stream-list / widget fetches. */
  streamReferer: string;
  /** Public stream inventory URL. */
  streamListUrl: string;
  /** Path prefix under streamOrigin for the live widget shell. */
  livePathPrefix: string;
};

/**
 * Plive / EZLive share the SportsWidgets shell today.
 * Ultralive / maglive endpoints are not declared here until observed.
 */
export const PLIVE_STREAM_ENDPOINTS = {
  streamOrigin: 'https://plive.sportswidgets.pro',
  streamReferer: 'https://plive.sportswidgets.pro/',
  streamListUrl: 'https://api-gs.player-us.xyz/stream-list-v2/?tv=usa',
  livePathPrefix: '/live/',
} as const satisfies LiveStreamEndpoints;

/** Statscore booking API used by the Ultra livescore widget. */
export const STATSCORE_BOOKED_EVENTS = {
  url: 'https://api.statscore.com/v2/booked-events',
  clientId: '311',
  product: 'livescorepro',
} as const;

/**
 * Desk-relative API paths for the Fantasy402 Ultra mapper (joined to PARTNER_DOMAIN / SKINS host).
 * Not absolute URLs — host comes from skins / env.
 */
export const ULTRA_DESK_API_PATHS = {
  ultraLive: '/cloud/api/Provider/getUltraLiveURL',
  sportsLeagues: '/cloud/api/League/Get_SportsLeagues',
  renewToken: '/cloud/api/System/renewToken',
  /** Optional pandora/ganchrow stream token path observed in captures. */
  streamToken: '/betFactoryV2/api/streamToken.php',
} as const;

/** Live products that reuse the Plive SportsWidgets stream shell. */
const PLIVE_SHELL_PRODUCTS = new Set<LiveProductId>(['plive', 'ezlive']);

/** Stream endpoints for a coverage live product, if known. */
export function streamEndpointsForLiveProduct(
  product: LiveProductId
): LiveStreamEndpoints | undefined {
  if (PLIVE_SHELL_PRODUCTS.has(product)) return PLIVE_STREAM_ENDPOINTS;
  return undefined;
}

/** Default stream endpoints for Ultra mapper tooling (Plive shell). */
export function defaultUltraStreamEndpoints(): LiveStreamEndpoints {
  return PLIVE_STREAM_ENDPOINTS;
}

/** Widget start URL for WebView / CDP capture (`#!/sport/{id}`). */
export function defaultLiveWidgetUrl(sportId: string | number): string {
  const ep = defaultUltraStreamEndpoints();
  const sport = String(sportId).trim() || '220';
  const base = `${ep.streamOrigin}${ep.livePathPrefix}`;
  return `${base}?#!/sport/${sport}`;
}

/** Apex hosts that belong to live-product infra (not SKINS desk hosts). */
export function listLiveProductInfraApexHosts(): string[] {
  const hosts = new Set<string>();
  for (const url of [
    PLIVE_STREAM_ENDPOINTS.streamOrigin,
    PLIVE_STREAM_ENDPOINTS.streamListUrl,
    STATSCORE_BOOKED_EVENTS.url,
  ]) {
    try {
      hosts.add(new URL(url).hostname.toLowerCase().replace(/^www\./, ''));
    } catch {
      /* ignore */
    }
  }
  return [...hosts].sort();
}
