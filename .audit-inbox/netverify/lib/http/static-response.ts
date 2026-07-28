// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file — Bun.file
// @see https://bun.com/docs/runtime/hashing#bun-cryptohasher — Bun.CryptoHasher
// @see https://bun.com/docs/runtime/http/server#basic-setup — Bun.serve routes
// @see https://bun.com/docs/runtime/networking/fetch#content-type-handling — request CT auto
/**
 * Bun static-route vs file-route response helpers.
 *
 * **Static (memory)** — `new Response(bytes)` after `file.bytes()` at load time:
 *   - zero FS I/O per request
 *   - strong ETag + If-None-Match → 304
 *   - missing files fail at preload (startup), not as runtime 404
 *   - best for small hot assets (ops-summary, proofs, static.json)
 *
 * **File (disk)** — `new Response(Bun.file(path))` per request:
 *   - exists-check + stream with backpressure
 *   - Last-Modified + If-Modified-Since → 304
 *   - Range handled by Bun when using Bun.file body
 *   - runtime 404 if missing
 *   - best for large / changing files
 *
 * Response Content-Type is always explicit (path guess). Request-side auto CT
 * for fetch(Blob|FormData) lives in content-type.ts.
 */
import { sha256Hex } from '../bun-utils-proof.ts';
import { guessContentType as guessContentTypeFromPath } from './content-type.ts';

export const DEFAULT_STATIC_MAX_BYTES = 512 * 1024; // 512 KiB
/** Prefer static (memory) when under this size and access is “hot”. */
export const HOT_STATIC_MAX_BYTES = 100 * 1024; // 100 KiB

export type RouteStrategy = 'static' | 'file' | 'hybrid';

export type RouteStatsSnapshot = {
  staticRoutes: number;
  fileRoutes: number;
  totalMemoryUsed: number;
  staticHits: number;
  fileHits: number;
  notModified304: number;
  decision: {
    staticMaxBytes: number;
    hotMaxBytes: number;
    rule: string;
  };
};

/** Process-wide counters for health / monitoring. */
const stats = {
  staticHits: 0,
  fileHits: 0,
  notModified304: 0,
  knownFileRoutes: new Set<string>(),
};

export function recordStaticHit(notModified = false): void {
  stats.staticHits++;
  if (notModified) stats.notModified304++;
}

export function recordFileHit(path?: string, notModified = false): void {
  stats.fileHits++;
  if (notModified) stats.notModified304++;
  if (path) stats.knownFileRoutes.add(path);
}

/**
 * Decision tree:
 *  size < hotMax && hot → static
 *  size > 1MB or infrequent → file
 *  else hybrid (first request sizes, then cache or stream)
 */
export function decideRouteStrategy(
  sizeBytes: number,
  opts: { hot?: boolean; maxStatic?: number; hotMax?: number } = {}
): RouteStrategy {
  const maxStatic = opts.maxStatic ?? DEFAULT_STATIC_MAX_BYTES;
  const hotMax = opts.hotMax ?? HOT_STATIC_MAX_BYTES;
  if (opts.hot && sizeBytes <= hotMax) return 'static';
  if (sizeBytes > 1024 * 1024) return 'file';
  if (sizeBytes <= maxStatic) return 'hybrid';
  return 'file';
}

export function getRouteStats(
  staticCaches: Iterable<Map<string, PreloadedStatic> | PreloadedStatic[]> = []
): RouteStatsSnapshot {
  let staticRoutes = 0;
  let totalMemoryUsed = 0;
  for (const cache of staticCaches) {
    if (cache instanceof Map) {
      staticRoutes += cache.size;
      for (const a of cache.values()) totalMemoryUsed += a.size;
    } else {
      for (const a of cache) {
        staticRoutes++;
        totalMemoryUsed += a.size;
      }
    }
  }
  return {
    staticRoutes,
    fileRoutes: stats.knownFileRoutes.size,
    totalMemoryUsed,
    staticHits: stats.staticHits,
    fileHits: stats.fileHits,
    notModified304: stats.notModified304,
    decision: {
      staticMaxBytes: DEFAULT_STATIC_MAX_BYTES,
      hotMaxBytes: HOT_STATIC_MAX_BYTES,
      rule: 'hot∧≤100KiB→static; >1MiB→file; ≤512KiB→hybrid; else file',
    },
  };
}

export function resetRouteStats(): void {
  stats.staticHits = 0;
  stats.fileHits = 0;
  stats.notModified304 = 0;
  stats.knownFileRoutes.clear();
}

export type PreloadedStatic = {
  path: string;
  bytes: Uint8Array;
  etag: string;
  contentType: string;
  size: number;
};

export type StaticRespondOpts = {
  cacheControl?: string;
  /** Extra headers merged last. */
  headers?: Record<string, string>;
};

export type FileRespondOpts = StaticRespondOpts & {
  contentType?: string;
};

/** Guess response Content-Type from path extension (SSOT: content-type.ts). */
export function guessContentType(path: string): string {
  return guessContentTypeFromPath(path);
}

/** Strong ETag from content bytes or string (quoted hex). */
export function etagFromBytes(bytes: Uint8Array | string): string {
  if (typeof bytes === 'string') return `"${sha256Hex(bytes)}"`;
  const h = new Bun.CryptoHasher('sha256');
  h.update(bytes);
  return `"${h.digest('hex')}"`;
}

/** Load file into memory for static-route serving. Throws if missing. */
export async function preloadStatic(
  path: string,
  opts: { contentType?: string; maxBytes?: number } = {}
): Promise<PreloadedStatic> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`preloadStatic: missing file ${path}`);
  }
  const size = file.size;
  const max = opts.maxBytes ?? DEFAULT_STATIC_MAX_BYTES;
  if (size > max) {
    throw new Error(
      `preloadStatic: ${path} is ${size} bytes (> ${max}); use respondFile() instead`
    );
  }
  const bytes = new Uint8Array(await file.bytes());
  const h = new Bun.CryptoHasher('sha256');
  h.update(bytes);
  const etag = `"${h.digest('hex')}"`;
  return {
    path,
    bytes,
    etag,
    contentType: opts.contentType ?? guessContentType(path),
    size: bytes.byteLength,
  };
}

/** Preload many paths; skip missing when `optional`. */
export async function preloadStaticMap(
  paths: string[],
  opts: { optional?: boolean; maxBytes?: number } = {}
): Promise<Map<string, PreloadedStatic>> {
  const map = new Map<string, PreloadedStatic>();
  for (const path of paths) {
    try {
      map.set(path, await preloadStatic(path, { maxBytes: opts.maxBytes }));
    } catch (e) {
      if (!opts.optional) throw e;
    }
  }
  return map;
}

function mergeHeaders(base: Record<string, string>, extra?: Record<string, string>): Headers {
  const h = new Headers(base);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) h.set(k, v);
  }
  return h;
}

/**
 * Static-route response from preloaded bytes.
 * Honors If-None-Match → 304. Body omitted for HEAD.
 */
export function respondStatic(
  asset: PreloadedStatic,
  request: Request,
  opts: StaticRespondOpts = {}
): Response {
  const inm = request.headers.get('If-None-Match');
  if (inm && etagMatches(inm, asset.etag)) {
    recordStaticHit(true);
    return new Response(null, {
      status: 304,
      headers: mergeHeaders(
        {
          ETag: asset.etag,
          'Cache-Control': opts.cacheControl ?? 'public, max-age=60',
          'X-Serve-Strategy': 'static',
        },
        opts.headers
      ),
    });
  }

  recordStaticHit(false);
  const headers = mergeHeaders(
    {
      'Content-Type': asset.contentType,
      'Content-Length': String(asset.size),
      ETag: asset.etag,
      'Cache-Control': opts.cacheControl ?? 'public, max-age=60',
      'X-Serve-Strategy': 'static',
    },
    opts.headers
  );

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  // Copy so Response ownership doesn't alias mutable buffer unexpectedly
  return new Response(asset.bytes, { status: 200, headers });
}

/** Weak/strong ETag list match (comma-separated If-None-Match). */
export function etagMatches(ifNoneMatch: string, etag: string): boolean {
  if (ifNoneMatch.trim() === '*') return true;
  const want = etag.replace(/^W\//, '');
  return ifNoneMatch.split(',').some(part => {
    const t = part.trim().replace(/^W\//, '');
    return (
      t === etag ||
      t === want ||
      t === etag.replace(/"/g, '') ||
      `"${t.replace(/"/g, '')}"` === etag
    );
  });
}

/**
 * File-route response via Bun.file (stream, 404, Last-Modified, Range).
 */
export async function respondFile(
  path: string,
  request: Request,
  opts: FileRespondOpts = {}
): Promise<Response> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return new Response(JSON.stringify({ error: 'Not found', path }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Serve-Strategy': 'file',
      },
    });
  }

  const lastModified = new Date(file.lastModified);
  const lastModifiedHttp = lastModified.toUTCString();
  const ims = request.headers.get('If-Modified-Since');
  if (ims) {
    const since = Date.parse(ims);
    if (!Number.isNaN(since) && file.lastModified <= since + 999) {
      // +999: HTTP dates have 1s resolution
      recordFileHit(path, true);
      return new Response(null, {
        status: 304,
        headers: mergeHeaders(
          {
            'Last-Modified': lastModifiedHttp,
            'Cache-Control': opts.cacheControl ?? 'public, max-age=60',
            'X-Serve-Strategy': 'file',
          },
          opts.headers
        ),
      });
    }
  }

  recordFileHit(path, false);
  const headers = mergeHeaders(
    {
      'Content-Type': opts.contentType ?? guessContentType(path),
      'Last-Modified': lastModifiedHttp,
      'Cache-Control': opts.cacheControl ?? 'public, max-age=60',
      'X-Serve-Strategy': 'file',
      // Bun.file enables Accept-Ranges / Range when used as body
    },
    opts.headers
  );

  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(file.size));
    return new Response(null, { status: 200, headers });
  }

  return new Response(file, { status: 200, headers });
}

/**
 * Build a JSON/text body as a static-route response with ETag + optional TTL
 * revalidation for dynamic-but-small payloads (health, tables).
 */
export function respondStaticJson(
  // eslint-disable-next-line harness/no-unknown-function-param -- JSON wire body
  body: unknown,
  request: Request,
  opts: StaticRespondOpts & { etag?: string } = {}
): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const bytes = new TextEncoder().encode(text);
  const etag = opts.etag ?? etagFromBytes(bytes);
  const asset: PreloadedStatic = {
    path: ':json',
    bytes,
    etag,
    contentType: opts.headers?.['Content-Type'] ?? 'application/json; charset=utf-8',
    size: bytes.byteLength,
  };
  return respondStatic(asset, request, {
    cacheControl: opts.cacheControl ?? 'public, max-age=5',
    headers: opts.headers,
  });
}

/**
 * Choose strategy by size: small → preload static; large → file route.
 * If preload fails (missing), file route returns 404 at request time.
 */
export async function respondAuto(
  path: string,
  request: Request,
  opts: FileRespondOpts & { maxStaticBytes?: number; cache?: Map<string, PreloadedStatic> } = {}
): Promise<Response> {
  const max = opts.maxStaticBytes ?? DEFAULT_STATIC_MAX_BYTES;
  const cached = opts.cache?.get(path);
  if (cached) return respondStatic(cached, request, opts);

  const file = Bun.file(path);
  if (!(await file.exists())) {
    return respondFile(path, request, opts); // 404 shape
  }
  if (file.size <= max) {
    try {
      const asset = await preloadStatic(path, {
        contentType: opts.contentType,
        maxBytes: max,
      });
      opts.cache?.set(path, asset);
      return respondStatic(asset, request, opts);
    } catch {
      return respondFile(path, request, opts);
    }
  }
  return respondFile(path, request, opts);
}
