import type { PartnerLiveEvent, PartnerLiveUrlSet, PartnerSportLeague } from "../types.ts";
import type {
  FantasyRenewTokenWire,
  FantasySportsLeaguesWire,
  FantasyStreamEventWire,
  FantasyStreamListWire,
  FantasyUltraLiveUrlWire,
} from "./types.ts";
import { FANTASY_ULTRA_DEFAULTS } from "./types.ts";

export function parseUltraLiveUrlResponse(wire: unknown): PartnerLiveUrlSet {
  if (!wire || typeof wire !== "object") {
    throw new Error("fantasy402: getUltraLiveURL returned non-object");
  }
  const w = wire as FantasyUltraLiveUrlWire;
  if (w.error === true || (typeof w.error === "string" && w.error)) {
    throw new Error(`fantasy402: getUltraLiveURL error: ${String(w.error)}`);
  }
  const desktop =
    w.URL?.DESKTOP?.trim() ||
    w.desktop?.trim() ||
    w.liveUrl?.trim() ||
    "";
  const mobile = w.URL?.MOBILE?.trim() || w.mobile?.trim() || desktop;
  if (!desktop) {
    throw new Error("fantasy402: getUltraLiveURL missing URL.DESKTOP");
  }
  return { desktop, mobile };
}

function asNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function eventFromWire(
  id: string,
  raw: FantasyStreamEventWire,
): PartnerLiveEvent {
  const sides = raw.competitiors ?? raw.competitors ?? {};
  return {
    partner: FANTASY_ULTRA_DEFAULTS.partnerId,
    sport: String(raw.sport ?? "").trim() || "unknown",
    league: String(raw.league ?? "").trim() || "",
    eventId: String(id),
    home: sides.home?.trim() || null,
    away: sides.away?.trim() || null,
    streamId: asNum(raw.stream_id),
    feedId: asNum(raw.feed_id),
    donbestId:
      raw.donbest_id != null && String(raw.donbest_id) !== "0"
        ? String(raw.donbest_id)
        : null,
  };
}

/**
 * Flatten stream-list sports → PartnerLiveEvent[].
 * Optional sport filter matches bucket key (tennis) or event.sport (Tennis) case-insensitively.
 */
export function parseStreamList(
  wire: unknown,
  options: { sport?: string } = {},
): PartnerLiveEvent[] {
  if (!wire || typeof wire !== "object") {
    throw new Error("fantasy402: stream-list returned non-object");
  }
  const w = wire as FantasyStreamListWire;
  if (w.error === true) {
    throw new Error(
      `fantasy402: stream-list error: ${w.error_explain ?? "unknown"}`,
    );
  }
  const want = options.sport?.trim().toLowerCase();
  const out: PartnerLiveEvent[] = [];
  const sports = w.sports ?? {};

  const matchesSport = (bucket: string, event: PartnerLiveEvent): boolean => {
    if (!want || want === "all") return true;
    const b = bucket.toLowerCase().replace(/_/g, " ");
    const s = event.sport.toLowerCase();
    // exact bucket key (tennis) or exact sport label (Tennis) — not substring
    // (avoids table_tennis matching sport=tennis)
    return b === want || s === want || b.replace(/\s+/g, "_") === want;
  };

  for (const [bucket, bucketVal] of Object.entries(sports)) {
    if (!bucketVal || typeof bucketVal !== "object") continue;
    if (want && want !== "all") {
      const b = bucket.toLowerCase();
      if (b !== want && b.replace(/_/g, " ") !== want) {
        // skip other buckets unless want is all
        continue;
      }
    }
    const events = bucketVal.events;
    if (!events) continue;
    if (Array.isArray(events)) {
      for (let i = 0; i < events.length; i++) {
        const e = eventFromWire(String(i), events[i]!);
        if (!matchesSport(bucket, e)) continue;
        out.push(e);
      }
    } else {
      for (const [id, raw] of Object.entries(events)) {
        const e = eventFromWire(id, raw);
        if (!matchesSport(bucket, e)) continue;
        out.push(e);
      }
    }
  }
  return out;
}

/** Extract origin for stream Referer/Origin from a live widget URL. */
export function originFromLiveUrl(liveUrl: string): string {
  try {
    return new URL(liveUrl).origin;
  } catch {
    return FANTASY_ULTRA_DEFAULTS.streamOrigin;
  }
}

/** Parse Get_SportsLeagues → normalized league rows. */
export function parseSportsLeagues(wire: unknown): PartnerSportLeague[] {
  if (!wire || typeof wire !== "object") {
    throw new Error("fantasy402: Get_SportsLeagues returned non-object");
  }
  const w = wire as FantasySportsLeaguesWire;
  const list = Array.isArray(w.Leagues) ? w.Leagues : [];
  const out: PartnerSportLeague[] = [];
  for (const row of list) {
    const sportType = String(row.SportType ?? "").trim();
    if (!sportType) continue;
    out.push({
      sportType,
      sportSubType: String(row.SportSubType ?? "").trim() || null,
      display:
        String(row.SportSubTypeDisplay ?? row.SportTypeDisplay ?? sportType).trim() ||
        sportType,
      sequence: Number(row.SequenceNumber) || 0,
      active: Number(row.Active) === 1,
      periodDescription: String(row.PeriodDescription ?? "").trim() || null,
    });
  }
  return out;
}

/**
 * Extract refreshed Bearer JWT from renewToken JSON.
 * Observed: `{ "code": "<jwt>" }`.
 */
export function parseRenewTokenResponse(wire: unknown): string {
  if (!wire || typeof wire !== "object") {
    throw new Error("fantasy402: renewToken returned non-object");
  }
  const w = wire as FantasyRenewTokenWire;
  const raw =
    w.code?.trim() ||
    w.token?.trim() ||
    w.access_token?.trim() ||
    w.authorization?.trim() ||
    "";
  if (!raw) throw new Error("fantasy402: renewToken missing code/token");
  return raw.replace(/^Bearer\s+/i, "");
}
