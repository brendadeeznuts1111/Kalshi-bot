import type {
  PartnerBetGroup,
  PartnerBookedEvent,
  PartnerComponentBet,
  PartnerExecutionResult,
  InventoryEvent,
  PartnerLiveUrlSet,
  PartnerSportLeague,
} from "../types.ts";
import type {
  FantasyBetGroupWire,
  FantasyBetGroupsResponseWire,
  FantasyComponentBetWire,
  FantasyRenewTokenWire,
  FantasySportsLeaguesWire,
  FantasyStreamEventWire,
  FantasyStreamListWire,
  FantasyUltraLiveUrlWire,
  StatscoreBookedEventWire,
  StatscoreBookedEventsResponse,
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
): InventoryEvent {
  const sides = raw.competitiors ?? raw.competitors ?? {};
  const wireStreamId = asNum(raw.stream_id);
  const inventoryId =
    wireStreamId != null ? String(wireStreamId) : String(id ?? "").trim();
  return {
    partner: FANTASY_ULTRA_DEFAULTS.partnerId,
    sport: String(raw.sport ?? "").trim() || "unknown",
    league: String(raw.league ?? "").trim() || "",
    inventoryId,
    home: sides.home?.trim() || null,
    away: sides.away?.trim() || null,
    feedId: asNum(raw.feed_id),
    donbestId:
      raw.donbest_id != null && String(raw.donbest_id) !== "0"
        ? String(raw.donbest_id)
        : null,
  };
}

/**
 * Ground-truth capability probe for stream-list-v2.
 *
 * Observed production payload (2026-08):
 *   { sports: { tennis: { events: { id: { sport, league, competitiors, stream_id, … } } } } }
 * There is **no** `markets` / `lines` / `odds` / `price` tree on this feed.
 * The Ultra widget's priced lines come from a different source (WS / betFactory / Manager).
 */
export type StreamListCapabilities = {
  hasRootEventsArray: boolean;
  sportBuckets: number;
  sampleEventKeys: string[];
  /** true if any key path looks like odds/market/line pricing */
  hasPricingKeys: boolean;
  pricingKeyHits: string[];
  note: string;
};

export function inspectStreamListCapabilities(wire: unknown): StreamListCapabilities {
  const empty: StreamListCapabilities = {
    hasRootEventsArray: false,
    sportBuckets: 0,
    sampleEventKeys: [],
    hasPricingKeys: false,
    pricingKeyHits: [],
    note: "non-object payload",
  };
  if (!wire || typeof wire !== "object") return empty;
  const w = wire as Record<string, unknown>;
  const sports =
    w.sports && typeof w.sports === "object"
      ? (w.sports as Record<string, unknown>)
      : {};
  const buckets = Object.keys(sports);
  let sampleEventKeys: string[] = [];
  for (const b of buckets) {
    const bucket = sports[b] as { events?: Record<string, unknown> } | undefined;
    const events = bucket?.events;
    if (events && typeof events === "object" && !Array.isArray(events)) {
      const first = Object.values(events)[0];
      if (first && typeof first === "object") {
        sampleEventKeys = Object.keys(first as object);
        break;
      }
    }
  }
  const hits: string[] = [];
  const walk = (obj: unknown, path: string, depth: number) => {
    if (depth > 8 || obj == null) return;
    if (Array.isArray(obj)) {
      if (obj[0] != null) walk(obj[0], `${path}[0]`, depth + 1);
      return;
    }
    if (typeof obj === "object") {
      for (const [k, v] of Object.entries(obj as object)) {
        // sport bucket "american_football" is not pricing
        if (
          /^(odds|markets|lines|price|americanOdds|maxStake|maxWin)$/i.test(k) ||
          (/price|odds|market|line/i.test(k) &&
            !/american_football|sport/i.test(k))
        ) {
          hits.push(path ? `${path}.${k}` : k);
        }
        walk(v, path ? `${path}.${k}` : k, depth + 1);
      }
    }
  };
  walk(w, "", 0);
  const pricing = hits.filter(
    (h) => !h.includes("american_football") && !/\.sports\.[^.]+$/.test(h),
  );
  return {
    hasRootEventsArray: Array.isArray(w.events),
    sportBuckets: buckets.length,
    sampleEventKeys,
    hasPricingKeys: pricing.length > 0,
    pricingKeyHits: pricing.slice(0, 20),
    note: pricing.length
      ? "Pricing-like keys present — re-parse carefully"
      : "Coverage-only feed: no markets/lines/odds/price (do not invent Market rows)",
  };
}

/**
 * Flatten stream-list sports → InventoryEvent[] (coverage catalog).
 * Optional sport filter matches bucket key (tennis) or event.sport (Tennis) case-insensitively.
 *
 * This is **coverage inventory**, not a priced market book.
 */
export function parseStreamList(
  wire: unknown,
  options: { sport?: string } = {},
): InventoryEvent[] {
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
  const out: InventoryEvent[] = [];
  const sports = w.sports ?? {};

  const matchesSport = (bucket: string, event: InventoryEvent): boolean => {
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

function asInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseStatscoreBookedEvent(
  row: StatscoreBookedEventWire,
): PartnerBookedEvent | null {
  // Wire keeps client_event_id; interior brand is oddsEventId.
  const oddsEventId = String(row.client_event_id ?? "").trim();
  const statscoreId = asInt(row.id);
  if (!oddsEventId || statscoreId == null) return null;
  return {
    partner: FANTASY_ULTRA_DEFAULTS.partnerId,
    statscoreId,
    oddsEventId,
    name: String(row.name ?? "").trim() || oddsEventId,
    sportName: String(row.sport_name ?? "").trim() || "unknown",
    sportId: asInt(row.sport_id),
    competition:
      String(row.competition_short_name ?? row.competition_name ?? "").trim() ||
      null,
    startDate: row.start_date != null ? String(row.start_date) : null,
    statusName: row.status_name != null ? String(row.status_name) : null,
    statusType: row.status_type != null ? String(row.status_type) : null,
    betStatus: row.bet_status != null ? String(row.bet_status) : null,
    relationStatus:
      row.relation_status != null ? String(row.relation_status) : null,
  };
}

/**
 * Parse Statscore booked-events.index JSON.
 * Throws if api.error present. Returns [] when no matches.
 */
export function parseStatscoreBookedEvents(wire: unknown): PartnerBookedEvent[] {
  if (!wire || typeof wire !== "object") {
    throw new Error("statscore: booked-events returned non-object");
  }
  const w = wire as StatscoreBookedEventsResponse;
  if (w.api?.error?.message) {
    throw new Error(
      `statscore: booked-events error: ${w.api.error.message} (status=${w.api.error.status ?? "?"})`,
    );
  }
  const list = w.api?.data?.booked_events;
  if (!Array.isArray(list)) return [];
  const out: PartnerBookedEvent[] = [];
  for (const row of list) {
    const parsed = parseStatscoreBookedEvent(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * Probe whether a Statscore payload contains pricing fields.
 * livescorepro booked-events: false (verified live).
 */
export function statscorePayloadHasPrices(wire: unknown): boolean {
  const s = JSON.stringify(wire ?? {});
  // bet_status is not a price
  return /"price"\s*:|"odds"\s*:|"markets"\s*:|"american_odds"\s*:/i.test(s);
}

/**
 * Heuristic: strip trailing digit sometimes present on widget hash event ids
 * (e.g. 196907981 → 19690798) when the shorter id is the client_event_id.
 */
export function normalizeClientEventIdCandidates(raw: string): string[] {
  const id = raw.trim();
  if (!id) return [];
  const out = [id];
  if (/^\d{8,}$/.test(id) && id.length >= 9) {
    out.push(id.slice(0, -1));
  }
  return [...new Set(out)];
}

function asFinite(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseComponentBet(row: FantasyComponentBetWire): PartnerComponentBet {
  return {
    betId: asFinite(row.betId) ?? 0,
    sequenceNumber: asFinite(row.sequenceNumber) ?? 0,
    sportId: asFinite(row.sportId),
    leagueId: asFinite(row.leagueId),
    leagueName: row.leagueName?.trim() || null,
    eventId: String(row.eventId ?? "").trim(),
    marketId:
      row.marketId != null && String(row.marketId) !== ""
        ? String(row.marketId)
        : null,
    periodId: row.periodId != null ? String(row.periodId) : null,
    key: row.key != null && String(row.key) !== "" ? String(row.key) : null,
    subKey: row.subKey != null ? String(row.subKey) : null,
    team1: row.team1?.trim() || null,
    team2: row.team2?.trim() || null,
    finalOdds: asFinite(row.finalOdds),
    canCashout: row.canCashout === true,
    state: asFinite(row.state),
  };
}

function parseBetGroup(row: FantasyBetGroupWire): PartnerBetGroup {
  const legs = Array.isArray(row.componentBets)
    ? row.componentBets.map(parseComponentBet)
    : [];
  return {
    betGroupId: asFinite(row.betGroupId) ?? 0,
    ticketNumber: String(row.ticketNumber ?? "").trim(),
    finalOdds: asFinite(row.finalOdds),
    risk: asFinite(row.risk) ?? 0,
    toWin: asFinite(row.toWin) ?? 0,
    currency: row.currency?.trim() || null,
    betType: asFinite(row.betType),
    result: asFinite(row.result),
    state: asFinite(row.state),
    isWin: asFinite(row.isWin),
    acceptTime: asFinite(row.acceptTime),
    delay: asFinite(row.delay),
    legs,
  };
}

/**
 * Parse place-bet / open-ticket response:
 * `{ betGroups: [...], e: 0, d: "" }`
 */
export function parseBetGroupsResponse(wire: unknown): {
  groups: PartnerBetGroup[];
  errorCode: number;
  detail: string;
} {
  if (!wire || typeof wire !== "object") {
    throw new Error("fantasy402: betGroups response non-object");
  }
  const w = wire as FantasyBetGroupsResponseWire;
  const errorCode = asFinite(w.e) ?? -1;
  const detail = typeof w.d === "string" ? w.d : "";
  const groups = Array.isArray(w.betGroups)
    ? w.betGroups.map(parseBetGroup)
    : [];
  return { groups, errorCode, detail };
}

/**
 * Map a successful betGroups response → PartnerExecutionResult.
 * success when e===0 and at least one group with ticketNumber.
 */
export function executionResultFromBetGroups(
  wire: unknown,
): PartnerExecutionResult {
  const { groups, errorCode, detail } = parseBetGroupsResponse(wire);
  const g = groups[0];
  const leg = g?.legs[0];
  if (errorCode !== 0 || !g?.ticketNumber) {
    return {
      success: false,
      wireErrorCode: errorCode,
      error:
        detail ||
        `fantasy402: bet response e=${errorCode}` +
          (g ? ` ticket=${g.ticketNumber || "none"}` : ""),
      raw: wire,
    };
  }
  const finalOdds = g.finalOdds ?? leg?.finalOdds ?? undefined;
  return {
    success: true,
    transactionId: String(g.ticketNumber),
    ticketNumber: String(g.ticketNumber),
    ...(g.betGroupId ? { betGroupId: g.betGroupId } : {}),
    ...(leg?.betId ? { betId: leg.betId } : {}),
    ...(finalOdds !== undefined ? { finalOdds } : {}),
    risk: g.risk,
    toWin: g.toWin,
    ...(g.currency !== null ? { currency: g.currency } : {}),
    wireErrorCode: errorCode,
    raw: wire,
  };
}

/**
 * Build a minimal place-intent snapshot from a captured ticket leg
 * (for dry-run / replay tests — not a substitute for the live POST body).
 */
export function orderIntentFromComponentBet(
  leg: PartnerComponentBet,
  stake: number,
): {
  eventId: string;
  marketId: string | undefined;
  key: string | undefined;
  periodId: string | undefined;
  stake: number;
  price: number | undefined;
  team1: string | undefined;
  team2: string | undefined;
} {
  return {
    eventId: leg.eventId,
    marketId: leg.marketId ?? undefined,
    key: leg.key ?? undefined,
    periodId: leg.periodId ?? undefined,
    stake,
    price: leg.finalOdds ?? undefined,
    team1: leg.team1 ?? undefined,
    team2: leg.team2 ?? undefined,
  };
}
