// @see https://bun.com/docs/runtime/http/websockets
// @see https://docs.kalshi.com/getting_started/quick_start_websockets
// @see https://docs.kalshi.com/websockets/orderbook-updates
/**
 * Authenticated Kalshi market-data WebSocket (orderbook_delta).
 * Bun client WebSocket supports handshake headers (not available in browsers).
 */
import { OFFICIAL_URLS } from "../institutions/official-urls.ts";
import type { KalshiMarketTicker } from "../institutions/event-store/brands.ts";
import { unbrand } from "../institutions/event-store/brands.ts";
import {
  KALSHI_WS_PATH,
  kalshiWsAccessHeaders,
  loadKalshiCredentials,
  type KalshiCredentials,
} from "./kalshi-auth.ts";

export const KALSHI_WS_URL_DEFAULT = OFFICIAL_URLS.kalshi.tradeApiWsV2;

export type KalshiWsWire = {
  type?: string;
  id?: number;
  sid?: number;
  seq?: number;
  msg?: Record<string, unknown>;
};

export type KalshiWsHandlers = {
  onOpen?: () => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (err: Error) => void;
  onMessage?: (wire: KalshiWsWire, recvTs: number, raw: string) => void;
};

export type KalshiWsSocket = {
  readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  ping?: () => void;
  addEventListener: (
    type: string,
    listener: (ev: { data?: string | ArrayBuffer; code?: number; reason?: string }) => void,
  ) => void;
};

export type KalshiWsFactory = (url: string, headers: Record<string, string>) => KalshiWsSocket;

function defaultWsFactory(url: string, headers: Record<string, string>): KalshiWsSocket {
  // Bun extension: headers on client WebSocket constructor (not in DOM lib typings).
  const BunWebSocket = WebSocket as unknown as new (
    url: string,
    opts: { headers: Record<string, string> },
  ) => KalshiWsSocket;
  return new BunWebSocket(url, { headers });
}

export function resolveKalshiWsUrl(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): string {
  const override = env.KALSHI_WS_URL?.trim();
  if (override) return override;
  return KALSHI_WS_URL_DEFAULT;
}

export function resolveKalshiWsDocsUrl(): string {
  return OFFICIAL_URLS.kalshi.tradeApiDocs;
}

export class KalshiMarketWs {
  private ws: KalshiWsSocket | null = null;
  private cmdId = 1;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    private readonly options: {
      creds?: KalshiCredentials;
      url?: string;
      handlers?: KalshiWsHandlers;
      wsFactory?: KalshiWsFactory;
      /** Client ping interval ms (default 20s). 0 disables. */
      pingIntervalMs?: number;
    } = {},
  ) {}

  get connected(): boolean {
    return this.ws != null && this.ws.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (this.closed) throw new Error("KalshiMarketWs already closed");
    const creds = this.options.creds ?? loadKalshiCredentials();
    const url = this.options.url ?? resolveKalshiWsUrl();
    const headers = kalshiWsAccessHeaders(creds) as unknown as Record<string, string>;
    const factory = this.options.wsFactory ?? defaultWsFactory;
    const ws = factory(url, headers);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.startPing();
      this.options.handlers?.onOpen?.();
    });
    ws.addEventListener("message", (ev) => {
      const recvTs = Date.now();
      const raw = typeof ev.data === "string" ? ev.data : "";
      if (!raw) return;
      let wire: KalshiWsWire;
      try {
        wire = JSON.parse(raw) as KalshiWsWire;
      } catch {
        return;
      }
      this.options.handlers?.onMessage?.(wire, recvTs, raw);
    });
    ws.addEventListener("error", () => {
      this.options.handlers?.onError?.(new Error("Kalshi WebSocket error"));
    });
    ws.addEventListener("close", (ev) => {
      this.stopPing();
      this.ws = null;
      this.options.handlers?.onClose?.(ev.code ?? 0, String(ev.reason ?? ""));
    });
  }

  private startPing(): void {
    this.stopPing();
    const ms = this.options.pingIntervalMs ?? 20_000;
    if (ms <= 0) return;
    this.pingTimer = setInterval(() => {
      try {
        this.ws?.ping?.();
      } catch {
        /* optional */
      }
    }, ms);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private nextId(): number {
    return this.cmdId++;
  }

  send(cmd: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Kalshi WebSocket not open");
    }
    this.ws.send(JSON.stringify(cmd));
  }

  /** Subscribe to orderbook_delta for the given market tickers. */
  subscribeOrderbook(tickers: KalshiMarketTicker[]): number {
    const id = this.nextId();
    const unique = [...new Set(tickers.filter(Boolean).map(unbrand))];
    if (unique.length === 0) return id;
    this.send({
      id,
      cmd: "subscribe",
      params: {
        channels: ["orderbook_delta"],
        market_tickers: unique,
        send_initial_snapshot: true,
      },
    });
    return id;
  }

  /** Request fresh snapshots without changing subscription membership. */
  requestSnapshots(sid: number, tickers: KalshiMarketTicker[]): number {
    const id = this.nextId();
    this.send({
      id,
      cmd: "update_subscription",
      params: {
        sid,
        action: "get_snapshot",
        market_tickers: [...new Set(tickers.filter(Boolean).map(unbrand))],
      },
    });
    return id;
  }

  /** Add tickers to an existing orderbook_delta subscription (preserves sid + seq stream). */
  addOrderbookMarkets(sid: number, tickers: KalshiMarketTicker[]): number {
    const id = this.nextId();
    const unique = [...new Set(tickers.filter(Boolean).map(unbrand))];
    if (unique.length === 0) return id;
    this.send({
      id,
      cmd: "update_subscription",
      params: {
        sid,
        action: "add_markets",
        market_tickers: unique,
      },
    });
    return id;
  }

  close(): void {
    this.closed = true;
    this.stopPing();
    try {
      this.ws?.close(1000, "client_close");
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}

export { KALSHI_WS_PATH };
