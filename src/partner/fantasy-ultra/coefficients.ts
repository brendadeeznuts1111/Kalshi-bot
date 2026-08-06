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
 * @see https://bun.com/docs/runtime/utils#bun-gunzipsync
 */
import { gunzipSync } from 'bun';
import { normalizeOdds } from '../odds-format.ts';

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
