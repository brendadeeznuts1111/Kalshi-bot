/**
 * Build a PlaceBet request body from PartnerOrder + optional HAR endpoint map.
 *
 * Field names prefer keys observed in the HAR. When the map is missing keys,
 * falls back to the known componentBet coordinates (eventId/marketId/key/…).
 * This is **not** a substitute for a real PlaceBet HAR — it only fills a
 * body once the URL is operator-confirmed.
 */
import type { PartnerOrder } from "../types.ts";
import type { FantasyUltraCredentials } from "./types.ts";
import type {
  PlaceBetBodyEncoding,
  PlaceBetEndpointMap,
} from "./place-bet-har.ts";

/** Canonical field candidates → order property */
const FIELD_ALIASES: Record<string, (o: PartnerOrder, c: FantasyUltraCredentials) => unknown> = {
  eventId: (o) => o.eventId,
  event_id: (o) => o.eventId,
  EventId: (o) => o.eventId,
  marketId: (o) => o.marketId,
  market_id: (o) => o.marketId,
  key: (o) => o.key,
  subKey: (o) => o.subKey,
  sub_key: (o) => o.subKey,
  periodId: (o) => o.periodId,
  period_id: (o) => o.periodId,
  risk: (o) => o.stake,
  stake: (o) => o.stake,
  amount: (o) => o.stake,
  wager: (o) => o.stake,
  toWin: () => undefined,
  finalOdds: (o) => o.price,
  odds: (o) => o.price,
  price: (o) => o.price,
  currency: (o, c) => o.currency ?? c.currency,
  customerID: (_o, c) => c.customerID,
  customerId: (_o, c) => c.customerID,
  agentID: (_o, c) => c.agentID,
  agentId: (_o, c) => c.agentID,
  skin: (_o, c) => c.skin,
  sportId: (o) => o.sportId,
  sport_id: (o) => o.sportId,
  leagueId: (o) => o.leagueId,
  league_id: (o) => o.leagueId,
  team1: (o) => o.team1,
  team2: (o) => o.team2,
  side: (o) => o.side,
};

/** Default body when HAR did not record request keys (selection coords only). */
export function defaultPlaceBetFields(
  order: PartnerOrder,
  credentials: FantasyUltraCredentials,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    eventId: order.eventId,
    risk: order.stake,
    currency: order.currency ?? credentials.currency,
    customerID: credentials.customerID,
    agentID: credentials.agentID,
  };
  if (order.marketId != null) body.marketId = order.marketId;
  if (order.key != null) body.key = order.key;
  if (order.subKey != null) body.subKey = order.subKey;
  if (order.periodId != null) body.periodId = order.periodId;
  if (order.price != null) body.finalOdds = order.price;
  if (order.sportId != null) body.sportId = order.sportId;
  if (order.leagueId != null) body.leagueId = order.leagueId;
  if (order.team1 != null) body.team1 = order.team1;
  if (order.team2 != null) body.team2 = order.team2;
  return body;
}

export function buildPlaceBetBody(
  order: PartnerOrder,
  credentials: FantasyUltraCredentials,
  map?: PlaceBetEndpointMap | null,
): { body: Record<string, unknown>; encoding: PlaceBetBodyEncoding; contentType: string } {
  const encoding: PlaceBetBodyEncoding =
    map?.encoding === "form" || map?.encoding === "json"
      ? map.encoding
      : "json";
  const contentType =
    map?.contentType ??
    (encoding === "form"
      ? "application/x-www-form-urlencoded; charset=UTF-8"
      : "application/json");

  if (!map?.requestKeys?.length) {
    return {
      body: defaultPlaceBetFields(order, credentials),
      encoding,
      contentType,
    };
  }

  const body: Record<string, unknown> = {};
  for (const key of map.requestKeys) {
    const resolver = FIELD_ALIASES[key];
    if (resolver) {
      const v = resolver(order, credentials);
      if (v !== undefined && v !== null && v !== "") body[key] = v;
      continue;
    }
    // Keep non-secret constants from sample when we cannot map
    const sample = map.requestBodySample;
    if (sample && typeof sample === "object" && !Array.isArray(sample)) {
      const raw = (sample as Record<string, unknown>)[key];
      if (
        raw != null &&
        typeof raw !== "object" &&
        !String(raw).includes("[redacted]") &&
        !String(raw).includes("…[len=")
      ) {
        body[key] = raw;
      }
    }
  }

  // Ensure core selection fields exist even if HAR used alternate names only
  if (body.eventId == null && body.event_id == null) {
    body.eventId = order.eventId;
  }
  if (body.risk == null && body.stake == null && body.amount == null) {
    body.risk = order.stake;
  }

  return { body, encoding, contentType };
}

export function encodePlaceBetBody(
  body: Record<string, unknown>,
  encoding: PlaceBetBodyEncoding,
): string {
  if (encoding === "form") {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || v === null) continue;
      parts.push(
        `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
      );
    }
    return parts.join("&");
  }
  return JSON.stringify(body);
}

/** Resolve place URL: explicit arg → map → env. Never invents host paths. */
export function resolvePlaceBetUrl(options?: {
  placeOrderUrl?: string | null;
  map?: PlaceBetEndpointMap | null;
  envMap?: Record<string, string | undefined>;
}): string | null {
  const env = options?.envMap ?? process.env;
  const fromArg = options?.placeOrderUrl?.trim();
  if (fromArg) return fromArg;
  const fromMap = options?.map?.url?.trim();
  if (fromMap) return fromMap;
  const fromEnv =
    env.FANTASY402_PLACE_BET_URL?.trim() ||
    env.FANTASY402_SPEN_1_PLACE_BET_URL?.trim();
  return fromEnv || null;
}
