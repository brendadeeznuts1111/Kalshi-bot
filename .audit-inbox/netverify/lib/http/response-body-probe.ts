// @see https://bun.com/docs/runtime/networking/fetch#response-bodies — response body methods
/**
 * Probe each Response body consumer (.text / .json / .formData / .bytes / .arrayBuffer / .blob).
 * One fresh GET per method — bodies are single-use.
 */
import {
  netCheckRow,
  type NetCheckRow,
  type NetCheckStatus,
  type NetOptimizationType,
  type NetTargetCategory,
} from './networking-report.ts';

export const RESPONSE_BODY_METHODS = [
  'text',
  'json',
  'formData',
  'bytes',
  'arrayBuffer',
  'blob',
] as const;

export type ResponseBodyMethod = (typeof RESPONSE_BODY_METHODS)[number];

export const RESPONSE_BODY_NET_TYPES: Record<ResponseBodyMethod, NetOptimizationType> = {
  text: 'response-text',
  json: 'response-json',
  formData: 'response-formdata',
  bytes: 'response-bytes',
  arrayBuffer: 'response-arraybuffer',
  blob: 'response-blob',
};

export type ResponseBodyProbeOpts = {
  url: string;
  targetName: string;
  category: NetTargetCategory;
  timeoutMs: number;
  okStatuses?: number[];
  fetchImpl?: typeof fetch;
};

export type ResponseBodyProbeOutcome = {
  rows: NetCheckRow[];
  bodySize: number;
  bytes: Uint8Array | null;
};

function ms(ns0: number): number {
  return (Bun.nanoseconds() - ns0) / 1e6;
}

function statusOk(status: number, ok: number[] | undefined): boolean {
  if (ok?.length) return ok.includes(status);
  return status >= 200 && status < 400;
}

function checkRow(
  target: string,
  category: NetTargetCategory,
  type: NetOptimizationType,
  metric: string,
  status: NetCheckStatus,
  detail?: string
): NetCheckRow {
  return netCheckRow({ target, category, type, metric, status, detail });
}

async function fetchGet(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<{ res: Response; elapsedMs: number } | { error: string; elapsedMs: number }> {
  const t0 = Bun.nanoseconds();
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      keepalive: true,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { res, elapsedMs: ms(t0) };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      elapsedMs: ms(t0),
    };
  }
}

function jsonMetric(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value === 'object') return `object{${Object.keys(value as object).length}}`;
  return typeof value;
}

function formDataMetric(fd: FormData): string {
  let n = 0;
  fd.forEach(() => {
    n++;
  });
  return `${n} entries`;
}

async function consumeBody(
  method: ResponseBodyMethod,
  res: Response
): Promise<{ status: NetCheckStatus; metric: string; detail?: string; bytes?: Uint8Array }> {
  const ct = (res.headers.get('content-type') || '').toLowerCase();

  switch (method) {
    case 'text': {
      const text = await res.text();
      return { status: 'PASS', metric: `${text.length} chars` };
    }
    case 'json': {
      if (!ct.includes('json') && ct.includes('html')) {
        return {
          status: 'SKIP',
          metric: 'non-JSON',
          detail: `content-type=${ct || '—'}`,
        };
      }
      try {
        const value = await res.json();
        return { status: 'PASS', metric: jsonMetric(value) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (ct.includes('json')) {
          return { status: 'FAIL', metric: 'parse error', detail: msg };
        }
        return { status: 'SKIP', metric: 'non-JSON', detail: msg };
      }
    }
    case 'formData': {
      if (!ct.includes('multipart/form-data')) {
        return {
          status: 'SKIP',
          metric: 'not multipart',
          detail: `content-type=${ct || '—'}`,
        };
      }
      try {
        const fd = await res.formData();
        return { status: 'PASS', metric: formDataMetric(fd) };
      } catch (err) {
        return {
          status: 'FAIL',
          metric: 'formData error',
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }
    case 'bytes': {
      const bytes = await res.bytes();
      return { status: 'PASS', metric: `${bytes.byteLength} B`, bytes };
    }
    case 'arrayBuffer': {
      const buf = await res.arrayBuffer();
      return { status: 'PASS', metric: `${buf.byteLength} B` };
    }
    case 'blob': {
      const blob = await res.blob();
      return { status: 'PASS', metric: `${blob.size} B · ${blob.type || 'no-type'}` };
    }
  }
}

/** Run all six Response body probes (fresh GET each). */
export async function probeResponseBodyMethods(
  opts: ResponseBodyProbeOpts
): Promise<ResponseBodyProbeOutcome> {
  const rows: NetCheckRow[] = [];
  const fetchImpl = opts.fetchImpl ?? fetch;
  let bodySize = 0;
  let bytes: Uint8Array | null = null;

  for (const method of RESPONSE_BODY_METHODS) {
    const type = RESPONSE_BODY_NET_TYPES[method];
    const t0 = Bun.nanoseconds();
    const got = await fetchGet(opts.url, opts.timeoutMs, fetchImpl);
    if ('error' in got) {
      rows.push(
        checkRow(
          opts.targetName,
          opts.category,
          type,
          `${got.elapsedMs.toFixed(1)}ms`,
          'FAIL',
          got.error
        )
      );
      continue;
    }

    const httpOk = statusOk(got.res.status, opts.okStatuses);
    if (!httpOk) {
      rows.push(
        checkRow(
          opts.targetName,
          opts.category,
          type,
          `${got.elapsedMs.toFixed(1)}ms (${got.res.status})`,
          'FAIL',
          'HTTP status not in okStatuses'
        )
      );
      continue;
    }

    try {
      const out = await consumeBody(method, got.res);
      if (out.bytes) {
        bytes = out.bytes;
        bodySize = out.bytes.byteLength;
      }
      rows.push(
        checkRow(
          opts.targetName,
          opts.category,
          type,
          `${ms(t0).toFixed(1)}ms (${out.metric})`,
          out.status,
          out.detail
        )
      );
    } catch (err) {
      rows.push(
        checkRow(
          opts.targetName,
          opts.category,
          type,
          `${ms(t0).toFixed(1)}ms`,
          'FAIL',
          err instanceof Error ? err.message : String(err)
        )
      );
    }
  }

  return { rows, bodySize, bytes };
}
