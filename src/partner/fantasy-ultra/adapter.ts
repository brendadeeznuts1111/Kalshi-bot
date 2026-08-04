// @see https://bun.com/docs/api/fetch
/**
 * Fantasy402 Ultra Live partner adapter.
 *
 * - login → POST getUltraLiveURL → { URL: { DESKTOP, MOBILE } }
 * - fetchEvents → GET stream-list-v2 (live coverage catalog, not odds book)
 * - fetchLimits / placeOrder → not mapped yet (safe stubs)
 */
import type {
  PartnerExecutionResult,
  PartnerLimits,
  PartnerLiveEvent,
  PartnerLiveUrlSet,
  PartnerOrder,
  PartnerOrderAdapter,
} from "../types.ts";
import { originFromLiveUrl, parseStreamList, parseUltraLiveUrlResponse } from "./parse.ts";
import {
  FANTASY_ULTRA_DEFAULTS,
  type FantasyUltraCredentials,
} from "./types.ts";

export type FantasyUltraAdapterOptions = {
  credentials: FantasyUltraCredentials;
  fetchImpl?: typeof fetch;
  /** Override stream list URL (tests). */
  streamListUrl?: string;
  ultraLiveUrl?: string;
};

export class FantasyUltraAdapter implements PartnerOrderAdapter {
  readonly partnerId = FANTASY_ULTRA_DEFAULTS.partnerId;
  private readonly credentials: FantasyUltraCredentials;
  private readonly fetchImpl: typeof fetch;
  private readonly ultraLiveUrl: string;
  private readonly streamListUrl: string;
  private liveUrls: PartnerLiveUrlSet | null = null;

  constructor(options: FantasyUltraAdapterOptions) {
    this.credentials = options.credentials;
    this.fetchImpl = options.fetchImpl ?? fetch;
    const domain = options.credentials.domain.replace(/\/$/, "");
    this.ultraLiveUrl =
      options.ultraLiveUrl ??
      `${domain}${FANTASY_ULTRA_DEFAULTS.ultraLivePath}`;
    this.streamListUrl =
      options.streamListUrl ?? FANTASY_ULTRA_DEFAULTS.streamListUrl;
  }

  getLiveUrls(): PartnerLiveUrlSet | null {
    return this.liveUrls;
  }

  async login(): Promise<PartnerLiveUrlSet> {
    const c = this.credentials;
    const token = c.bearerToken.replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new Error("fantasy402: bearerToken required");

    const res = await this.fetchImpl(this.ultraLiveUrl, {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
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
    this.liveUrls = parseUltraLiveUrlResponse(json);
    return this.liveUrls;
  }

  async fetchEvents(options: { sport?: string } = {}): Promise<PartnerLiveEvent[]> {
    if (!this.liveUrls) {
      await this.login();
    }
    const origin = this.liveUrls
      ? originFromLiveUrl(this.liveUrls.desktop)
      : FANTASY_ULTRA_DEFAULTS.streamOrigin;

    const res = await this.fetchImpl(this.streamListUrl, {
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*",
        origin,
        referer: `${origin}/`,
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
          "fantasy402: placeOrder not mapped to a bet wire — dry-run only (set dryRun:false still blocked until endpoint exists)",
      };
    }
    return {
      success: false,
      dryRun: false,
      error:
        "fantasy402: placeOrder blocked — Ultra Live session is coverage/stream, not a bet ticket API yet",
    };
  }
}
