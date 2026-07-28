/**
 * Bun.serve `Server` surface — grounded helpers for lifecycle + probing.
 *
 * ## Runtime matrix (Bun 1.4 canary verified)
 *
 * | Call | Hits `routes` | Hits `fetch` | `fetch(req, server)` 2nd arg | `requestIP` |
 * |------|---------------|--------------|------------------------------|-------------|
 * | TCP `fetch(server.url+path)` | **yes** | yes (fallback) | **Server object** | real socket addr |
 * | `server.fetch(Request\|string)` | **no** | yes only | **undefined** | N/A (no socket) |
 *
 * Further facts:
 * - `server.fetch` requires a `fetch` handler — routes-only servers **throw**.
 * - Relative `server.fetch("/path")` can resolve to `http://host:0/path` — always
 *   pass absolute URLs via `new URL(path, server.url)`.
 * - Method routes (`{ GET, POST }`) only apply on the TCP/`routes` path.
 * - `server.reload({ routes, fetch, websocket, error })` hot-swaps handlers; port stays.
 * - `pendingRequests` increments for in-flight TCP requests (observed mid-handler = 1).
 * - `development` defaults to **true** when unset; set `development: false` for prod-like.
 * - `server.id` may be empty string unless configured.
 * - Prefer loopback for production-path proofs (routes + socket + requestIP).
 * - Prefer `server.fetch` only to unit-test pure `fetch` handler logic (no routes).
 *
 * Interface (docs reference): stop, reload, fetch, upgrade, publish,
 * subscriberCount, requestIP, timeout, ref/unref, pendingRequests,
 * pendingWebSockets, url, port, hostname, development, id.
 *
 * @see https://bun.com/docs/runtime/http/server#basic-setup — Bun.serve
 * @see https://bun.com/docs/runtime/http/server#reference — Server interface
 * @see https://bun.com/docs/runtime/http/server#server-reload — server.reload
 * @see https://bun.com/docs/runtime/http/server#server-stop — server.stop
 * @see https://bun.com/docs/runtime/http/server#server-pendingrequests-and-server-pendingwebsockets
 * @see https://bun.com/docs/runtime/http/websockets#start-a-websocket-server — WebSocketHandler
 * @see https://bun.com/docs/runtime/http/tls — TLSOptions
 */

import { inspectCustom, shouldColor } from '../console-depth.ts';
import { inspectTable, type TableRow } from './networking-report.ts';

/** Canonical docs loci. */
export const BUN_SERVE_DOCS = 'https://bun.com/docs/runtime/http/server#basic-setup';
export const BUN_SERVER_REFERENCE_DOCS = 'https://bun.com/docs/runtime/http/server#reference';
export const BUN_SERVER_RELOAD_DOCS = 'https://bun.com/docs/runtime/http/server#server-reload';
export const BUN_SERVER_STOP_DOCS = 'https://bun.com/docs/runtime/http/server#server-stop';
export const BUN_SERVER_PENDING_DOCS =
  'https://bun.com/docs/runtime/http/server#server-pendingrequests-and-server-pendingwebsockets';
export const BUN_WEBSOCKET_DOCS =
  'https://bun.com/docs/runtime/http/websockets#start-a-websocket-server';
export const BUN_TLS_DOCS = 'https://bun.com/docs/runtime/http/tls';

/**
 * Runtime server type from Bun.serve (includes Server methods + fields).
 * Prefer this over re-declaring the interface — stays in sync with bun-types.
 */
export type BunServer = ReturnType<typeof Bun.serve>;

/** Snapshot of identity + in-flight counters (no body I/O). */
export type ServerIdentity = {
  /** server.url.href */
  url: string;
  port: number;
  hostname: string;
  development: boolean;
  /** Bun Server.id — opaque runtime instance id */
  id: string; // brand-ok — Bun Server.id from docs reference
  pendingRequests: number;
  pendingWebSockets: number;
};

/** How the probe reaches the server. */
export type ServerProbeMode =
  /** `server.fetch` — fetch handler only (skips `routes`). */
  | 'server-fetch'
  /** Loopback HTTP via `fetch(server.url)` — full routes + fetch. */
  | 'loopback';

/** One path probe result. */
export type ServerFetchProbe = {
  path: string;
  method: string;
  mode: ServerProbeMode;
  status: number;
  ms: number;
  ok: boolean;
  contentType: string | null;
  /** Bytes when body was consumed; null if HEAD / skipped. */
  bytes: number | null;
  error?: string;
};

export type ServerFetchProbeOpts = {
  method?: 'GET' | 'HEAD' | 'POST';
  headers?: HeadersInit;
  /** When false, cancel body without reading (default true for GET). */
  readBody?: boolean;
  /**
   * `loopback` (default) — TCP to server.url, exercises `routes`.
   * `server-fetch` — in-process Server.fetch, fetch handler only.
   */
  mode?: ServerProbeMode;
};

/**
 * Live identity fields from a running Server.
 * @see https://bun.com/docs/runtime/http/server#reference
 */
export function serverIdentity(server: BunServer): ServerIdentity {
  return {
    url: server.url.href,
    port: server.port,
    hostname: server.hostname,
    development: server.development,
    id: server.id,
    pendingRequests: server.pendingRequests,
    pendingWebSockets: server.pendingWebSockets,
  };
}

/**
 * In-process request — docs: `server.fetch(request: Request | string)`.
 *
 * **Does not match `routes`** on current Bun — only the `fetch` handler runs.
 * Prefer {@link loopbackFetch} to exercise SIMD routes.
 *
 * @see https://bun.com/docs/runtime/http/server#reference
 */
export async function serverFetch(
  server: Pick<BunServer, 'fetch' | 'url'>,
  pathOrUrl: string,
  init: RequestInit = {}
): Promise<Response> {
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    return server.fetch(new Request(pathOrUrl, init));
  }
  const url = new URL(pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`, server.url);
  return server.fetch(new Request(url, init));
}

/**
 * Loopback HTTP client against `server.url` — hits `routes` then `fetch`.
 * Same path production clients take (connection pool, keep-alive, etc.).
 */
export async function loopbackFetch(
  server: Pick<BunServer, 'url'>,
  pathOrUrl: string,
  init: RequestInit = {}
): Promise<Response> {
  const url =
    pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')
      ? pathOrUrl
      : new URL(pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`, server.url).href;
  return fetch(url, { ...init, keepalive: true });
}

/**
 * Time a single path against a running Server.
 */
export async function probeServerPath(
  server: Pick<BunServer, 'fetch' | 'url'>,
  path: string,
  opts: ServerFetchProbeOpts = {}
): Promise<ServerFetchProbe> {
  const method = opts.method ?? 'GET';
  const readBody = opts.readBody ?? method === 'GET';
  const mode: ServerProbeMode = opts.mode ?? 'loopback';
  const t0 = Bun.nanoseconds();
  try {
    const res =
      mode === 'server-fetch'
        ? await serverFetch(server, path, { method, headers: opts.headers })
        : await loopbackFetch(server, path, { method, headers: opts.headers });
    let bytes: number | null = null;
    if (readBody && method !== 'HEAD') {
      const buf = await res.arrayBuffer();
      bytes = buf.byteLength;
    } else {
      await res.body?.cancel().catch(() => {});
      bytes = null;
    }
    const ms = (Bun.nanoseconds() - t0) / 1e6;
    return {
      path,
      method,
      mode,
      status: res.status,
      ms: Number(ms.toFixed(2)),
      ok: res.ok || (res.status >= 200 && res.status < 400),
      contentType: res.headers.get('content-type'),
      bytes,
    };
  } catch (err) {
    const ms = (Bun.nanoseconds() - t0) / 1e6;
    return {
      path,
      method,
      mode,
      status: 0,
      ms: Number(ms.toFixed(2)),
      ok: false,
      contentType: null,
      bytes: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Probe many paths in series (stable timing) or parallel.
 */
export async function probeServerPaths(
  server: Pick<BunServer, 'fetch' | 'url'>,
  paths: readonly string[],
  opts: ServerFetchProbeOpts & { parallel?: boolean } = {}
): Promise<ServerFetchProbe[]> {
  const { parallel = false, ...probeOpts } = opts;
  if (parallel) {
    return Promise.all(paths.map(p => probeServerPath(server, p, probeOpts)));
  }
  const out: ServerFetchProbe[] = [];
  for (const p of paths) {
    out.push(await probeServerPath(server, p, probeOpts));
  }
  return out;
}

/**
 * Report for Server identity + path probes — printable via Bun.inspect.custom.
 */
export class ServerProbeReport {
  constructor(
    public readonly identity: ServerIdentity,
    public readonly probes: ServerFetchProbe[],
    public readonly meta: { label?: string; mode?: ServerProbeMode } = {}
  ) {}

  summary() {
    const passed = this.probes.filter(p => p.ok).length;
    return {
      total: this.probes.length,
      passed,
      failed: this.probes.length - passed,
      pendingRequests: this.identity.pendingRequests,
      pendingWebSockets: this.identity.pendingWebSockets,
      mode: this.meta.mode ?? this.probes[0]?.mode ?? 'loopback',
    };
  }

  toJSON() {
    return {
      identity: this.identity,
      summary: this.summary(),
      probes: this.probes,
      rendered: this.render({ colors: false }),
    };
  }

  render(opts: { colors?: boolean } = {}): { identity: string; probes: string } {
    const colors = opts.colors ?? shouldColor();
    const idRows: TableRow[] = Object.entries(this.identity).map(([field, value]) => ({
      field,
      value: String(value),
    }));
    const probeRows: TableRow[] = this.probes.map(p => ({
      path: p.path,
      method: p.method,
      mode: p.mode,
      status: p.status,
      ms: p.ms,
      ok: p.ok ? 'PASS' : 'FAIL',
      bytes: p.bytes ?? '—',
      type: p.contentType?.split(';')[0] ?? '—',
    }));
    return {
      identity: inspectTable(idRows, ['field', 'value'], { colors }),
      probes: probeRows.length
        ? inspectTable(
            probeRows,
            ['path', 'method', 'mode', 'status', 'ms', 'ok', 'bytes', 'type'],
            { colors }
          )
        : '(no probes)',
    };
  }

  /**
   * @see https://bun.com/docs/runtime/utils#bun-inspect-custom
   */
  [inspectCustom](_depth?: number, options?: { colors?: boolean }): string {
    const colors = options?.colors ?? shouldColor();
    const s = this.summary();
    const r = this.render({ colors });
    const label = this.meta.label ?? 'ServerProbeReport';
    return [
      `${label} · ${this.identity.url} · mode=${s.mode} · ${s.passed}/${s.total} · pendingReq=${s.pendingRequests} ws=${s.pendingWebSockets}`,
      '',
      '── SERVER IDENTITY ──',
      r.identity,
      '',
      '── PATH PROBES ──',
      r.probes,
      '',
      'Note: server.fetch skips routes (fetch handler only); loopback hits routes+fetch.',
    ].join('\n');
  }
}

/**
 * Build a report by probing paths on a live Server.
 *
 * @example
 * ```ts
 * const server = Bun.serve({
 *   port: 0,
 *   routes: { "/ready": new Response("ok") },
 *   fetch: () => new Response("no", { status: 404 }),
 * });
 * const report = await buildServerProbeReport(server, ["/ready"], { mode: "loopback" });
 * console.log(report);
 * await server.stop(true);
 * ```
 */
export async function buildServerProbeReport(
  server: BunServer,
  paths: readonly string[],
  opts: ServerFetchProbeOpts & { parallel?: boolean; label?: string } = {}
): Promise<ServerProbeReport> {
  const { label, mode = 'loopback', ...probeOpts } = opts;
  const probes = await probeServerPaths(server, paths, { ...probeOpts, mode });
  return new ServerProbeReport(serverIdentity(server), probes, { label, mode });
}

/**
 * Graceful stop helper — docs default waits for in-flight; `force` closes all.
 * @see https://bun.com/docs/runtime/http/server#server-stop
 */
export async function stopServer(server: BunServer, force = false): Promise<void> {
  await server.stop(force);
}
