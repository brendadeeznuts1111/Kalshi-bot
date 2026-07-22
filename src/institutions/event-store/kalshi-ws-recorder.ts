// @see https://docs.kalshi.com/websockets/orderbook-updates
// @see https://bun.com/docs/runtime/sqlite
/**
 * Watch-set Kalshi orderbook WebSocket → book_ticks (dual-clock).
 * ts = exchange ts_ms when present (source_clock=exchange); else recv (source_clock=recv).
 * Always stores recv_ts at message receipt.
 */
import type { Database } from "bun:sqlite";
import { KalshiMarketWs, type KalshiWsFactory, type KalshiWsWire } from "../../bot/kalshi-ws.ts";
import { loadKalshiCredentials, type KalshiCredentials } from "../../bot/kalshi-auth.ts";
import { marketKindFromTicker } from "./tennis-ladder.ts";
import type { CanonicalEventId } from "./types.ts";
import {
  applyOrderbookDelta,
  applyOrderbookSnapshot,
  createEmptyLiveOrderbook,
  liveOrderbookToSnapshot,
  type LiveOrderbook,
} from "./orderbook-live.ts";
import { listRecordTickers } from "./watch-set.ts";

import { OFFICIAL_URLS } from "../official-urls.ts";

const SOURCE = "kalshi-ws";
const SOURCE_URL = OFFICIAL_URLS.kalshi.tradeApiWsV2;

export type WsRecorderSummary = {
  ticksRecorded: number;
  snapshots: number;
  deltas: number;
  seqGaps: number;
  errors: number;
  subscribed: number;
};

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
  onTick?: (info: { ticker: string; seq: number; sourceClock: string }) => void;
  wsFactory?: KalshiWsFactory;
};

function eventIdForTicker(db: Database, ticker: string): CanonicalEventId | null {
  const mapped = db
    .query(`SELECT event_id AS eventId FROM markets WHERE ticker = $ticker`)
    .get({ $ticker: ticker }) as { eventId: string } | null;
  if (!mapped?.eventId) return null;
  return mapped.eventId as CanonicalEventId;
}

function insertBookTick(
  db: Database,
  args: {
    eventId: CanonicalEventId;
    ticker: string;
    seq: number;
    ts: number;
    recvTs: number;
    sourceClock: "exchange" | "recv";
    levelsJson: string;
  },
): void {
  db.query(
    `INSERT INTO book_ticks (
       event_id, ticker, market_kind, ts, seq, levels_json, source, source_url, recv_ts, source_clock
     ) VALUES (
       $event_id, $ticker, $market_kind, $ts, $seq, $levels_json, $source, $source_url, $recv_ts, $source_clock
     )`,
  ).run({
    $event_id: args.eventId,
    $ticker: args.ticker,
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
 * Process one WS wire frame into live books / optional DB write.
 * Pure enough for unit tests via injected books map.
 */
export function handleOrderbookWire(
  db: Database | null,
  books: Map<string, LiveOrderbook>,
  wire: KalshiWsWire,
  recvTs: number,
  options: { dryRun?: boolean; onTick?: WsRecorderOptions["onTick"] } = {},
): {
  kind: "snapshot" | "delta" | "gap" | "ignore" | "error";
  ticker?: string;
} {
  const type = wire.type;
  const seq = typeof wire.seq === "number" ? wire.seq : null;
  const msg = asMsg(wire);
  if (!msg || seq == null) return { kind: "ignore" };
  const ticker = typeof msg.market_ticker === "string" ? msg.market_ticker : "";
  if (!ticker) return { kind: "ignore" };

  let book = books.get(ticker);
  if (!book) {
    book = createEmptyLiveOrderbook(ticker);
    books.set(ticker, book);
  }

  if (type === "orderbook_snapshot") {
    applyOrderbookSnapshot(
      book,
      {
        market_ticker: ticker,
        yes_dollars_fp: msg.yes_dollars_fp,
        no_dollars_fp: msg.no_dollars_fp,
      },
      seq,
    );
    const snap = liveOrderbookToSnapshot(book, recvTs);
    if (snap && db && !options.dryRun) {
      const eventId = eventIdForTicker(db, ticker);
      if (!eventId) return { kind: "error", ticker };
      insertBookTick(db, {
        eventId,
        ticker,
        seq,
        ts: recvTs,
        recvTs,
        sourceClock: "recv",
        levelsJson: JSON.stringify(snap),
      });
    }
    options.onTick?.({ ticker, seq, sourceClock: "recv" });
    return { kind: "snapshot", ticker };
  }

  if (type === "orderbook_delta") {
    const ok = applyOrderbookDelta(
      book,
      {
        market_ticker: ticker,
        price_dollars: String(msg.price_dollars ?? ""),
        delta_fp: String(msg.delta_fp ?? ""),
        side: String(msg.side ?? ""),
      },
      seq,
    );
    if (!ok) return { kind: "gap", ticker };
    const exchangeTs = typeof msg.ts_ms === "number" && Number.isFinite(msg.ts_ms) ? msg.ts_ms : null;
    const ts = exchangeTs ?? recvTs;
    const sourceClock = exchangeTs != null ? "exchange" : "recv";
    const snap = liveOrderbookToSnapshot(book, ts);
    if (snap && db && !options.dryRun) {
      const eventId = eventIdForTicker(db, ticker);
      if (!eventId) return { kind: "error", ticker };
      insertBookTick(db, {
        eventId,
        ticker,
        seq,
        ts,
        recvTs,
        sourceClock,
        levelsJson: JSON.stringify(snap),
      });
    }
    options.onTick?.({ ticker, seq, sourceClock });
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
    errors: 0,
    subscribed: 0,
  };
  const dryRun = options.dryRun === true;
  const refreshMs = options.refreshMs ?? 30_000;
  const reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
  const durationMs = options.durationMs ?? 0;
  const started = Date.now();
  const books = new Map<string, LiveOrderbook>();
  let subscribed = new Set<string>();
  let orderbookSid: number | null = null;
  let attempt = 0;

  const creds = options.creds ?? (dryRun ? undefined : loadKalshiCredentials());

  const shouldStop = () =>
    options.signal?.aborted === true ||
    (durationMs > 0 && Date.now() - started >= durationMs);

  const resolveTickers = (): string[] => {
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
    let sessionDone: (() => void) | null = null;
    const sessionPromise = new Promise<void>((resolve) => {
      sessionDone = resolve;
    });

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
            // Resubscribe when membership grows — simple full resubscribe.
            if (added.length > 0 || next.size !== subscribed.size) {
              subscribed = next;
              summary.subscribed = next.size;
              if (next.size) client.subscribeOrderbook([...next]);
            }
          }, refreshMs);
        },
        onMessage: (wire, recvTs) => {
          if (typeof wire.sid === "number" && wire.type === "subscribed") {
            orderbookSid = wire.sid;
          }
          const before = summary.ticksRecorded;
          const result = handleOrderbookWire(dryRun ? null : db, books, wire, recvTs, {
            dryRun,
            onTick: options.onTick,
          });
          if (result.kind === "snapshot") summary.snapshots++;
          if (result.kind === "delta") summary.deltas++;
          if (result.kind === "error") summary.errors++;
          if (result.kind === "gap") {
            summary.seqGaps++;
            if (orderbookSid != null && result.ticker) {
              try {
                client.requestSnapshots(orderbookSid, [result.ticker]);
              } catch {
                summary.errors++;
              }
            }
          }
          if (!dryRun && summary.ticksRecorded === before) {
            // count inserts via onTick path: recount when not dry-run by kind
          }
          if ((result.kind === "snapshot" || result.kind === "delta") && !dryRun) {
            summary.ticksRecorded++;
          }
          if (shouldStop()) client.close();
        },
        onError: () => {
          summary.errors++;
        },
        onClose: () => {
          if (refreshTimer) clearInterval(refreshTimer);
          sessionDone?.();
        },
      },
    });

    if (dryRun && !options.wsFactory) {
      // Dry-run without credentials/factory: report watch-set only.
      summary.subscribed = resolveTickers().length;
      break;
    }

    try {
      client.connect();
    } catch {
      summary.errors++;
      const backoff = Math.min(30_000, reconnectBaseMs * 2 ** Math.min(attempt, 5));
      await Bun.sleep(backoff);
      continue;
    }

    await sessionPromise;
    if (shouldStop()) break;
    const backoff = Math.min(30_000, reconnectBaseMs * 2 ** Math.min(attempt, 5));
    await Bun.sleep(backoff);
  }

  return summary;
}
