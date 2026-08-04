// @see https://bun.com/docs/api/fetch
/**
 * Fantasy402 Ultra Live partner adapter (network-capture blueprint).
 *
 * Flow:
 *  1. POST getUltraLiveURL → { URL: { DESKTOP, MOBILE } }  (hash already on URL)
 *  2. GET DESKTOP live widget → warm cookies/session
 *  3. POST Get_SportsLeagues (form) → league catalog
 *  4. GET stream-list-v2 → live coverage rows (not a full odds book)
 *  5. POST renewToken → { code: jwt }
 *
 * placeOrder / fetchLimits remain blocked until a real bet wire is captured.
 */
import type {
  FantasySessionAdapter,
  PartnerBookedEvent,
  PartnerExecutionResult,
  PartnerLimits,
  PartnerLiveEvent,
  PartnerLiveUrlSet,
  PartnerMarket,
  PartnerOrder,
  PartnerSportLeague,
} from "../types.ts";
import { CookieJar } from "./cookie-jar.ts";
import {
  executionResultFromBetGroups,
  inspectStreamListCapabilities,
  normalizeClientEventIdCandidates,
  originFromLiveUrl,
  parseBetGroupsResponse,
  parseRenewTokenResponse,
  parseSportsLeagues,
  parseStatscoreBookedEvents,
  parseStreamList,
  parseUltraLiveUrlResponse,
  statscorePayloadHasPrices,
  type StreamListCapabilities,
} from "./parse.ts";
import {
  FANTASY_ULTRA_DEFAULTS,
  type FantasyUltraCredentials,
} from "./types.ts";
import {
  PandoraSocket,
  type PandoraSocketHandlers,
  type PandoraSocketOptions,
} from "./pandora-socket.ts";

export type FantasyUltraAdapterOptions = {
  credentials: FantasyUltraCredentials;
  fetchImpl?: typeof fetch;
  streamListUrl?: string;
  ultraLiveUrl?: string;
  sportsLeaguesUrl?: string;
  renewTokenUrl?: string;
  statscoreBookedEventsUrl?: string;
  /** When true (default), GET the desktop live URL after login to collect cookies. */
  warmSession?: boolean;
};

export class FantasyUltraAdapter implements FantasySessionAdapter {
  readonly partnerId = FANTASY_ULTRA_DEFAULTS.partnerId;
  private readonly credentials: FantasyUltraCredentials;
  private readonly fetchImpl: typeof fetch;
  private readonly ultraLiveUrl: string;
  private readonly streamListUrl: string;
  private readonly sportsLeaguesUrl: string;
  private readonly renewTokenUrl: string;
  private readonly statscoreBookedEventsUrl: string;
  private readonly autoWarm: boolean;
  private readonly jar = new CookieJar();
  private bearerToken: string;
  private liveUrls: PartnerLiveUrlSet | null = null;
  private warmed = false;
  private pandora: PandoraSocket | null = null;

  constructor(options: FantasyUltraAdapterOptions) {
    this.credentials = options.credentials;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.bearerToken = options.credentials.bearerToken
      .replace(/^Bearer\s+/i, "")
      .trim();
    const domain = options.credentials.domain.replace(/\/$/, "");
    this.ultraLiveUrl =
      options.ultraLiveUrl ??
      `${domain}${FANTASY_ULTRA_DEFAULTS.ultraLivePath}`;
    this.streamListUrl =
      options.streamListUrl ?? FANTASY_ULTRA_DEFAULTS.streamListUrl;
    this.sportsLeaguesUrl =
      options.sportsLeaguesUrl ??
      `${domain}${FANTASY_ULTRA_DEFAULTS.sportsLeaguesPath}`;
    this.renewTokenUrl =
      options.renewTokenUrl ??
      `${domain}${FANTASY_ULTRA_DEFAULTS.renewTokenPath}`;
    this.statscoreBookedEventsUrl =
      options.statscoreBookedEventsUrl ??
      FANTASY_ULTRA_DEFAULTS.statscoreBookedEventsUrl;
    this.autoWarm = options.warmSession !== false;
  }

  getLiveUrls(): PartnerLiveUrlSet | null {
    return this.liveUrls;
  }

  getBearerToken(): string {
    return this.bearerToken;
  }

  cookieCount(): number {
    return this.jar.size();
  }

  isWarmed(): boolean {
    return this.warmed;
  }

  private authHeaders(
    extra: Record<string, string> = {},
  ): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "*/*",
      authorization: `Bearer ${this.bearerToken}`,
      ...extra,
    };
    const cookie = this.jar.headerValue();
    if (cookie) headers.cookie = cookie;
    return headers;
  }

  private async request(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const res = await this.fetchImpl(url, init);
    this.jar.absorbResponse(res);
    return res;
  }

  /** Core login without widget warm (used by warmSession if needed). */
  private async fetchUltraLiveUrls(): Promise<PartnerLiveUrlSet> {
    const c = this.credentials;
    if (!this.bearerToken) throw new Error("fantasy402: bearerToken required");

    const res = await this.request(this.ultraLiveUrl, {
      method: "POST",
      headers: this.authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        customerID: c.customerID,
        agentID: c.agentID,
        domain: c.domain,
        password: c.password,
        module: c.module ?? FANTASY_ULTRA_DEFAULTS.module,
        currency: c.currency,
        skin: c.skin,
        operation: "getUltraLiveURL",
        lang: c.lang ?? FANTASY_ULTRA_DEFAULTS.lang,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `fantasy402: getUltraLiveURL HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`,
      );
    }
    const json: unknown = await res.json();
    return parseUltraLiveUrlResponse(json);
  }

  async login(): Promise<PartnerLiveUrlSet> {
    this.liveUrls = await this.fetchUltraLiveUrls();
    this.warmed = false;
    if (this.autoWarm) {
      await this.warmSession();
    }
    return this.liveUrls;
  }

  /**
   * GET the signed live widget URL (hash already present from login).
   * Collects Set-Cookie when the host returns them.
   */
  async warmSession(): Promise<void> {
    if (!this.liveUrls) {
      this.liveUrls = await this.fetchUltraLiveUrls();
    }
    const url = this.liveUrls.desktop;
    const res = await this.request(url, {
      method: "GET",
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    // Widget shell may 200 even without session cookies; non-fatal on hard errors
    this.warmed = res.ok || (res.status >= 300 && res.status < 400);
  }

  private async ensureSession(): Promise<void> {
    if (!this.liveUrls) await this.login();
  }

  /**
   * POST /cloud/api/System/renewToken → { code: jwt }
   * Updates in-memory bearer for subsequent calls.
   */
  async renewToken(): Promise<string> {
    if (!this.bearerToken) throw new Error("fantasy402: bearerToken required");
    const res = await this.request(this.renewTokenUrl, {
      method: "POST",
      headers: this.authHeaders({
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      }),
      body: new URLSearchParams(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `fantasy402: renewToken HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`,
      );
    }
    const json: unknown = await res.json();
    this.bearerToken = parseRenewTokenResponse(json);
    return this.bearerToken;
  }

  /**
   * POST /cloud/api/League/Get_SportsLeagues
   * Form body mirrors f402-openapi ingestion worker.
   */
  async fetchSports(): Promise<PartnerSportLeague[]> {
    await this.ensureSession();
    const agent = this.credentials.agentID;
    const body = new URLSearchParams({
      RRO: "1",
      agentID: agent,
      agentOwner: agent,
      operation: "Get_SportsLeagues",
    });
    const res = await this.request(this.sportsLeaguesUrl, {
      method: "POST",
      headers: this.authHeaders({
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      }),
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `fantasy402: Get_SportsLeagues HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`,
      );
    }
    const json: unknown = await res.json();
    return parseSportsLeagues(json);
  }

  /**
   * Raw stream-list JSON.
   * Does **not** require Fantasy login — feed is public with widget origin/referer.
   */
  async fetchStreamListRaw(): Promise<unknown> {
    const origin = this.liveUrls
      ? originFromLiveUrl(this.liveUrls.desktop)
      : FANTASY_ULTRA_DEFAULTS.streamOrigin;

    const res = await this.request(this.streamListUrl, {
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*",
        origin,
        referer: this.liveUrls?.desktop ?? `${origin}/`,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `fantasy402: stream-list HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`,
      );
    }
    return res.json();
  }

  async fetchEvents(
    options: { sport?: string } = {},
  ): Promise<PartnerLiveEvent[]> {
    const json = await this.fetchStreamListRaw();
    return parseStreamList(json, { sport: options.sport ?? "tennis" });
  }

  /**
   * Priced markets are **not** on stream-list-v2 (verified live).
   * Call this to confirm schema; do not invent odds from HTML.
   */
  async inspectStreamCapabilities(): Promise<StreamListCapabilities> {
    const json = await this.fetchStreamListRaw();
    return inspectStreamListCapabilities(json);
  }

  /**
   * Intentionally not implemented from stream-list.
   * Throws with capability note so callers do not assume odds exist.
   */
  async fetchMarkets(): Promise<never> {
    const cap = await this.inspectStreamCapabilities();
    throw new Error(
      `fantasy402: fetchMarkets unavailable — stream-list-v2 is coverage-only ` +
        `(hasPricingKeys=${cap.hasPricingKeys}, sampleEventKeys=${cap.sampleEventKeys.join(",")}). ` +
        `Capture the widget's odds/PlaceBet XHR or pandora WS to implement priced markets.`,
    );
  }

  private statscoreHeaders(): Record<string, string> {
    const origin = this.liveUrls
      ? originFromLiveUrl(this.liveUrls.desktop)
      : FANTASY_ULTRA_DEFAULTS.streamOrigin;
    return {
      accept: "application/json, text/plain, */*",
      referer: `${origin}/`,
      origin,
    };
  }

  private async fetchStatscoreBookedRaw(
    params: Record<string, string>,
  ): Promise<unknown> {
    const q = new URLSearchParams({
      client_id: FANTASY_ULTRA_DEFAULTS.statscoreClientId,
      product: FANTASY_ULTRA_DEFAULTS.statscoreProduct,
      events_details: "yes",
      ...params,
    });
    const url = `${this.statscoreBookedEventsUrl}?${q.toString()}`;
    const res = await this.request(url, {
      method: "GET",
      headers: this.statscoreHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `statscore: booked-events HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`,
      );
    }
    return res.json();
  }

  /**
   * Statscore livescore booking row for a widget client_event_id.
   * Tries raw id then normalized candidates (strip trailing digit).
   */
  async fetchBookedEvent(
    clientEventId: string,
  ): Promise<PartnerBookedEvent | null> {
    for (const id of normalizeClientEventIdCandidates(clientEventId)) {
      const raw = await this.fetchStatscoreBookedRaw({
        client_event_id: id,
      });
      const rows = parseStatscoreBookedEvents(raw);
      if (rows.length) return rows[0]!;
    }
    return null;
  }

  /**
   * List Statscore booked events (first page). Optional sport_name filter.
   */
  async listBookedEvents(
    options: { sport?: string; limit?: number } = {},
  ): Promise<PartnerBookedEvent[]> {
    const raw = await this.fetchStatscoreBookedRaw({ lang: "en" });
    let rows = parseStatscoreBookedEvents(raw);
    const want = options.sport?.trim().toLowerCase();
    if (want && want !== "all") {
      rows = rows.filter(
        (r) =>
          r.sportName.toLowerCase() === want ||
          r.sportName.toLowerCase().includes(want),
      );
    }
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    return rows.slice(0, limit);
  }

  /**
   * **Not prices.** Statscore `product=livescorepro` booked-events is event
   * metadata (name, status, bet_status). product=odds is rejected for client_id=311.
   *
   * Returns PartnerMarket[] only if a future response actually contains prices;
   * otherwise throws with a clear diagnostic.
   */
  async fetchOdds(clientEventId: string): Promise<PartnerMarket[]> {
    const raw = await this.fetchStatscoreBookedRaw({
      client_event_id: normalizeClientEventIdCandidates(clientEventId)[0]!,
    });
    const booked = parseStatscoreBookedEvents(raw);
    const hasPrices = statscorePayloadHasPrices(raw);
    if (!hasPrices) {
      const sample = booked[0];
      throw new Error(
        `statscore: booked-events (livescorepro) has no prices ` +
          `(client_event_id=${clientEventId}` +
          (sample
            ? `, name=${sample.name}, bet_status=${sample.betStatus}, status=${sample.statusName}`
            : ", no booked row") +
          `). Capture the XHR that returns American odds (+117 / -115) — ` +
          `this endpoint is livescore booking metadata only.`,
      );
    }
    // Future: parse priced payload when product/wire actually carries it.
    return [];
  }

  async fetchLimits(_eventId: string): Promise<PartnerLimits> {
    return {
      maxStake: 0,
      maxWin: 0,
      currency: this.credentials.currency,
      note: "fantasy402: bet limits endpoint not mapped — stub only",
    };
  }

  /**
   * Place bet — **POST URL still unmapped**.
   *
   * Response wire is known (`betGroups` + `e`); use {@link interpretBetTicketResponse}
   * when you have a captured body. Live POST requires Network capture of Place Bet.
   */
  async placeOrder(order: PartnerOrder): Promise<PartnerExecutionResult> {
    if (order.dryRun !== false) {
      return {
        success: false,
        dryRun: true,
        error:
          "fantasy402: placeOrder dry-run — response shape known (betGroups/ticketNumber/finalOdds/risk/toWin); POST URL not mapped. Capture Place Bet request.",
        raw: {
          intent: {
            eventId: order.eventId,
            marketId: order.marketId,
            key: order.key,
            periodId: order.periodId,
            stake: order.stake,
            price: order.price,
          },
        },
      };
    }
    return {
      success: false,
      dryRun: false,
      error:
        "fantasy402: placeOrder blocked — implement POST from Place Bet HAR; parser ready via interpretBetTicketResponse()",
    };
  }

  /**
   * Parse a captured place-bet / open-ticket JSON into execution result.
   * Does not call the network.
   */
  interpretBetTicketResponse(wire: unknown): PartnerExecutionResult {
    return executionResultFromBetGroups(wire);
  }

  /** List groups from a captured open-bets / place response. */
  parseOpenTickets(wire: unknown) {
    return parseBetGroupsResponse(wire);
  }

  /**
   * Connect to Pandora Socket.IO (live odds transport).
   * Subscription payload is **unknown** until DevTools Messages are captured —
   * use {@link PandoraSocket.subscribePlaceholder} with a raw frame when known.
   */
  connectWebSocket(
    handlers: PandoraSocketHandlers = {},
    options: Omit<PandoraSocketOptions, "handlers"> = {},
  ): PandoraSocket {
    this.disconnectWebSocket();
    this.pandora = new PandoraSocket({
      ...options,
      handlers: {
        ...handlers,
        onLog: (line) => {
          handlers.onLog?.(line);
        },
      },
    });
    this.pandora.connect();
    return this.pandora;
  }

  getWebSocket(): PandoraSocket | null {
    return this.pandora;
  }

  disconnectWebSocket(): void {
    this.pandora?.close();
    this.pandora = null;
  }
}
