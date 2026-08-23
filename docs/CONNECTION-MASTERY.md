# Unified Connection Mastery (Bun 1.4, verified)

How the Fonbet gatekeeper connects across protocols on Bun 1.4. Every claim below was
probed on the actual runtime (`bun 1.4.0`, build 34cbb9a40) and cross-checked against the
official docs (links at the bottom). Where common AI-generated summaries differ, the
verified reality wins and the discrepancy is noted.

## 1. Verified protocol matrix

| Protocol | Bun API | Verified on 1.4.0 | Notes |
|----------|---------|-------------------|-------|
| HTTP/1.1 | `fetch()`, `Bun.serve()` | ✅ default | Plain `fetch` negotiates **http/1.1** (probed via Cloudflare `/cdn-cgi/trace`). |
| HTTP/2 (client) | `fetch()` | ⚠️ flag-gated | NOT auto-negotiated. Offer h2 with `--experimental-http2-fetch` / `BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1` (from `bun --help`). |
| HTTP/3 (server) | `Bun.serve({ http3: true, tls })` | ✅ documented | Server-side QUIC on the same port as HTTP/1.1, `Alt-Svc` advertises upgrade. Client fetch h3 = `--experimental-http3-fetch` (honor Alt-Svc). |
| WebSocket client | `new WebSocket(url)` | ✅ | RFC 6455, subprotocols, perMessageDeflate. **No `signal` option is documented**; the manager aborts via `session.close()`. |
| WebSocket server | `Bun.serve({ websocket })` | ✅ | `open`/`message`/`close`/`drain`/`error` handlers, `.data` context, pub/sub. |
| TCP raw | `Bun.connect({ hostname, port, socket })` | ✅ | **`socket` handler is REQUIRED** (probed: throws `SocketOptions.socket is required`). `tls: true` or a `tls` key/cert object; `socket.upgradeTLS()`. No `signal` option documented. |
| UDP | `Bun.udpSocket({ port, socket: { data } })` | ✅ | `socket.send(data, port, addr)`; OS-assigned port when omitted. No consumer in this repo (no-fit). |
| Unix sockets | `fetch(url, { unix: '/path.sock' })` | ✅ | Documented (`proxy` + `unix` together throw). No consumer in this repo (no-fit). |
| DNS | `Bun.dns.prefetch(hostname, port?)` | ✅ | 256-entry / 30s auto cache for fetch + Bun.connect; prefetch for known hosts. |
| `fetch.preconnect` | `fetch.preconnect(url, { dns?, tcp?, http?, https? })` | ✅ runtime / ⚠️ build quirk | Typed in `globals.d.ts`. **Working shape on this build: `http://host:port` + `{ dns, tcp }`; `https://` URLs throw `Invalid port`** (docs example uses https — build lag). `--fetch-preconnect` CLI flag exists. Only helps when there's a gap before the request. |
| WebTransport | `new WebTransport(url)` | ❌ **absent** | `typeof WebTransport === 'undefined'` on 1.4.0. Common summaries claim it — false here. |

## 2. Corrections vs. common AI-generated summaries

- **HTTP/2 is not auto-negotiated in client `fetch`** on this build — it requires the
  `--experimental-http2-fetch` flag. (Server side may differ; check `Bun.serve` docs.)
- The client flag is `--experimental-http3-fetch`, not `--http3`. Server-side HTTP/3 is
  `Bun.serve({ http3: true })`.
- **WebTransport is not present** on 1.4.0.
- `new WebSocket(url, { signal })` constructs but **signal honoring is unverified and
  undocumented** — use an explicit close/session object for abort.
- `Bun.connect` **requires the `socket` handler**; a `signal` option is not documented
  (the unified AbortSignal story applies to `fetch` and `Bun.connect`-wrapped streams, not
  the socket-handler API itself).
- `retryableConnect` works for promise/AbortSignal-based calls (fetch, connect). UDP has
  no AbortSignal — handle separately.

## 3. The unified pattern (what we actually run)

`src/institutions/fonbet/connection.ts` implements the deep pattern on the verified APIs:

- **Warm-up**: `prefetchDns` (`Bun.dns.prefetch`) + `preconnectFeed`
  (`fetch.preconnect` with the working `http://host:port` shape).
- **Resilient WS**: `connectFonbetFeed` — subscribe on open, client-side filters
  (sport/league/team), auto-reconnect with exponential backoff (`nextReconnectDelay`,
  base 1s → cap 30s), abort via `session.close()`.
- **Unified retry**: `retryableConnect(fn, { retries, baseMs, sleep, shouldRetry })` —
  one AbortSignal-based retry wrapper for any promise-returning call; injectable `sleep`
  for tests.
- **Observability**: `dnsCacheStats()` (`Bun.dns.getCacheStats` — real, returns
  hits/misses/size/errors), `live_delay` surfaced on events.

## 4. Fonbet mapping

| Fonbet piece | Protocol | Repo code |
|--------------|----------|-----------|
| ODDSCORP live/prematch odds | WebSocket client | `connectFonbetFeed` + `parse.ts` (fixture-first) + `sync.ts` (unified `odds_ticks`) |
| betting-api REST (from a reachable region) | `fetch` — enable h2 via `BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1` for multiplexing | future |
| Low-latency UDP scores (proprietary) | `Bun.udpSocket` | no-fit, no endpoint |
| Local cache/proxy | `fetch(url, { unix })` | no-fit, no consumer |

## 5. References (official)

- Networking: https://github.com/oven-sh/bun/tree/main/docs/runtime/networking (`tcp.mdx`, `udp.mdx`, `dns.mdx`, `fetch.mdx`)
- WebSockets: https://github.com/oven-sh/bun/blob/main/docs/runtime/http/websockets.mdx
- HTTP server (HTTP/3, TLS): https://github.com/oven-sh/bun/blob/main/docs/runtime/http/server.mdx
