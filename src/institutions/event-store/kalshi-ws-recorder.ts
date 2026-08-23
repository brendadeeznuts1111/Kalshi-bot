// @see https://docs.kalshi.com/websockets/orderbook-updates
// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/runtime/http/websockets
/**
 * Watch-set Kalshi orderbook WebSocket → book_ticks (dual-clock).
 * ts = exchange ts_ms when present (source_clock=exchange); else recv (source_clock=recv).
 * Always stores recv_ts at message receipt.
 */
import type { Database } from "bun:sqlite";
import { KalshiMarketWs, kalshiWsReconnectBackoffMs, type KalshiWsFactory, type KalshiWsWire } from "../../bot/kalshi-ws.ts";
import { loadKalshiCredentials, probeKalshiAuth, type KalshiCredentials } from "../../bot/kalshi-auth.ts";
import {
  KALSHI_WS_ERROR_LABELS,
  parseKalshiWsErrorWire,
  shouldReconnectKalshiWsError,
  type KalshiWsServerError,
} from "../../bot/kalshi-ws-errors.ts";
import { marketKindFromTicker } from "./tennis-ladder.ts";
import {
  asCanonicalEventId,
  tryKalshiMarketTicker,
  unbrand,
  type CanonicalEventId,
  type KalshiMarketTicker,
} from "./brands.ts";
import {
  applyOrderbookDelta,
  applyOrderbookSnapshot,
  createEmptyLiveOrderbook,
  liveOrderbookToSnapshot,
  type LiveOrderbook,
} from "./orderbook-live.ts";
import {
  advanceOrderbookStreamSeq,
  createOrderbookStreamState,
  resetOrderbookStreamSeq,
  type OrderbookStreamState,
} from "./orderbook-stream.ts";
import { bookTickClocks } from "../../lib/time-ssot.ts";
import { listRecordTickers } from "./watch-set.ts";
import { persistTennisWsRecorderSession } from "./tennis-ws-recorder-store.ts";
import {
  KALSHI_BOOK_SOURCE_WS,
  TENNIS_WS_WATCH_REFRESH_MS,
} from "./tennis-lane-constants.ts";

import { OFFICIAL_URLS } from "../official-urls.ts";

const SOURCE = KALSHI_BOOK_SOURCE_WS;
const SOURCE_URL = OFFICIAL_URLS.kalshi.tradeApiWsV2;

export type WsRecorderSummary = {
  ticksRecorded: number;
  snapshots: number;
  deltas: number;
  seqGaps: number;
  duplicates: number;
  errors: number;
  /** Kalshi wire `{ type: "error" }` frames (distinct from local book/DB errors). */
  wsErrors: number;
  subscribed: number;
  resyncRequests: number;
  /**
   * Classified error occurrences. Numeric keys ("9") = official Kalshi wire codes
   * (see KALSHI_WS_ERROR_LABELS); E_* keys = local probe taxonomy (classifyProbeError).
   */
  errorCodes?: Record<string, number>;
};

/** Local probe error taxonomy (keys of WsRecorderSummary.errorCodes). */
export type ProbeErrorCode =
  | "E_PARSE" // wire frame / payload parse failure
  | "E_DB" // sqlite write / DB mapping failure
  | "E_TIMEOUT" // command / fetch timeout
  | "E_HANDSHAKE" // WS connect/handshake failure (incl. HTTP 401 on upgrade)
  | "E_AUTH" // credential load / signing / 401 signature failures
  | "E_NET" // other socket / network failure
  | "E_UNKNOWN";

/** Classify a local (non-wire) error into the probe taxonomy from its message. */
export function classifyProbeError(err: unknown): ProbeErrorCode {
  const msg = err instanceof Error ? err.message : String(err);
  if (/INCORRECT_API_KEY_SIGNATURE|\b401\b|Missing KALSHI_\w+|authentication/i.test(msg)) {
    return "E_AUTH";
  }
  // Closed/delisted REST: not network — use E_UNKNOWN at taxonomy layer; canary tags E_HTTP_FORBIDDEN
  if (/\b403\b|\b410\b|Forbidden|Gone/i.test(msg) && !/Expected 101|handshake/i.test(msg)) {
    return "E_UNKNOWN";
  }
  if (/timeout|timed out/i.test(msg)) return "E_TIMEOUT";
  if (/SQLITE|sqlite/i.test(msg)) return "E_DB";
  if (/Expected 101|handshake|upgrade/i.test(msg)) return "E_HANDSHAKE";
  if (/JSON|parse/i.test(msg)) return "E_PARSE";
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|socket|WebSocket|fetch failed/i.test(msg)) return "E_NET";
  if (/:\s*5\d\d\b|\b50[0-9]\b/.test(msg)) return "E_UNKNOWN"; // upstream 5xx — not local socket
  return "E_UNKNOWN";
}

/** Bump one error-code bucket (tolerates summaries built before errorCodes existed). */
export function recordProbeErrorCode(summary: WsRecorderSummary, code: string): void {
  const map = (summary.errorCodes ??= {});
  map[code] = (map[code] ?? 0) + 1;
}

/**
 * Bracketed top-N error codes for the one-line summary, e.g.
 * ` [E_AUTH×13]` or ` [9:Authentication required×9,E_TIMEOUT×4]`. "" when clean.
 */
export function formatProbeErrorCodes(
  summary: Pick<WsRecorderSummary, "errorCodes">,
  max = 3,
): string {
  const entries = Object.entries(summary.errorCodes ?? {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "";
  const parts = entries.slice(0, max).map(([code, n]) => {
    const label = /^\d+$/.test(code)
      ? KALSHI_WS_ERROR_LABELS[Number(code) as keyof typeof KALSHI_WS_ERROR_LABELS]
      : undefined;
    return label ? `${code}:${label}×${n}` : `${code}×${n}`;
  });
  return ` [${parts.join(",")}]`;
}

export type WsRecorderOptions = {
  leadMinutes?: number;
  limit?: number;
  creds?: KalshiCredentials;
  /** Refresh watch-set membership (ms). Default 30s. */
  refreshMs?: number;
  /** Reconnect backoff base ms. Default 1s. */
  reconnectBaseMs?: number;
  /** Max runtime ms; 0 = until abort. */
  durationMs?: number;
  signal?: AbortSignal;
  dryRun?: boolean;
  onTick?: (info: { ticker: KalshiMarketTicker; seq: number; sourceClock: string }) => void;
  wsFactory?: KalshiWsFactory;
};

function eventIdForTicker(db: Database, ticker: KalshiMarketTicker): CanonicalEventId | null {
  const mapped = db
    .query(`SELECT event_id AS eventId FROM markets WHERE ticker = $ticker`)
    .get({ $ticker: unbrand(ticker) }) as { eventId: string } | null;
  if (!mapped?.eventId) return null;
  return asCanonicalEventId(mapped.eventId);
}

function insertBookTick(
  db: Database,
  args: {
    eventId: CanonicalEventId;
    ticker: KalshiMarketTicker;
    seq: number;
    ts: number;
    recvTs: number;
    sourceClock: "exchange" | "recv";
    levelsJson: string;
  },
): void {
  // Clocks already normalized via bookTickClocks at call sites (epoch ms).
  db.query(
    `INSERT INTO book_ticks (
       event_id, ticker, market_kind, ts, seq, levels_json, source, source_url, recv_ts, source_clock
     ) VALUES (
       $event_id, $ticker, $market_kind, $ts, $seq, $levels_json, $source, $source_url, $recv_ts, $source_clock
     )`,
  ).run({
    $event_id: unbrand(args.eventId),
    $ticker: unbrand(args.ticker),
    $market_kind: marketKindFromTicker(args.ticker),
    $ts: args.ts,
    $seq: args.seq,
    $levels_json: args.levelsJson,
    $source: SOURCE,
    $source_url: SOURCE_URL,
    $recv_ts: args.recvTs,
    $source_clock: args.sourceClock,
  });
}

function asMsg(wire: KalshiWsWire): Record<string, unknown> | null {
  return wire.msg && typeof wire.msg === "object" ? wire.msg : null;
}

/**
 * Apply a parsed Kalshi wire error to recorder counters.
 * Returns true when the session should reconnect (close WS).
 */
export function applyKalshiWsWireError(
  summary: WsRecorderSummary,
  err: KalshiWsServerError,
): boolean {
  summary.wsErrors++;
  summary.errors++;
  recordProbeErrorCode(summary, String(err.code));
  return shouldReconnectKalshiWsError(err.code);
}

/**
 * Process one WS wire frame into live books / optional DB write.
 * Pure enough for unit tests via injected books map.
 */
export function handleOrderbookWire(
  db: Database | null,
  books: Map<KalshiMarketTicker, LiveOrderbook>,
  wire: KalshiWsWire,
  recvTs: number,
  options: {
    dryRun?: boolean;
    onTick?: WsRecorderOptions["onTick"];
    stream?: OrderbookStreamState;
  } = {},
): {
  kind: "snapshot" | "delta" | "gap" | "ignore" | "error" | "duplicate";
  ticker?: KalshiMarketTicker;
} {
  const type = wire.type;
  const seq = typeof wire.seq === "number" ? wire.seq : null;
  const msg = asMsg(wire);
  if (!msg || seq == null) return { kind: "ignore" };
  const ticker = tryKalshiMarketTicker(
    typeof msg.market_ticker === "string" ? msg.market_ticker : undefined,
  );
  if (!ticker) return { kind: "ignore" };

  const stream = options.stream;
  if (stream) {
    if (typeof wire.sid === "number") stream.sid = wire.sid;
    const seqVerdict = advanceOrderbookStreamSeq(stream, seq);
    if (seqVerdict === "duplicate") return { kind: "duplicate", ticker };
    if (seqVerdict === "gap") return { kind: "gap", ticker };
  }

  let book = books.get(ticker);
  if (!book) {
    book = createEmptyLiveOrderbook(ticker);
    books.set(ticker, book);
  }

  if (type === "orderbook_snapshot") {
    applyOrderbookSnapshot(
      book,
      {
        market_ticker: unbrand(ticker),
        yes_dollars_fp: msg.yes_dollars_fp,
        no_dollars_fp: msg.no_dollars_fp,
      },
      seq,
    );
    const clocks = bookTickClocks({ recvTsMs: recvTs });
    const snap = liveOrderbookToSnapshot(book, clocks.ts);
    if (snap && db && !options.dryRun) {
      const eventId = eventIdForTicker(db, ticker);
      if (!eventId) return { kind: "error", ticker };
      insertBookTick(db, {
        eventId,
        ticker,
        seq,
        ts: clocks.ts,
        recvTs: clocks.recvTs,
        sourceClock: clocks.sourceClock,
        levelsJson: JSON.stringify(snap),
      });
    }
    options.onTick?.({ ticker, seq, sourceClock: clocks.sourceClock });
    return { kind: "snapshot", ticker };
  }

  if (type === "orderbook_delta") {
    const ok = applyOrderbookDelta(
      book,
      {
        market_ticker: unbrand(ticker),
        price_dollars: String(msg.price_dollars ?? ""),
        delta_fp: String(msg.delta_fp ?? ""),
        side: String(msg.side ?? ""),
      },
      seq,
    );
    if (!ok) return { kind: "error", ticker };
    const exchangeTs =
      typeof msg.ts_ms === "number" && Number.isFinite(msg.ts_ms) ? msg.ts_ms : null;
    const clocks = bookTickClocks({
      exchangeTsMs: exchangeTs,
      recvTsMs: recvTs,
    });
    const snap = liveOrderbookToSnapshot(book, clocks.ts);
    if (snap && db && !options.dryRun) {
      const eventId = eventIdForTicker(db, ticker);
      if (!eventId) return { kind: "error", ticker };
      insertBookTick(db, {
        eventId,
        ticker,
        seq,
        ts: clocks.ts,
        recvTs: clocks.recvTs,
        sourceClock: clocks.sourceClock,
        levelsJson: JSON.stringify(snap),
      });
    }
    options.onTick?.({ ticker, seq, sourceClock: clocks.sourceClock });
    return { kind: "delta", ticker };
  }

  return { kind: "ignore" };
}

/**
 * Connect, subscribe to watch-set tickers, write book_ticks until abort/duration.
 * Reconnects with exponential backoff. Refreshes watch membership periodically.
 */
export async function runKalshiWsWatchRecorder(
  db: Database,
  options: WsRecorderOptions = {},
): Promise<WsRecorderSummary> {
  const summary: WsRecorderSummary = {
    ticksRecorded: 0,
    snapshots: 0,
    deltas: 0,
    seqGaps: 0,
    duplicates: 0,
    errors: 0,
    wsErrors: 0,
    subscribed: 0,
    resyncRequests: 0,
    errorCodes: {},
  };
  const dryRun = options.dryRun === true;
  const refreshMs = options.refreshMs ?? TENNIS_WS_WATCH_REFRESH_MS;
  const reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
  const durationMs = options.durationMs ?? 0;
  const started = Date.now();
  const books = new Map<KalshiMarketTicker, LiveOrderbook>();
  const stream = createOrderbookStreamState();
  let subscribed = new Set<KalshiMarketTicker>();
  let orderbookSid: number | null = null;
  let attempt = 0;

  let creds = options.creds;
  if (!creds && !dryRun) {
    try {
      creds = loadKalshiCredentials();
    } catch (err) {
      // No credentials at all — classify and bail instead of throwing away the summary.
      summary.errors++;
      recordProbeErrorCode(summary, classifyProbeError(err));
      return summary;
    }
    // Pre-flight: a signed REST probe surfaces a bad key as E_AUTH now, instead
    // of WS retries that only report "Expected 101" (E_HANDSHAKE/E_NET).
    try {
      const probe = await probeKalshiAuth(creds);
      if (probe.status === 401 || probe.status === 403) {
        summary.errors++;
        recordProbeErrorCode(summary, "E_AUTH");
        return summary;
      }
    } catch (err) {
      // Probe itself failed (network/timeout) — record and still attempt WS;
      // the socket path classifies the real outcome.
      recordProbeErrorCode(summary, classifyProbeError(err));
    }
  }

  const shouldStop = () =>
    options.signal?.aborted === true ||
    (durationMs > 0 && Date.now() - started >= durationMs);

  const resolveTickers = (): KalshiMarketTicker[] => {
    const { tickers } = listRecordTickers(db, {
      leadMinutes: options.leadMinutes,
      limit: options.limit,
      clearStale: !dryRun,
    });
    return tickers;
  };

  while (!shouldStop()) {
    attempt++;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    let onAbort: (() => void) | null = null;
    // Deferred session promise — no executor indirection.
    // @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers
    const { promise: sessionPromise, resolve: sessionDone } = Promise.withResolvers<void>();

    const client = new KalshiMarketWs({
      creds,
      wsFactory: options.wsFactory,
      handlers: {
        onOpen: () => {
          attempt = 0;
          const tickers = resolveTickers();
          subscribed = new Set(tickers);
          summary.subscribed = tickers.length;
          if (tickers.length) client.subscribeOrderbook(tickers);
          refreshTimer = setInterval(() => {
            if (shouldStop()) {
              client.close();
              return;
            }
            const next = new Set(resolveTickers());
            const added = [...next].filter((t) => !subscribed.has(t));
            const removed = [...subscribed].filter((t) => !next.has(t));
            if (removed.length > 0) {
              subscribed = next;
              summary.subscribed = next.size;
              resetOrderbookStreamSeq(stream);
              orderbookSid = null;
              if (next.size) client.subscribeOrderbook([...next]);
            } else if (added.length > 0 && orderbookSid != null) {
              subscribed = next;
              summary.subscribed = next.size;
              client.addOrderbookMarkets(orderbookSid, added);
            }
          }, refreshMs);
        },
        onKalshiError: (err) => {
          const reconnect = applyKalshiWsWireError(summary, err);
          if (reconnect) client.close();
        },
        onMessage: (wire, recvTs) => {
          if (wire.type === "error") {
            if (!parseKalshiWsErrorWire(wire)) {
              summary.errors++;
              recordProbeErrorCode(summary, "E_PARSE");
            }
            return;
          }
          if (wire.type === "subscribed" && typeof wire.sid === "number") {
            orderbookSid = wire.sid;
            stream.sid = wire.sid;
            resetOrderbookStreamSeq(stream);
          }
          const result = handleOrderbookWire(dryRun ? null : db, books, wire, recvTs, {
            dryRun,
            onTick: options.onTick,
            stream,
          });
          if (result.kind === "snapshot") summary.snapshots++;
          if (result.kind === "delta") summary.deltas++;
          if (result.kind === "duplicate") summary.duplicates++;
          if (result.kind === "error") {
            summary.errors++;
            // Book/DB handling failure (missing event mapping, delta apply, insert).
            recordProbeErrorCode(summary, "E_DB");
          }
          if (result.kind === "gap") {
            summary.seqGaps++;
            const book = result.ticker ? books.get(result.ticker) : undefined;
            if (book) book.ready = false;
            resetOrderbookStreamSeq(stream);
            if (orderbookSid != null && result.ticker) {
              try {
                client.requestSnapshots(orderbookSid, [result.ticker]);
                summary.resyncRequests++;
              } catch (err) {
                summary.errors++;
                recordProbeErrorCode(summary, classifyProbeError(err));
              }
            }
          }
          if (
            (result.kind === "snapshot" || result.kind === "delta") &&
            !dryRun &&
            db
          ) {
            summary.ticksRecorded++;
          }
          if (shouldStop()) client.close();
        },
        onError: (err) => {
          summary.errors++;
          recordProbeErrorCode(summary, classifyProbeError(err));
        },
        onClose: (code, reason) => {
          // Handshake failures (e.g. HTTP 401 on upgrade → close 1002 "Expected 101")
          // carry the cause only in the close frame — classify without double-counting errors.
          if (code === 1002 || /Expected 101|handshake|401/i.test(reason)) {
            recordProbeErrorCode(summary, classifyProbeError(reason));
          }
          if (refreshTimer) clearInterval(refreshTimer);
          if (onAbort && options.signal) options.signal.removeEventListener("abort", onAbort);
          sessionDone?.();
        },
      },
    });

    onAbort = () => client.close();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    if (dryRun && !options.wsFactory) {
      // Dry-run without credentials/factory: report watch-set only.
      summary.subscribed = resolveTickers().length;
      break;
    }

    try {
      client.connect();
    } catch (err) {
      summary.errors++;
      recordProbeErrorCode(summary, classifyProbeError(err));
      await Bun.sleep(kalshiWsReconnectBackoffMs(attempt, reconnectBaseMs));
      continue;
    }

    await sessionPromise;
    if (shouldStop()) break;
    await Bun.sleep(kalshiWsReconnectBackoffMs(attempt, reconnectBaseMs));
  }

  if (!dryRun && summary.subscribed > 0) {
    await persistTennisWsRecorderSession(summary, {
      durationMs: Date.now() - started,
      subscribedTickers: summary.subscribed,
    });
  }

  return summary;
}
