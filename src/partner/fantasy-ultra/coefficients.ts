/**
 * Decode Pandora Socket.IO binary attachments (`451-` + gzip/base64 body)
 * into priced coefficient lines (decimal + American).
 *
 * Captured via `bun run partner:webview-ws-capture` (Chrome CDP).
 *
 * Snapshot shape:
 *   { isDiff: false, payload: { id, m, c: { m: { "3": { o: { "1": d, "2": d } } } } }, ti }
 * Diff shape:
 *   { isDiff: true, payload: [{ op, path, value }], ti }
 *
 * Market object also carries `cls` (limit/price-class map, NOT suspend):
 *   cls[lineId] || cls._d  — used by UI for limit group lookup (mainapp.js).
 *
 * Event-level offerability (from widget EVENT_STATES constant):
 *   bettable=0, blocked=1, notBettable=2, finished=3
 *   hasOdds ⇔ oddsCount > 0; OTB ≈ finished | notBettable | blocked | !hasOdds
 *
 * Board room `live.main.{token}.eventData` (mainapp `receiveEvents`):
 *   { s, db, kb, x, c?, m?, f?, ec? }
 *   s[sportId][countryId][leagueId][eventId] = [team1, team2, start, …, dynamic]
 *   dynamic (last element, mainapp `p.pop()`):
 *     s=EVENT_STATES, ip=isStarted, il=isLive, l=hasLines, n=shard, oc=oddsCount, ht, c
 *   db: donbestRotation → eventId; kb: opaque reverse index; x: per-shard betOffline flags
 * Diff path example: `/s/8/340/14358/197502861/12/l` (index 12 = dynamic object)
 *
 * @see https://bun.com/docs/runtime/utils#bun-gunzipsync
 */
import { gunzipSync } from 'bun';
import { normalizeOdds } from '../odds-format.ts';

/** Widget `EVENT_STATES` (gsLive constant) — event.dynamicData.state. */
export const PANDORA_EVENT_STATES = {
  bettable: 0,
  blocked: 1,
  notBettable: 2,
  finished: 3,
} as const;

export type PandoraEventStateCode =
  (typeof PANDORA_EVENT_STATES)[keyof typeof PANDORA_EVENT_STATES];

export function describePandoraEventState(state: number): string {
  switch (state) {
    case PANDORA_EVENT_STATES.bettable:
      return 'bettable';
    case PANDORA_EVENT_STATES.blocked:
      return 'blocked';
    case PANDORA_EVENT_STATES.notBettable:
      return 'notBettable';
    case PANDORA_EVENT_STATES.finished:
      return 'finished';
    default:
      return `unknown(${state})`;
  }
}

/**
 * UI “off the board” heuristic from mainapp isOTB / showPeriods gates:
 * finished || notBettable || blocked || !hasOdds.
 *
 * When `hasLines` is provided (eventData dynamic `l`), treat it as the
 * board-level hasOdds proxy if oddsCount is absent.
 */
export function isEventOffTheBoard(input: {
  state?: number | null;
  oddsCount?: number | null;
  /** eventData dynamic `l` — board says lines present. */
  hasLines?: boolean | null;
}): boolean {
  const state = input.state;
  const odds =
    input.oddsCount != null
      ? input.oddsCount
      : input.hasLines === true
        ? 1
        : input.hasLines === false
          ? 0
          : 0;
  if (odds <= 0) return true;
  if (state == null) return odds <= 0;
  return (
    state === PANDORA_EVENT_STATES.finished ||
    state === PANDORA_EVENT_STATES.notBettable ||
    state === PANDORA_EVENT_STATES.blocked
  );
}

// ── eventData board (live.main.*.eventData) ──────────────────────────────

/** Wire dynamic object at end of event array (mainapp pops this). */
export type EventDataWireDynamic = {
  /** EVENT_STATES 0–3 */
  s?: number;
  /** isStarted */
  ip?: boolean;
  /** isLive */
  il?: boolean;
  /** has lines on board */
  l?: boolean;
  /** shard / namespace id */
  n?: number;
  /** oddsCount when present */
  oc?: number;
  /** isHalftime */
  ht?: boolean;
  /** embedded coefficients (rare on board; usually separate room) */
  c?: unknown;
  /** live hazard / velocity (mainapp lht gate) */
  v?: { value?: number } | unknown;
};

export type EventDataBoardHit = {
  eventId: number;
  /** Path under s: [sportId, countryId, leagueId, eventId] */
  path: string[];
  sportId: string | null;
  countryId: string | null;
  leagueId: string | null;
  home: string | null;
  away: string | null;
  startTimeSec: number | null;
  /** Raw dynamic wire object (index 12 / popped last element). */
  dynamic: EventDataWireDynamic | null;
  /** Full 13-slot array when present. */
  raw: unknown[] | null;
};

/** Decoded event offerability from board dynamic + optional coeff lineCount. */
export type EventOfferability = {
  eventId: number;
  state: number | null;
  stateLabel: string;
  isStarted: boolean | null;
  isLive: boolean | null;
  isHalftime: boolean | null;
  hasLines: boolean | null;
  shard: number | null;
  /** From wire `oc`, else null (use coeff book lineCount as fallback). */
  oddsCount: number | null;
  offTheBoard: boolean;
  sportId: string | null;
  countryId: string | null;
  leagueId: string | null;
  home: string | null;
  away: string | null;
  startTimeSec: number | null;
  path: string[];
};

export type EventDataBoardSummary = {
  sportCount: number;
  eventCount: number;
  dbCount: number;
  kbCount: number;
  /** betOffline flags length (mainapp handleBetOfflineUpdate). */
  offlineFlags: boolean[] | null;
  sports: string[];
};

/** True when payload looks like the bulk eventData board (`s` + `db`/`kb`/`x`). */
export function isEventDataBoardPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const o = payload as Record<string, unknown>;
  return o.s != null && typeof o.s === 'object' && !Array.isArray(o.s);
}

export function summarizeEventDataBoard(
  payload: unknown
): EventDataBoardSummary | null {
  if (!isEventDataBoardPayload(payload)) return null;
  const o = payload as Record<string, unknown>;
  const s = o.s as Record<string, unknown>;
  const sports = Object.keys(s);
  let eventCount = 0;
  for (const sport of Object.values(s)) {
    if (!sport || typeof sport !== 'object') continue;
    for (const country of Object.values(sport as object)) {
      if (!country || typeof country !== 'object') continue;
      for (const league of Object.values(country as object)) {
        if (!league || typeof league !== 'object') continue;
        eventCount += Object.keys(league as object).length;
      }
    }
  }
  const offlineFlags = Array.isArray(o.x)
    ? (o.x as unknown[]).map(v => Boolean(v))
    : null;
  return {
    sportCount: sports.length,
    eventCount,
    dbCount:
      o.db && typeof o.db === 'object' ? Object.keys(o.db as object).length : 0,
    kbCount:
      o.kb && typeof o.kb === 'object' ? Object.keys(o.kb as object).length : 0,
    offlineFlags,
    sports: sports.sort((a, b) => Number(a) - Number(b)),
  };
}

function teamNameFromSlot(slot: unknown): string | null {
  if (typeof slot === 'string' && slot.trim()) return slot.trim();
  if (Array.isArray(slot) && slot[0] != null && String(slot[0]).trim()) {
    return String(slot[0]).trim();
  }
  return null;
}

function asWireDynamic(raw: unknown): EventDataWireDynamic | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as EventDataWireDynamic;
}

/**
 * Locate an event under board `s[sport][country][league][eventId]`.
 * Returns teams + dynamic state when found.
 */
export function findEventInEventDataBoard(
  payload: unknown,
  eventId: number | string
): EventDataBoardHit | null {
  if (!isEventDataBoardPayload(payload)) return null;
  const id = String(eventId);
  const s = (payload as { s: Record<string, unknown> }).s;

  for (const [sportId, countries] of Object.entries(s)) {
    if (!countries || typeof countries !== 'object') continue;
    for (const [countryId, leagues] of Object.entries(
      countries as Record<string, unknown>
    )) {
      if (!leagues || typeof leagues !== 'object') continue;
      for (const [leagueId, events] of Object.entries(
        leagues as Record<string, unknown>
      )) {
        if (!events || typeof events !== 'object') continue;
        const node = (events as Record<string, unknown>)[id];
        if (node === undefined) continue;

        let dynamic: EventDataWireDynamic | null = null;
        let raw: unknown[] | null = null;
        let home: string | null = null;
        let away: string | null = null;
        let startTimeSec: number | null = null;

        if (Array.isArray(node)) {
          raw = node;
          home = teamNameFromSlot(node[0]);
          away = teamNameFromSlot(node[1]);
          const st = Number(node[2]);
          startTimeSec = Number.isFinite(st) ? st : null;
          // mainapp: g = p.pop() when no separate c map — last element is dynamic
          dynamic = asWireDynamic(node[node.length - 1]);
          // index 12 is the stable slot when array is full length 13
          if (!dynamic && node.length > 12) {
            dynamic = asWireDynamic(node[12]);
          }
        } else if (node && typeof node === 'object') {
          dynamic = asWireDynamic(node);
        }

        return {
          eventId: Number(id),
          path: [sportId, countryId, leagueId, id],
          sportId,
          countryId,
          leagueId,
          home,
          away,
          startTimeSec,
          dynamic,
          raw,
        };
      }
    }
  }
  return null;
}

/**
 * Decode board hit (+ optional coefficient lineCount) into offerability.
 * Mirrors mainapp isOTB / isFinished / hasOdds / isBlocked gates.
 */
export function decodeEventOfferability(
  hit: EventDataBoardHit,
  options: { coeffLineCount?: number | null } = {}
): EventOfferability {
  const d = hit.dynamic;
  const state =
    d && typeof d.s === 'number' && Number.isFinite(d.s) ? d.s : null;
  const hasLines = d && typeof d.l === 'boolean' ? d.l : null;
  const oddsCount =
    d && typeof d.oc === 'number' && Number.isFinite(d.oc)
      ? d.oc
      : options.coeffLineCount != null
        ? options.coeffLineCount
        : null;

  // hasOdds proxy: explicit oc → coeff lines → board `l`
  const hasOddsCount =
    oddsCount != null
      ? oddsCount
      : hasLines === true
        ? 1
        : hasLines === false
          ? 0
          : options.coeffLineCount ?? 0;

  return {
    eventId: hit.eventId,
    state,
    stateLabel:
      state != null ? describePandoraEventState(state) : 'unknown',
    isStarted: d && typeof d.ip === 'boolean' ? d.ip : null,
    isLive: d && typeof d.il === 'boolean' ? d.il : null,
    isHalftime: d && typeof d.ht === 'boolean' ? d.ht : null,
    hasLines,
    shard: d && typeof d.n === 'number' ? d.n : null,
    oddsCount: d && typeof d.oc === 'number' ? d.oc : null,
    offTheBoard: isEventOffTheBoard({
      state,
      oddsCount: hasOddsCount,
      hasLines,
    }),
    sportId: hit.sportId,
    countryId: hit.countryId,
    leagueId: hit.leagueId,
    home: hit.home,
    away: hit.away,
    startTimeSec: hit.startTimeSec,
    path: hit.path,
  };
}

/**
 * Parse JSON-patch path from eventData diffs:
 *   /s/{sport}/{country}/{league}/{eventId}/12/{field}
 *   /s/{sport}/{country}/{league}/{eventId}  (whole node)
 */
export function parseEventDataDiffPath(path: string): {
  eventId: number | null;
  field: string | null;
  pathParts: string[];
} {
  const parts = path.split('/').filter(Boolean);
  // s sport country league eventId [12 field]
  if (parts[0] !== 's' || parts.length < 5) {
    return { eventId: null, field: null, pathParts: parts };
  }
  const eventIdRaw = parts[4]!;
  const eventId = Number(eventIdRaw);
  if (!Number.isFinite(eventId)) {
    return { eventId: null, field: null, pathParts: parts };
  }
  // /s/.../eventId/12/l
  if (parts.length >= 7 && parts[5] === '12') {
    return { eventId, field: parts[6] ?? null, pathParts: parts };
  }
  // /s/.../eventId/12 (replace whole dynamic)
  if (parts.length === 6 && parts[5] === '12') {
    return { eventId, field: '_dynamic', pathParts: parts };
  }
  // whole event node
  if (parts.length === 5) {
    return { eventId, field: '_node', pathParts: parts };
  }
  return { eventId, field: parts[parts.length - 1] ?? null, pathParts: parts };
}

export type EventDataStateTransition =
  | {
      kind: 'state_change';
      eventId: number;
      field: string;
      from?: unknown;
      to: unknown;
    }
  | {
      kind: 'lines_flag';
      eventId: number;
      hasLines: boolean;
    }
  | {
      kind: 'event_removed';
      eventId: number;
    };

/** Diff board dynamic fields relevant to odds-off (s, l, ip, il, oc). */
export function diffEventDataOfferability(
  prev: EventOfferability | null,
  next: EventOfferability | null
): EventDataStateTransition[] {
  const out: EventDataStateTransition[] = [];
  if (!prev && next) {
    if (next.state != null) {
      out.push({
        kind: 'state_change',
        eventId: next.eventId,
        field: 's',
        to: next.state,
      });
    }
    if (next.hasLines != null) {
      out.push({
        kind: 'lines_flag',
        eventId: next.eventId,
        hasLines: next.hasLines,
      });
    }
    return out;
  }
  if (prev && !next) {
    out.push({ kind: 'event_removed', eventId: prev.eventId });
    return out;
  }
  if (!prev || !next) return out;

  if (prev.state !== next.state && next.state != null) {
    out.push({
      kind: 'state_change',
      eventId: next.eventId,
      field: 's',
      from: prev.state,
      to: next.state,
    });
  }
  if (prev.hasLines !== next.hasLines && next.hasLines != null) {
    out.push({
      kind: 'lines_flag',
      eventId: next.eventId,
      hasLines: next.hasLines,
    });
  }
  for (const field of ['isStarted', 'isLive', 'isHalftime'] as const) {
    if (prev[field] !== next[field] && next[field] != null) {
      out.push({
        kind: 'state_change',
        eventId: next.eventId,
        field,
        from: prev[field],
        to: next[field],
      });
    }
  }
  return out;
}

export type PandoraTi = {
  h: string;
  t: number;
  lfh?: string;
};

export type CoefficientEnvelope = {
  isDiff: boolean;
  payload: unknown;
  ti?: PandoraTi;
};

/** One priced selection extracted from eventCoefficients. */
export type CoefficientLine = {
  eventId: number;
  /** Period / book key: `m` (match), `h1`, `s4`, … */
  period: string;
  /** Market type id as string (e.g. `"3"` ML, `"5"` total). */
  marketType: string;
  /** Side key: `"1"`/`"2"` or line `"17.5"` / over-under index. */
  selection: string;
  /** Line for totals/spreads when present. */
  line?: number;
  /** Over/under index when `o[line]` is a pair. */
  sideIndex?: 0 | 1;
  decimal: number;
  american: number;
};

/**
 * Parse Socket.IO binary EVENT header: `451-["room",{_placeholder:true,num:0}]`
 * (optionally with Engine.IO `4` prefix already stripped — we accept both).
 */
export function parseBinaryEventHeader(
  raw: string,
): { attachmentCount: number; eventName: string; args: unknown[] } | null {
  // Wire: `451-["room",…]` = Engine.IO message(4) + Socket.IO binaryEvent(5)
  // + attachmentCount(1) + `-` + JSON. Also accept bare `51-[…]`.
  const m =
    /^45(\d+)-(\[.*\])$/.exec(raw) ?? /^5(\d+)-(\[.*\])$/.exec(raw);
  if (!m) return null;
  const attachmentCount = Number(m[1]);
  if (!Number.isFinite(attachmentCount) || attachmentCount < 1) return null;
  try {
    const arr = JSON.parse(m[2]!) as unknown[];
    if (!Array.isArray(arr) || typeof arr[0] !== 'string') return null;
    return {
      attachmentCount,
      eventName: arr[0],
      args: arr.slice(1),
    };
  } catch {
    return null;
  }
}

/** Extract numeric eventId from room `…eventCoefficients.{id}`. */
export function eventIdFromCoefficientRoom(room: string): number | null {
  const m = /\.eventCoefficients\.(\d+)$/.exec(room);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) ? id : null;
}

/**
 * Decode a Socket.IO binary attachment body (gzipped JSON, often base64 text
 * as seen in CDP `payloadData`, or raw gzip bytes from WS binary frames).
 */
export function decodePandoraAttachment(
  body: string | ArrayBuffer | Uint8Array,
): CoefficientEnvelope {
  let bytes: Uint8Array;
  if (typeof body === 'string') {
    // CDP / text frames: base64 gzip (starts with H4sI…)
    const trimmed = body.trim();
    bytes = Uint8Array.from(atob(trimmed), (c) => c.charCodeAt(0));
  } else if (body instanceof ArrayBuffer) {
    bytes = new Uint8Array(body);
  } else {
    bytes = body;
  }

  // Raw gzip magic 1f 8b — if CDP already gave binary as latin1, detect:
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    // already gzip
  } else if (typeof body === 'string' && !body.trim().startsWith('H4sI')) {
    // try treating string as raw latin1 gzip
    const raw = Uint8Array.from(body, (c) => c.charCodeAt(0));
    if (raw[0] === 0x1f && raw[1] === 0x8b) bytes = raw;
  }

  const jsonText = new TextDecoder().decode(gunzipSync(new Uint8Array(bytes)));
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  return {
    isDiff: Boolean(parsed.isDiff),
    payload: parsed.payload,
    ti: parsed.ti as PandoraTi | undefined,
  };
}

function asFiniteNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 1 ? n : null;
}

/**
 * Flatten a full (non-diff) coefficient payload into priced lines.
 * Market `3` ≈ moneyline (`o.1` / `o.2`); `5`/`6` ≈ totals/spreads with line keys.
 */
export function extractCoefficientLines(
  eventId: number,
  payload: unknown,
): CoefficientLine[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as { c?: Record<string, unknown>; id?: number };
  const c = root.c;
  if (!c || typeof c !== 'object') return [];

  const eid = typeof root.id === 'number' ? root.id : eventId;
  const lines: CoefficientLine[] = [];

  for (const [period, periodVal] of Object.entries(c)) {
    if (!periodVal || typeof periodVal !== 'object') continue;
    for (const [marketType, marketVal] of Object.entries(
      periodVal as Record<string, unknown>,
    )) {
      if (!marketVal || typeof marketVal !== 'object') continue;
      const market = marketVal as { o?: Record<string, unknown>; r?: number };
      const oddsMap = market.o;
      if (!oddsMap || typeof oddsMap !== 'object') continue;

      for (const [selection, price] of Object.entries(oddsMap)) {
        if (Array.isArray(price)) {
          const lineNum = Number(selection);
          for (let i = 0; i < price.length; i++) {
            const dec = asFiniteNumber(price[i]);
            if (dec == null) continue;
            const dual = normalizeOdds(dec, 'decimal');
            lines.push({
              eventId: eid,
              period,
              marketType,
              selection,
              line: Number.isFinite(lineNum) ? lineNum : market.r,
              sideIndex: i === 0 || i === 1 ? (i as 0 | 1) : undefined,
              decimal: dual.decimal,
              american: dual.american,
            });
          }
          continue;
        }
        const dec = asFiniteNumber(price);
        if (dec == null) continue;
        const dual = normalizeOdds(dec, 'decimal');
        lines.push({
          eventId: eid,
          period,
          marketType,
          selection,
          line: typeof market.r === 'number' ? market.r : undefined,
          decimal: dual.decimal,
          american: dual.american,
        });
      }
    }
  }
  return lines;
}

/** One market cell under c[period][marketType]. */
export type CoefficientMarketState = {
  period: string;
  marketType: string;
  /** At least one finite decimal price in `o`. */
  offered: boolean;
  selectionCount: number;
  /** Selection keys currently priced. */
  selections: string[];
  /** Main line (`r`) for totals/spreads when present. */
  line: number | null;
  /**
   * Limit/price-class map from wire (`cls`).
   * `_d` = default; numeric keys = per-line class. Not a suspend flag.
   */
  cls: Record<string, number> | null;
  clsDefault: number | null;
};

export type CoefficientBookState = {
  eventId: number;
  markets: CoefficientMarketState[];
  offeredMarketCount: number;
  offMarketCount: number;
  /** Total priced selection sides (lines after extract). */
  lineCount: number;
  /** Stable fingerprint of offered prices for transition detection. */
  offerFingerprint: string;
};

function countPricesInO(o: Record<string, unknown>): {
  count: number;
  selections: string[];
} {
  const selections: string[] = [];
  let count = 0;
  for (const [sel, price] of Object.entries(o)) {
    if (Array.isArray(price)) {
      let any = false;
      for (const p of price) {
        if (asFiniteNumber(p) != null) {
          count++;
          any = true;
        }
      }
      if (any) selections.push(sel);
    } else if (asFiniteNumber(price) != null) {
      count++;
      selections.push(sel);
    }
  }
  return { count, selections };
}

function parseCls(
  raw: unknown
): { cls: Record<string, number> | null; clsDefault: number | null } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { cls: null, clsDefault: null };
  }
  const out: Record<string, number> = {};
  let clsDefault: number | null = null;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    out[k] = n;
    if (k === '_d') clsDefault = n;
  }
  return {
    cls: Object.keys(out).length ? out : null,
    clsDefault,
  };
}

/**
 * Analyze full coefficient payload for offered vs empty markets.
 * Primary “taken off” signal: market present but `o` empty / no valid prices,
 * or market/period removed entirely (see diffs).
 */
export function analyzeCoefficientBook(
  eventId: number,
  payload: unknown
): CoefficientBookState {
  const lines = extractCoefficientLines(eventId, payload);
  const markets: CoefficientMarketState[] = [];
  const root = payload as { c?: Record<string, unknown>; id?: number };
  const c = root?.c;
  if (c && typeof c === 'object') {
    for (const [period, periodVal] of Object.entries(c)) {
      if (!periodVal || typeof periodVal !== 'object') continue;
      for (const [marketType, marketVal] of Object.entries(
        periodVal as Record<string, unknown>
      )) {
        if (!marketVal || typeof marketVal !== 'object') continue;
        const market = marketVal as {
          o?: Record<string, unknown>;
          r?: number;
          cls?: unknown;
          block?: unknown;
        };
        const oddsMap =
          market.o && typeof market.o === 'object' && !Array.isArray(market.o)
            ? market.o
            : {};
        const { count, selections } = countPricesInO(oddsMap);
        const { cls, clsDefault } = parseCls(market.cls);
        markets.push({
          period,
          marketType,
          offered: count > 0,
          selectionCount: count,
          selections,
          line: typeof market.r === 'number' ? market.r : null,
          cls,
          clsDefault,
        });
      }
    }
  }
  markets.sort((a, b) =>
    a.period === b.period
      ? a.marketType.localeCompare(b.marketType)
      : a.period.localeCompare(b.period)
  );
  const offeredMarketCount = markets.filter(m => m.offered).length;
  const offerFingerprint = lines
    .map(
      l =>
        `${l.period}/${l.marketType}/${l.selection}/${l.sideIndex ?? ''}=${l.decimal}`
    )
    .sort()
    .join('|');
  return {
    eventId,
    markets,
    offeredMarketCount,
    offMarketCount: markets.length - offeredMarketCount,
    lineCount: lines.length,
    offerFingerprint,
  };
}

export type OfferTransition =
  | { kind: 'market_off'; period: string; marketType: string }
  | { kind: 'market_on'; period: string; marketType: string }
  | {
      kind: 'selection_off';
      period: string;
      marketType: string;
      selection: string;
    }
  | {
      kind: 'selection_on';
      period: string;
      marketType: string;
      selection: string;
    }
  | {
      kind: 'price_change';
      period: string;
      marketType: string;
      selection: string;
      from: number;
      to: number;
    };

/** Diff two fingerprints derived from line lists / book states. */
export function diffOfferFingerprints(
  prevLines: CoefficientLine[],
  nextLines: CoefficientLine[]
): OfferTransition[] {
  const key = (l: CoefficientLine) =>
    `${l.period}\0${l.marketType}\0${l.selection}\0${l.sideIndex ?? ''}`;
  const prev = new Map(prevLines.map(l => [key(l), l.decimal]));
  const next = new Map(nextLines.map(l => [key(l), l.decimal]));
  const out: OfferTransition[] = [];

  const prevMk = new Map<string, Set<string>>();
  const nextMk = new Map<string, Set<string>>();
  for (const l of prevLines) {
    const mk = `${l.period}\0${l.marketType}`;
    const set = prevMk.get(mk) ?? new Set();
    set.add(`${l.selection}\0${l.sideIndex ?? ''}`);
    prevMk.set(mk, set);
  }
  for (const l of nextLines) {
    const mk = `${l.period}\0${l.marketType}`;
    const set = nextMk.get(mk) ?? new Set();
    set.add(`${l.selection}\0${l.sideIndex ?? ''}`);
    nextMk.set(mk, set);
  }

  for (const mk of prevMk.keys()) {
    if (!nextMk.has(mk)) {
      const [period, marketType] = mk.split('\0');
      out.push({ kind: 'market_off', period: period!, marketType: marketType! });
    }
  }
  for (const mk of nextMk.keys()) {
    if (!prevMk.has(mk)) {
      const [period, marketType] = mk.split('\0');
      out.push({ kind: 'market_on', period: period!, marketType: marketType! });
    }
  }

  for (const [k, dec] of prev) {
    if (!next.has(k)) {
      const [period, marketType, selection] = k.split('\0');
      out.push({
        kind: 'selection_off',
        period: period!,
        marketType: marketType!,
        selection: selection!,
      });
    } else {
      const n = next.get(k)!;
      if (Math.abs(n - dec) > 1e-9) {
        const [period, marketType, selection] = k.split('\0');
        out.push({
          kind: 'price_change',
          period: period!,
          marketType: marketType!,
          selection: selection!,
          from: dec,
          to: n,
        });
      }
    }
  }
  for (const k of next.keys()) {
    if (!prev.has(k)) {
      const [period, marketType, selection] = k.split('\0');
      out.push({
        kind: 'selection_on',
        period: period!,
        marketType: marketType!,
        selection: selection!,
      });
    }
  }
  return out;
}

/**
 * Apply JSON-patch style diffs (`op`/`path`/`value`) onto a snapshot object.
 * Only `replace` / `add` / `remove` are applied; returns a shallow-cloned root.
 */
export function applyCoefficientDiff(
  snapshot: Record<string, unknown>,
  ops: unknown[],
): Record<string, unknown> {
  const root = structuredClone(snapshot);
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    const { op: kind, path, value } = op as {
      op?: string;
      path?: string;
      value?: unknown;
    };
    if (!path || !kind) continue;
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    let cur: unknown = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur || typeof cur !== 'object') break;
      cur = (cur as Record<string, unknown>)[parts[i]!];
    }
    if (!cur || typeof cur !== 'object') continue;
    const key = parts[parts.length - 1]!;
    const obj = cur as Record<string, unknown>;
    if (kind === 'remove') delete obj[key];
    else if (kind === 'replace' || kind === 'add') obj[key] = value;
  }
  return root;
}
