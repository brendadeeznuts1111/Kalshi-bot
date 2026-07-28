// @see https://bun.com/docs/runtime/networking/fetch#custom-headers — custom headers
// @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request — fetch
/**
 * Outbound fetch — merge default custom headers on every request.
 *
 * Per Bun docs, pass a `Headers` object (or init.headers) and caller values win
 * on duplicate keys. Use `factoryFetch` or `installGlobalFetchHeaders()` so tools
 * do not repeat User-Agent / Accept wiring.
 */
export const BUN_FETCH_CUSTOM_HEADERS_DOCS =
  'https://bun.com/docs/runtime/networking/fetch#custom-headers';

/** Common Accept values for health / API probes. */
export const ACCEPT_JSON = 'application/json';
export const ACCEPT_PLAIN = 'text/plain';
export const ACCEPT_HTML = 'text/html';

const DEFAULT_UA = `FactoryWager/fetch (Bun/${Bun.version})`;

/** Base headers for every outbound fetch (override per call). */
export function defaultFetchHeaders(): Headers {
  const h = new Headers();
  h.set('User-Agent', DEFAULT_UA);
  h.set('Accept-Language', 'en');
  return h;
}

/**
 * Merge default + layered headers (later layers override earlier keys).
 * @see https://bun.com/docs/runtime/networking/fetch#custom-headers
 */
export function mergeFetchHeaders(...layers: (HeadersInit | undefined)[]): Headers {
  const merged = defaultFetchHeaders();
  for (const layer of layers) {
    if (layer == null) continue;
    new Headers(layer).forEach((value, key) => merged.set(key, value));
  }
  return merged;
}

/** Merge RequestInit with combined headers (overrides win). */
export function mergeFetchInit(init?: RequestInit, overrides?: RequestInit): RequestInit {
  const headers = mergeFetchHeaders(init?.headers, overrides?.headers);
  return { ...init, ...overrides, headers };
}

/** fetch with FactoryWager default custom headers applied. */
export async function factoryFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  return fetch(input, mergeFetchInit(init));
}

let globalInstalled = false;

/**
 * Patch `globalThis.fetch` once so bare `fetch()` calls inherit default headers.
 * Safe to call from CLI entrypoints (verify-etag, verify-networking, …).
 */
export function installGlobalFetchHeaders(force = false): void {
  if (globalInstalled && !force) return;
  globalInstalled = true;
  const native = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    native(input, mergeFetchInit(init));
}

/** Test hook — restore native fetch after patching. */
export function uninstallGlobalFetchHeaders(native: typeof fetch): void {
  globalThis.fetch = native;
  globalInstalled = false;
}

export function isGlobalFetchHeadersInstalled(): boolean {
  return globalInstalled;
}
