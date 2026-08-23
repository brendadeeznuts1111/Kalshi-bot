// @see https://bun.com/docs/runtime/http/websockets
// @see https://bun.com/docs/blog/bun-v1.3.6#httphttps-proxy-support-for-websocket
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
import {
  parseKalshiWsErrorWire,
  type KalshiWsServerError,
} from "./kalshi-ws-errors.ts";

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
  onKalshiError?: (err: KalshiWsServerError, wire: KalshiWsWire) => void;
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

/**
 * Proxy control values for the client WebSocket (Bun v1.3.6+).
 * All ws:// and wss:// combinations work through HTTP and HTTPS proxies.
 * @see https://bun.com/blog/bun-v1.3.6#http-https-proxy-support-for-websocket
 */
export type KalshiWsProxyOptions = NonNullable<Bun.WebSocketOptions["proxy"]>;

/**
 * Granular TLS control values for the client WebSocket `tls` option.
 * Subset of Bun's TLSOptions relevant to a wss:// client; matches `fetch` TLS.
 * @see https://bun.com/docs/runtime/networking/fetch
 */
export type KalshiWsTlsOptions = NonNullable<Bun.WebSocketOptions["tls"]>;

export type KalshiWsNetOptions = Pick<Bun.WebSocketOptions, "proxy" | "tls">;

type BunClientWebSocketOptions = Pick<
  Bun.WebSocketOptions,
  "headers" | "proxy" | "tls"
>;

type BunClientWebSocketConstructor = new (
  url: string | URL,
  options?: Bun.WebSocketOptions,
) => WebSocket;

function kalshiWsTargetHost(
  env: Record<string, string | undefined>,
  targetHost?: string,
): string {
  if (targetHost?.trim()) return targetHost.trim().toLowerCase();
  const urlOverride = env.KALSHI_WS_URL?.trim();
  if (urlOverride) {
    try {
      return new URL(urlOverride).hostname.toLowerCase();
    } catch {
      /* fall through */
    }
  }
  try {
    return new URL(KALSHI_WS_URL_DEFAULT).hostname.toLowerCase();
  } catch {
    return "external-api-ws.kalshi.com";
  }
}

/** NO_PROXY / no_proxy comma list — host exact match or domain suffix (`.kalshi.com`). */
export function parseNoProxyHosts(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function hostMatchesNoProxy(host: string, noProxyEntry: string): boolean {
  const h = host.toLowerCase();
  const entry = noProxyEntry.toLowerCase();
  if (!entry) return false;
  if (entry === h) return true;
  if (entry.startsWith(".")) return h === entry.slice(1) || h.endsWith(entry);
  if (entry.includes(".")) return h === entry || h.endsWith(`.${entry}`);
  return false;
}

export function isHostInNoProxy(host: string, noProxyList: string[]): boolean {
  return noProxyList.some((entry) => hostMatchesNoProxy(host, entry));
}

/**
 * Env proxy for Kalshi WS — KALSHI_WS_PROXY overrides HTTPS_PROXY / HTTP_PROXY.
 * NO_PROXY / no_proxy suppresses proxy when target host matches.
 */
export function resolveKalshiWsProxy(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
  targetHost?: string,
): string | undefined {
  const explicit = env.KALSHI_WS_PROXY?.trim();
  if (explicit) return explicit;

  const host = kalshiWsTargetHost(env, targetHost);
  const noProxy = parseNoProxyHosts(env.NO_PROXY ?? env.no_proxy);
  if (isHostInNoProxy(host, noProxy)) return undefined;

  return (
    env.HTTPS_PROXY?.trim() ||
    env.https_proxy?.trim() ||
    env.HTTP_PROXY?.trim() ||
    env.http_proxy?.trim() ||
    undefined
  );
}

/** Exponential reconnect backoff with jitter (WS session drops). */
export function kalshiWsReconnectBackoffMs(
  attempt: number,
  baseMs = 1_000,
  maxMs = 30_000,
  random: () => number = Math.random,
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 5));
  return exp + Math.floor(random() * Math.min(250, exp * 0.1));
}

/**
 * Granular TLS control values from env (constructor `net.tls` overrides win):
 * - KALSHI_WS_TLS_REJECT_UNAUTHORIZED "0"/"false"/"no" disables cert validation
 * - KALSHI_WS_TLS_CA_FILE / _CERT_FILE / _KEY_FILE → Bun.file() for ca/cert/key
 * - KALSHI_WS_TLS_PASSPHRASE / _SERVER_NAME / _CIPHERS → passed through
 */
export function resolveKalshiWsTls(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): KalshiWsTlsOptions | undefined {
  const tls: KalshiWsTlsOptions = {};
  const reject = env.KALSHI_WS_TLS_REJECT_UNAUTHORIZED?.trim().toLowerCase();
  if (reject === "0" || reject === "false" || reject === "no") tls.rejectUnauthorized = false;
  const caFile = env.KALSHI_WS_TLS_CA_FILE?.trim();
  if (caFile) tls.ca = Bun.file(caFile);
  const certFile = env.KALSHI_WS_TLS_CERT_FILE?.trim();
  if (certFile) tls.cert = Bun.file(certFile);
  const keyFile = env.KALSHI_WS_TLS_KEY_FILE?.trim();
  if (keyFile) tls.key = Bun.file(keyFile);
  if (env.KALSHI_WS_TLS_PASSPHRASE) tls.passphrase = env.KALSHI_WS_TLS_PASSPHRASE;
  const serverName = env.KALSHI_WS_TLS_SERVER_NAME?.trim();
  if (serverName) tls.serverName = serverName;
  const ciphers = env.KALSHI_WS_TLS_CIPHERS?.trim();
  if (ciphers) tls.ciphers = ciphers;
  return Object.keys(tls).length > 0 ? tls : undefined;
}

/** Combined granular net control values from env (proxy + TLS). */
export function resolveKalshiWsNetOptions(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): KalshiWsNetOptions {
  const net: KalshiWsNetOptions = {};
  const proxy = resolveKalshiWsProxy(env);
  if (proxy) net.proxy = proxy;
  const tls = resolveKalshiWsTls(env);
  if (tls) net.tls = tls;
  return net;
}

function defaultWsFactory(
  url: string,
  headers: Record<string, string>,
  net: KalshiWsNetOptions = resolveKalshiWsNetOptions(),
): KalshiWsSocket {
  const opts: BunClientWebSocketOptions = { headers, ...net };
  // lib.dom wins TypeScript's global constructor selection and hides Bun's
  // canonical options overload. Keep the compatibility cast at this boundary;
  // the constructor options themselves remain derived from Bun.WebSocketOptions.
  const BunClientWebSocket = WebSocket as unknown as BunClientWebSocketConstructor;
  return new BunClientWebSocket(url, opts);
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
      /**
       * Granular proxy/TLS control values for the default factory.
       * Overrides env (KALSHI_WS_PROXY, KALSHI_WS_TLS_*). Ignored with a custom wsFactory.
       */
      net?: KalshiWsNetOptions;
    } = {},
  ) {}

  get connected(): boolean {
    return this.ws != null && this.ws.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    if (this.closed) throw new Error("KalshiMarketWs already closed");
    const creds = this.options.creds ?? await loadKalshiCredentials();
    const url = this.options.url ?? resolveKalshiWsUrl();
    const headers = kalshiWsAccessHeaders(creds) as unknown as Record<string, string>;
    const factory =
      this.options.wsFactory ??
      ((u, h) => defaultWsFactory(u, h, this.options.net ?? resolveKalshiWsNetOptions()));
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
      const kalshiErr = parseKalshiWsErrorWire(wire);
      if (kalshiErr) this.options.handlers?.onKalshiError?.(kalshiErr, wire);
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
