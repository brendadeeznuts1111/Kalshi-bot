/**
 * http-gzip.ts — synchronous response-body compression via Bun.gzipSync
 * (probe-verified on 1.4.0 — BUN_STREAMS_TLS_WS §CompressionStream: gzip
 * round-trips verified, Bun.gzipSync exists). For FULLY-BUFFERED text/json/
 * xml bodies only — never apply to streaming/SSE/WebSocket responses.
 */
export const GZIP_MIN_BYTES = 1024;
const COMPRESSIBLE = /json|text|xml|javascript|svg/i;

export type GzippedBody = { body: string | Uint8Array<ArrayBuffer>; headers: Record<string, string> };

/** Gzip `body` when it is large and compressible; returns headers to merge. */
export function maybeGzip(
  body: string,
  headers: Record<string, string>,
  minBytes = GZIP_MIN_BYTES,
): GzippedBody {
  if (body.length < minBytes) return { body, headers };
  const type = headers["content-type"] ?? headers["Content-Type"] ?? "";
  if (!COMPRESSIBLE.test(type)) return { body, headers };
  const gz = Bun.gzipSync(body) as Uint8Array<ArrayBuffer>;
  if (gz.length >= body.length) return { body, headers }; // not worth it
  return {
    body: gz,
    headers: { ...headers, "content-encoding": "gzip", vary: "accept-encoding" },
  };
}
