/**
 * Fonbet feed connection manager — Bun-native, resilient.
 *
 * Real Bun 1.4 building blocks (verified in bun-types 1.4.0):
 *   - Bun.dns.prefetch(hostname, port?) — warm DNS caches (256 entries, 30s).
 *   - fetch keepalive + connection pooling — automatic in Bun (256 idle
 *     connections per (hostname, port) key); nothing to configure.
 *   - Client WebSocket — standard API; reconnection is manual (Bun's
 *     idleTimeout/reconnect options are server-side only), so this module
 *     owns reconnect with exponential backoff.
 *   - fetch.preconnect(...) — NOT present in bun-types 1.4.0 (documented as
 *     unavailable; DNS prefetch is the real warm-up mechanism).
 *
 * Client-side filtering (sport / league / team) happens before persistence
 * to cut noise; live_delay is surfaced via onLog for freshness estimates.
 *
 * @see src/institutions/fonbet/parse.ts — wire parser
 * @see tools/fonbet-sync-cli.ts — consumer
 */
import type { FonbetEventWire, FonbetMarketWire } from "./parse.ts";

export type FonbetFeedFilters = {
  sport?: string;
  leagues?: string[];
  teams?: string[];
};

/**
 * Client-side event filter: sport (exact, lowercased), league (case-
 * insensitive exact), teams (case-insensitive substring both directions).
 */
export function filterFonbetEvent(
  ev: FonbetEventWire,
  filters: FonbetFeedFilters = {},
): boolean {
  if (filters.sport && String(ev.sport ?? "").toLowerCase() !== filters.sport.toLowerCase()) return false;
  if (filters.leagues?.length) {
    const league = String(ev.league_name ?? "").toLowerCase();
    if (!filters.leagues.some((l) => l.toLowerCase() === league)) return false;
  }
  if (filters.teams?.length) {
    const t1 = String(ev.team1 ?? "").toLowerCase();
    const t2 = String(ev.team2 ?? "").toLowerCase();
    const hit = filters.teams.some((t) => {
      const n = t.toLowerCase();
      return t1.includes(n) || t2.includes(n) || n.includes(t1) || n.includes(t2);
    });
    if (!hit) return false;
  }
  return true;
}

export type DnsWarmTarget = string | { hostname: string; port?: number };

/** Best-effort DNS warm-up for the hosts we talk to (Bun.dns.prefetch). */
export function prefetchDns(targets: DnsWarmTarget[]): void {
  for (const t of targets) {
    const host = typeof t === "string" ? { hostname: t } : t;
    try {
      Bun.dns.prefetch(host.hostname, host.port ?? 443);
    } catch {
      // best effort — never fail startup on DNS warm-up
    }
  }
}

/**
 * Reconnect delay: base * 2^attempt, capped. Pure + tested.
 */
export function nextReconnectDelay(
  attempt: number,
  baseMs: number = 1_000,
  maxMs: number = 30_000,
): number {
  const exp = Math.min(attempt, 10);
  return Math.min(baseMs * 2 ** exp, maxMs);
}

export type FonbetFeedHandlers = {
  onEvent?: (ev: FonbetEventWire, markets: FonbetMarketWire[], key: string) => void;
  onLog?: (line: string) => void;
};

export type FonbetFeedOptions = {
  authKey: string;
  url?: string;
  filters?: FonbetFeedFilters;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
};

export type FonbetFeedSession = {
  /** Stop the session: closes the socket and cancels pending reconnects. */
  close: () => void;
};

export const FONBET_ODDSCORP_URL = "ws://api.oddscp.com:8001";

/**
 * Connect to the ODDSCORP feed with auto-reconnect (exponential backoff).
 * Messages are parsed minimally here (event vs markets) and passed to the
 * handlers only when they pass the client-side filters.
 */
export function connectFonbetFeed(
  opts: FonbetFeedOptions,
  handlers: FonbetFeedHandlers = {},
): FonbetFeedSession {
  const url = opts.url ?? FONBET_ODDSCORP_URL;
  const base = opts.reconnectBaseMs ?? 1_000;
  const max = opts.reconnectMaxMs ?? 30_000;
  let closed = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  function log(line: string): void {
    handlers.onLog?.(line);
  }

  function subscribe(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload = {
      cmd: "subscribe",
      auth_key: opts.authKey,
      needed_bk: ["fonbet:prematch", "fonbet:live"],
      needed_sport: opts.filters?.sport ? [opts.filters.sport] : undefined,
      send_events_ids: true,
      send_actual_first: true,
      short_format: true,
    };
    ws.send(JSON.stringify(payload));
    log("subscribed fonbet:prematch + fonbet:live" + (opts.filters?.sport ? " · sport=" + opts.filters.sport : ""));
  }

  function handleMessage(raw: string): void {
    let msg: unknown[];
    try {
      msg = JSON.parse(raw) as unknown[];
    } catch {
      return; // keepalive / non-JSON
    }
    if (!Array.isArray(msg) || msg[0] !== "fonbet") return;
    const kind = msg[1];
    const key = typeof msg[2] === "string" ? msg[2] : "";
    const payload = msg[3];
    if (kind === "update_markets" && Array.isArray(payload)) {
      // markets ride along with the next update_event for the same key
      pendingMarkets.set(key, payload as FonbetMarketWire[]);
      return;
    }
    if (kind === "update_event" && payload && typeof payload === "object") {
      const ev = payload as FonbetEventWire;
      if (filterFonbetEvent(ev, opts.filters)) {
        const delay = ev.live_delay;
        if (delay != null && Number(delay) > 0) log("live_delay=" + delay);
        handlers.onEvent?.(ev, pendingMarkets.get(key) ?? [], key);
      }
    }
  }

  const pendingMarkets = new Map<string, FonbetMarketWire[]>();

  function connect(): void {
    if (closed) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      attempt = 0;
      log("connected");
      subscribe();
    };
    ws.onmessage = (event) => handleMessage(String(event.data));
    ws.onerror = () => log("ws error");
    ws.onclose = () => {
      log("ws closed");
      if (closed) return;
      const delay = nextReconnectDelay(attempt, base, max);
      attempt++;
      log("reconnecting in " + delay + "ms (attempt " + attempt + ")");
      reconnectTimer = setTimeout(connect, delay);
    };
  }

  connect();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
