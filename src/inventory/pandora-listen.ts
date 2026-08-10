/**
 * Pandora live listen plane: short probe, board scan, odds watch + summary.
 * Cohesion split from event-lookup / live-tracker (socket-open + book transitions).
 */
import { CoefficientStore } from '../partner/fantasy-ultra/coefficient-store.ts';
import {
  analyzeCoefficientBook,
  applyCoefficientDiff,
  decodeEventOfferability,
  diffEventDataOfferability,
  diffOfferFingerprints,
  findEventInEventDataBoard,
  isEventDataBoardPayload,
  parseEventDataDiffPath,
  parseLiveCountryNames,
  parseLiveLeagueNames,
  parseLiveSportsNames,
  parsePandoraBlocked,
  scanEventDataBoard,
  summarizeEventDataBoard,
  type CoefficientBookState,
  type CoefficientLine,
  type EventDataBoardScan,
  type EventDataBoardSummary,
  type EventDataStateTransition,
  type EventOfferability,
  type OfferTransition,
  type PandoraBlockedSets,
} from '../partner/fantasy-ultra/coefficients.ts';
import {
  pandoraMarketLabel,
  vigFromCoefficientLines,
  type MarketVigRow,
} from '../partner/fantasy-ultra/market-decode.ts';
import { PandoraSocket } from '../partner/fantasy-ultra/pandora-socket.ts';
import type { PandoraHostId } from '../partner/fantasy-ultra/pandora-hosts.ts';
import { resolvePandoraHostId } from '../partner/fantasy-ultra/pandora-hosts.ts';

export async function probePandoraEvent(
  eventId: number,
  options: {
    seconds?: number;
    WebSocketImpl?: typeof WebSocket;
    pandoraHost?: PandoraHostId | string;
  } = {}
): Promise<{
  subscribed: boolean;
  lines: CoefficientLine[];
  book: CoefficientBookState | null;
  eventState: EventOfferability | null;
  eventDataBoard: EventDataBoardSummary | null;
  blocked: PandoraBlockedSets | null;
}> {
  const seconds = Math.min(Math.max(options.seconds ?? 8, 2), 30);
  const store = new CoefficientStore();
  let subscribed = false;
  let lastPayload: unknown | null = null;
  let eventDataBoardPayload: unknown | null = null;
  let sportsPayload: unknown | null = null;
  let leaguesPayload: unknown | null = null;
  let countriesPayload: unknown | null = null;
  let blockedRaw: unknown | null = null;

  const host = resolvePandoraHostId(options.pandoraHost);

  await new Promise<void>(resolve => {
    const sock = new PandoraSocket({
      reconnect: false,
      host,
      WebSocketImpl: options.WebSocketImpl,
      handlers: {
        onNamespaceConnect: () => {
          // subscribeLive already includes bulk `${main}.eventData` + live.sports
          sock.subscribeLive({ eventIds: [eventId] });
        },
        onEvent: (name, args) => {
          if (name.includes(`eventCoefficients.${eventId}`)) subscribed = true;
          if (Array.isArray(args?.[0]) && String(args[0][0] ?? '').includes(String(eventId))) {
            subscribed = true;
          }
        },
        onCoefficients: info => {
          if (info.room === 'live.sports' && !info.envelope.isDiff) {
            sportsPayload = info.envelope.payload;
            return;
          }
          if (info.room === 'live.leagues' && !info.envelope.isDiff) {
            leaguesPayload = info.envelope.payload;
            return;
          }
          if (info.room === 'live.countries' && !info.envelope.isDiff) {
            countriesPayload = info.envelope.payload;
            return;
          }
          if (
            info.room.includes('groupProfile') &&
            !info.envelope.isDiff &&
            info.envelope.payload &&
            typeof info.envelope.payload === 'object'
          ) {
            const gp = info.envelope.payload as { blocked?: unknown };
            if (gp.blocked != null) blockedRaw = gp.blocked;
            return;
          }
          if (info.room.includes('eventData')) {
            const p = info.envelope.payload;
            if (!info.envelope.isDiff && isEventDataBoardPayload(p)) {
              eventDataBoardPayload = p;
            } else if (
              info.envelope.isDiff &&
              eventDataBoardPayload &&
              typeof eventDataBoardPayload === 'object' &&
              Array.isArray(p)
            ) {
              eventDataBoardPayload = applyCoefficientDiff(
                eventDataBoardPayload as Record<string, unknown>,
                p
              );
            }
            return;
          }
          if (info.eventId === eventId || info.room.includes(String(eventId))) {
            if (info.room.includes('eventCoefficients')) subscribed = true;
            store.ingest(info);
            if (
              info.room.includes('eventCoefficients') &&
              !info.envelope.isDiff &&
              info.envelope.payload
            ) {
              lastPayload = info.envelope.payload;
            }
          }
        },
      },
    });
    sock.connect();
    setTimeout(() => {
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      resolve();
    }, seconds * 1000);
  });

  const lines = store.getLines(eventId);
  const book = lastPayload
    ? analyzeCoefficientBook(eventId, lastPayload)
    : lines.length
      ? analyzeCoefficientBook(eventId, {
          id: eventId,
          c: rebuildCFromLines(lines),
        })
      : null;

  const sportsNames = parseLiveSportsNames(sportsPayload);
  const leagueNames = parseLiveLeagueNames(leaguesPayload);
  const countryNames = parseLiveCountryNames(countriesPayload);
  const blocked = blockedRaw ? parsePandoraBlocked(blockedRaw) : null;
  const boardHit = eventDataBoardPayload
    ? findEventInEventDataBoard(eventDataBoardPayload, eventId)
    : null;
  const eventState = boardHit
    ? decodeEventOfferability(boardHit, {
        coeffLineCount: lines.length,
        sportsNames,
        leagueNames,
        countryNames,
        blocked,
        board: eventDataBoardPayload,
      })
    : null;
  const eventDataBoard = eventDataBoardPayload
    ? summarizeEventDataBoard(eventDataBoardPayload)
    : null;

  return {
    subscribed,
    lines,
    book,
    eventState,
    eventDataBoard,
    blocked,
  };
}

/**
 * Capture full eventData board + live.sports names + groupProfile.blocked.
 * Used by `domain:event --board`.
 */
export async function scanPandoraEventBoard(
  options: {
    seconds?: number;
    WebSocketImpl?: typeof WebSocket;
    pandoraHost?: PandoraHostId | string;
  } = {}
): Promise<{
  scan: EventDataBoardScan | null;
  sportsNames: Map<string, string>;
  blocked: PandoraBlockedSets | null;
  seconds: number;
  host: PandoraHostId;
}> {
  const seconds = Math.min(Math.max(options.seconds ?? 10, 3), 45);
  const host = resolvePandoraHostId(options.pandoraHost);
  let boardPayload: unknown | null = null;
  let sportsPayload: unknown | null = null;
  let leaguesPayload: unknown | null = null;
  let countriesPayload: unknown | null = null;
  let blockedRaw: unknown | null = null;

  await new Promise<void>(resolve => {
    const sock = new PandoraSocket({
      reconnect: false,
      host,
      WebSocketImpl: options.WebSocketImpl,
      handlers: {
        onNamespaceConnect: () => {
          sock.subscribeLive({});
        },
        onCoefficients: info => {
          if (info.room === 'live.sports' && !info.envelope.isDiff) {
            sportsPayload = info.envelope.payload;
            return;
          }
          if (info.room === 'live.leagues' && !info.envelope.isDiff) {
            leaguesPayload = info.envelope.payload;
            return;
          }
          if (info.room === 'live.countries' && !info.envelope.isDiff) {
            countriesPayload = info.envelope.payload;
            return;
          }
          if (
            info.room.includes('groupProfile') &&
            !info.envelope.isDiff &&
            info.envelope.payload &&
            typeof info.envelope.payload === 'object'
          ) {
            const gp = info.envelope.payload as { blocked?: unknown };
            if (gp.blocked != null) blockedRaw = gp.blocked;
            return;
          }
          if (!info.room.includes('eventData')) return;
          if (info.room.includes('eventCoefficients')) return;
          const p = info.envelope.payload;
          if (!info.envelope.isDiff && isEventDataBoardPayload(p)) {
            boardPayload = p;
          } else if (
            info.envelope.isDiff &&
            boardPayload &&
            typeof boardPayload === 'object' &&
            Array.isArray(p)
          ) {
            boardPayload = applyCoefficientDiff(
              boardPayload as Record<string, unknown>,
              p
            );
          }
        },
      },
    });
    sock.connect();
    setTimeout(() => {
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      resolve();
    }, seconds * 1000);
  });

  const sportsNames = parseLiveSportsNames(sportsPayload);
  const leagueNames = parseLiveLeagueNames(leaguesPayload);
  const countryNames = parseLiveCountryNames(countriesPayload);
  const blocked = blockedRaw ? parsePandoraBlocked(blockedRaw) : null;
  const scan = boardPayload
    ? scanEventDataBoard(boardPayload, {
        sportsNames,
        leagueNames,
        countryNames,
        blocked,
      })
    : null;

  return { scan, sportsNames, blocked, seconds, host };
}

function rebuildCFromLines(
  lines: CoefficientLine[]
): Record<string, Record<string, { o: Record<string, number | number[]> }>> {
  const c: Record<
    string,
    Record<string, { o: Record<string, number | number[]> }>
  > = {};
  for (const l of lines) {
    const period = c[l.period] ?? (c[l.period] = {});
    const mkt = period[l.marketType] ?? (period[l.marketType] = { o: {} });
    if (l.sideIndex != null) {
      const arr = (mkt.o[l.selection] as number[] | undefined) ?? [];
      arr[l.sideIndex] = l.decimal;
      mkt.o[l.selection] = arr;
    } else {
      mkt.o[l.selection] = l.decimal;
    }
  }
  return c;
}

/** Public watch tick — live-tracker + odds-watch tests import this shape. */
export type OddsWatchUpdate = {
  at: string;
  eventId: number;
  lineCount: number;
  offeredMarketCount: number;
  transitions: OfferTransition[];
  book: CoefficientBookState | null;
  eventState: EventOfferability | null;
  eventTransitions: EventDataStateTransition[];
};

/** One market suspend interval (off → on). */
type SuspensionInterval = {
  period: string;
  marketType: string;
  offAt: string;
  onAt: string | null;
  durationMs: number | null;
};

export type OddsWatchSummary = {
  eventId: number;
  updates: number;
  transitionCounts: Record<string, number>;
  suspensions: SuspensionInterval[];
  openSuspensions: number;
  suspensionCount: number;
  /** Closed suspension durations only. */
  medianSuspensionMs: number | null;
  meanSuspensionMs: number | null;
  byMarketTransitions: Array<{
    period: string;
    marketType: string;
    off: number;
    on: number;
    priceChanges: number;
  }>;
  /** Vig snapshot from last book with lines. */
  vig: MarketVigRow[];
  lastLineCount: number;
  lastOfferedMarkets: number;
};

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0
    ? (s[mid - 1]! + s[mid]!) / 2
    : s[mid]!;
}

/**
 * Aggregate watch history: suspension intervals (market_off → market_on)
 * and per-market transition counts.
 */
export function summarizeOddsWatch(
  history: OddsWatchUpdate[],
  options: { lastLines?: CoefficientLine[] } = {}
): OddsWatchSummary {
  const eventId = history[0]?.eventId ?? 0;
  const transitionCounts: Record<string, number> = {};
  const byMk = new Map<
    string,
    { period: string; marketType: string; off: number; on: number; priceChanges: number }
  >();
  const open = new Map<string, string>(); // key → offAt ISO
  const suspensions: SuspensionInterval[] = [];

  const bumpMk = (
    period: string,
    marketType: string,
    field: 'off' | 'on' | 'priceChanges'
  ) => {
    const k = `${period}\0${marketType}`;
    const mutable = byMk.get(k) ?? {
      period,
      marketType,
      off: 0,
      on: 0,
      priceChanges: 0,
    };
    mutable[field]++;
    byMk.set(k, mutable);
  };

  for (const u of history) {
    for (const t of u.transitions) {
      transitionCounts[t.kind] = (transitionCounts[t.kind] ?? 0) + 1;
      if (t.kind === 'market_off') {
        bumpMk(t.period, t.marketType, 'off');
        const k = `${t.period}\0${t.marketType}`;
        if (!open.has(k)) open.set(k, u.at);
      } else if (t.kind === 'market_on') {
        bumpMk(t.period, t.marketType, 'on');
        const k = `${t.period}\0${t.marketType}`;
        const offAt = open.get(k);
        if (offAt) {
          const durationMs = Math.max(
            0,
            Date.parse(u.at) - Date.parse(offAt)
          );
          suspensions.push({
            period: t.period,
            marketType: t.marketType,
            offAt,
            onAt: u.at,
            durationMs: Number.isFinite(durationMs) ? durationMs : null,
          });
          open.delete(k);
        }
      } else if (t.kind === 'price_change') {
        bumpMk(t.period, t.marketType, 'priceChanges');
      } else if (t.kind === 'selection_off') {
        bumpMk(t.period, t.marketType, 'off');
      } else if (t.kind === 'selection_on') {
        bumpMk(t.period, t.marketType, 'on');
      }
    }
  }

  // still open at end of watch
  for (const [k, offAt] of open) {
    const [period, marketType] = k.split('\0') as [string, string];
    suspensions.push({
      period,
      marketType,
      offAt,
      onAt: null,
      durationMs: null,
    });
  }

  const closedMs = suspensions
    .map(s => s.durationMs)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const last = history[history.length - 1];
  const vigLines = options.lastLines ?? [];

  return {
    eventId,
    updates: history.length,
    transitionCounts,
    suspensions,
    openSuspensions: [...open.keys()].length,
    suspensionCount: suspensions.filter(s => s.onAt != null).length,
    medianSuspensionMs: median(closedMs),
    meanSuspensionMs: closedMs.length
      ? closedMs.reduce((a, b) => a + b, 0) / closedMs.length
      : null,
    byMarketTransitions: [...byMk.values()].sort(
      (a, b) => b.off + b.on + b.priceChanges - (a.off + a.on + a.priceChanges)
    ),
    vig: vigLines.length ? vigFromCoefficientLines(vigLines) : [],
    lastLineCount: last?.lineCount ?? 0,
    lastOfferedMarkets: last?.offeredMarketCount ?? 0,
  };
}

export async function watchEventOdds(
  eventId: number,
  options: {
    seconds?: number;
    WebSocketImpl?: typeof WebSocket;
    pandoraHost?: PandoraHostId | string;
    onUpdate?: (u: OddsWatchUpdate) => void;
  } = {}
): Promise<OddsWatchUpdate[] & { lastLines: CoefficientLine[] }> {
  const seconds = Math.min(Math.max(options.seconds ?? 30, 5), 300);
  const host = resolvePandoraHostId(options.pandoraHost);
  const store = new CoefficientStore();
  const history: OddsWatchUpdate[] = [];
  let prevLines: CoefficientLine[] = [];
  let lastPayload: unknown | null = null;
  let boardPayload: Record<string, unknown> | null = null;
  let prevEventState: EventOfferability | null = null;

  const emitUpdate = (
    transitions: OfferTransition[],
    eventTransitions: EventDataStateTransition[],
    force = false
  ) => {
    const lines = store.getLines(eventId);
    const book = lastPayload
      ? analyzeCoefficientBook(eventId, lastPayload)
      : lines.length
        ? analyzeCoefficientBook(eventId, {
            id: eventId,
            c: rebuildCFromLines(lines),
          })
        : null;
    const hit = boardPayload
      ? findEventInEventDataBoard(boardPayload, eventId)
      : null;
    const eventState = hit
      ? decodeEventOfferability(hit, { coeffLineCount: lines.length })
      : null;
    const et =
      eventTransitions.length > 0
        ? eventTransitions
        : diffEventDataOfferability(prevEventState, eventState);

    if (
      !force &&
      transitions.length === 0 &&
      et.length === 0 &&
      prevLines.length > 0
    ) {
      prevEventState = eventState;
      return;
    }

    const u: OddsWatchUpdate = {
      at: new Date().toISOString(),
      eventId,
      lineCount: lines.length,
      offeredMarketCount: book?.offeredMarketCount ?? 0,
      transitions,
      book,
      eventState,
      eventTransitions: et,
    };
    history.push(u);
    options.onUpdate?.(u);
    prevLines = lines;
    prevEventState = eventState;
  };

  await new Promise<void>(resolve => {
    const sock = new PandoraSocket({
      reconnect: false,
      host,
      WebSocketImpl: options.WebSocketImpl,
      handlers: {
        onNamespaceConnect: () => {
          sock.subscribeLive({ eventIds: [eventId] });
        },
        onCoefficients: info => {
          if (info.room.includes('eventData')) {
            const p = info.envelope.payload;
            if (!info.envelope.isDiff && isEventDataBoardPayload(p)) {
              boardPayload = p as Record<string, unknown>;
              emitUpdate([], [], prevLines.length === 0);
            } else if (
              info.envelope.isDiff &&
              boardPayload &&
              Array.isArray(p)
            ) {
              const relevant = (p as Array<{ path?: string; op?: string; value?: unknown }>).filter(
                op => {
                  if (!op?.path) return false;
                  const parsed = parseEventDataDiffPath(op.path);
                  return parsed.eventId === eventId;
                }
              );
              boardPayload = applyCoefficientDiff(boardPayload, p);
              if (relevant.length > 0 || prevLines.length === 0) {
                const eventTransitions: EventDataStateTransition[] = [];
                for (const op of relevant) {
                  const parsed = parseEventDataDiffPath(op.path!);
                  if (parsed.field === 'l' && typeof op.value === 'boolean') {
                    eventTransitions.push({
                      kind: 'lines_flag',
                      eventId,
                      hasLines: op.value,
                    });
                  } else if (parsed.field === 's' || parsed.field === 'ip' || parsed.field === 'il') {
                    eventTransitions.push({
                      kind: 'state_change',
                      eventId,
                      field: parsed.field,
                      to: op.value,
                    });
                  } else if (op.op === 'remove' && parsed.field === '_node') {
                    eventTransitions.push({ kind: 'event_removed', eventId });
                  }
                }
                emitUpdate([], eventTransitions);
              }
            }
            return;
          }
          if (info.eventId !== eventId && !info.room.includes(String(eventId))) {
            return;
          }
          if (!info.room.includes('eventCoefficients')) return;
          store.ingest(info);
          if (!info.envelope.isDiff && info.envelope.payload) {
            lastPayload = info.envelope.payload;
          }
          const lines = store.getLines(eventId);
          const transitions = diffOfferFingerprints(prevLines, lines);
          emitUpdate(transitions, [], prevLines.length === 0);
        },
      },
    });
    sock.connect();
    setTimeout(() => {
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      resolve();
    }, seconds * 1000);
  });

  const out = history as OddsWatchUpdate[] & { lastLines: CoefficientLine[] };
  out.lastLines = store.getLines(eventId);
  return out;
}


