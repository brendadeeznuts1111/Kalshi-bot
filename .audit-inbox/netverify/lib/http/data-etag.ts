// @see https://bun.com/docs/runtime/hashing#bun-cryptohasher — Bun.CryptoHasher
/**
 * Shared data-ETag helpers: same underlying data → same ETag across formats.
 *
 * Use when `/health` (JSON) and `/health/pre` (plain) represent one data source.
 * Always send `Vary: Accept` when the response body format is negotiated.
 *
 * Per-endpoint ETags: different data keys (`health` vs `metrics`).
 * Per-user ETags: include principal id in the hashed payload.
 */
import { etagMatches } from './static-response.ts';

export type DataVersion<T = unknown> = {
  data: T;
  /** Strong ETag derived from data content (not rendered format). */
  contentHash: string;
  generatedAt: number;
};

const dataVersions = new Map<string, DataVersion>();

/** Stable JSON for hashing (sorted object keys). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = sortKeys(obj[k]);
  }
  return out;
}

/**
 * ETag from data content. Optional `slice` shortens for debug logs (still unique enough for ops).
 */
export function computeDataETag(data: unknown, opts: { slice?: number } = {}): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(stableStringify(data));
  const hex = hasher.digest('hex');
  const body = opts.slice && opts.slice > 0 ? hex.slice(0, opts.slice) : hex;
  return `"${body}"`;
}

/**
 * Cache data version by key. Reuses entry when contentHash matches (data unchanged).
 */
export function getDataVersion<T>(key: string, data: T): DataVersion<T> {
  const contentHash = computeDataETag(data);
  const cached = dataVersions.get(key) as DataVersion<T> | undefined;
  if (cached && cached.contentHash === contentHash) {
    return cached;
  }
  const version: DataVersion<T> = {
    data,
    contentHash,
    generatedAt: Date.now(),
  };
  dataVersions.set(key, version as DataVersion);
  return version;
}

/** Client has this ETag (If-None-Match). */
export function isFresh(req: Request, etag: string): boolean {
  const client = req.headers.get('If-None-Match');
  if (!client) return false;
  return etagMatches(client, etag);
}

/** 304 Not Modified with shared ETag + Vary for content negotiation. */
export function notModified(
  etag: string,
  opts: { vary?: string; cacheControl?: string } = {}
): Response {
  return new Response(null, {
    status: 304,
    headers: {
      ETag: etag,
      Vary: opts.vary ?? 'Accept',
      'Cache-Control': opts.cacheControl ?? 'public, max-age=5, must-revalidate',
    },
  });
}

/**
 * Respond with a rendered format of `data`, using a shared data ETag.
 * Call after isFresh check, or pass request to auto-304.
 */
export function respondWithSharedETag(
  req: Request,
  data: unknown,
  render: { body: string; contentType: string },
  opts: {
    /** Cache key for getDataVersion (default: hash only, no cache). */
    versionKey?: string;
    etag?: string;
    cacheControl?: string;
    vary?: string;
    extraHeaders?: Record<string, string>;
  } = {}
): Response {
  const etag =
    opts.etag ??
    (opts.versionKey
      ? getDataVersion(opts.versionKey, data).contentHash
      : computeDataETag(data));

  if (isFresh(req, etag)) {
    return notModified(etag, {
      vary: opts.vary,
      cacheControl: opts.cacheControl,
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': render.contentType,
    ETag: etag,
    Vary: opts.vary ?? 'Accept',
    'Cache-Control': opts.cacheControl ?? 'public, max-age=5, must-revalidate',
    'X-ETag-Scope': 'data',
    ...opts.extraHeaders,
  };

  if (req.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  return new Response(render.body, { status: 200, headers });
}

export function clearDataETagCache(): void {
  dataVersions.clear();
}
