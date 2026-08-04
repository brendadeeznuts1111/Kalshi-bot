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
  PartnerExecutionResult,
  PartnerLimits,
  PartnerLiveEvent,
  PartnerLiveUrlSet,
  PartnerOrder,
  PartnerSportLeague,
} from "../types.ts";
import { CookieJar } from "./cookie-jar.ts";
import {
  originFromLiveUrl,
  parseRenewTokenResponse,
  parseSportsLeagues,
  parseStreamList,
  parseUltraLiveUrlResponse,
} from "./parse.ts";
import {
  FANTASY_ULTRA_DEFAULTS,
  type FantasyUltraCredentials,
} from "./types.ts";

export type FantasyUltraAdapterOptions = {
  credentials: FantasyUltraCredentials;
  fetchImpl?: typeof fetch;
  streamListUrl?: string;
  ultraLiveUrl?: string;
  sportsLeaguesUrl?: string;
  renewTokenUrl?: string;
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
  private readonly autoWarm: boolean;
  private readonly jar = new CookieJar();
  private bearerToken: string;
  private liveUrls: PartnerLiveUrlSet | null = null;
  private warmed = false;

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

  async fetchEvents(
    options: { sport?: string } = {},
  ): Promise<PartnerLiveEvent[]> {
    await this.ensureSession();
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
    const json: unknown = await res.json();
    return parseStreamList(json, { sport: options.sport ?? "tennis" });
  }

  async fetchLimits(_eventId: string): Promise<PartnerLimits> {
    return {
      maxStake: 0,
      maxWin: 0,
      currency: this.credentials.currency,
      note: "fantasy402: bet limits endpoint not mapped — stub only",
    };
  }

  async placeOrder(order: PartnerOrder): Promise<PartnerExecutionResult> {
    if (order.dryRun !== false) {
      return {
        success: false,
        dryRun: true,
        error:
          "fantasy402: placeOrder not mapped to a bet wire — dry-run only (capture PlaceBet HAR to implement)",
      };
    }
    return {
      success: false,
      dryRun: false,
      error:
        "fantasy402: placeOrder blocked — no PlaceBet endpoint mapped (stream catalog ≠ ticket API)",
    };
  }
}
