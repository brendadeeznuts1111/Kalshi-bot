# Streams, TLS hardening & WebSocket fixes — release claims probe-verified

**Source:** [bun-v1.4.0 release blog](https://bun.com/blog/bun-v1.4) (sections
"Streams and bodies", "TLS/sockets", "WebSocket client").
**Status:** every claim below was executed against the installed runtime
(bun 1.4.0, 34cbb9a40) with openssl-3.6.3-generated certs. Legend: ✅ verified ·
⚠️ verified but different semantics · ❌ contradicted by probe · 📋 vendor claim
(not locally measurable).

---

## 1. Streams & bodies

### ReadableStream / WritableStream — ✅ native and functional

Globals exist; construction, enqueue, close, and `for await` all work.
`Response(plainReadableStream).text()` works. "Less memory, faster" are 📋
vendor benchmarks.

### TransformStream — ⚠️ narrow termination bug on 1.4.0 (scoped finding)

The release claims TransformStream "passes 100% of the Web Platform Tests".
**Scoped verdict:** the *specific pattern* below — a generic TransformStream
with a `transform` hook, `writable.close()`, then reading to `done` —
hangs on the installed 1.4.0: data flows out, but the readable side never
signals `done` once the writable side closes. Note this pattern is **not
covered by the bun repo's own streams suite**, which passes 274/281 on the
same 1.4.0 binary (its 5 failures are direct-stream close-hook and async-
iterator accessor edge cases) — so treat this as a narrow repro, not "Bun's
streams are broken", and the historical "100% WPT" claim is not falsifiable
by a later binary anyway.

```ts
const ts = new TransformStream({ transform(c, ctrl) { ctrl.enqueue(String(c)); } });
const w = ts.writable.getWriter();
w.write("a"); await w.close();
for await (const c of ts.readable) {}          // HANGS
await ts.readable.pipeTo(new WritableStream()); // HANGS
const r = ts.readable.getReader();
while (true) { const { done } = await r.read(); if (done) break; } // HANGS at done
const resp = new Response(ts.readable); await resp.text(); // HANGS
```

Probe evidence (all `Promise.race`-guarded at 2 s): identity TransformStream
for-await → TIMEOUT; `pipeTo` → TIMEOUT; manual `getReader` loop → TIMEOUT;
`Response(ts.readable).text()` → TIMEOUT. Reading *while* the writer is still
open delivers chunks (`read()` returns `{ value: "a", done: false }`) — only
termination is broken.

**Working alternatives:** the native stream subclasses are fine —
`TextEncoderStream`, `TextDecoderStream`, `CompressionStream` (all
probe-passed). Build the Response body from a plain `ReadableStream`, a
`Blob`, or a byte stream instead of a generic TransformStream.

### CompressionStream / DecompressionStream — ✅ native round-trips

`gzip` and `deflate` round-trips verified ("hello" × 200 → 40/28 bytes →
decode back to 1200). Sync companions exist: `Bun.gzipSync`, `Bun.gunzipSync`,
`Bun.deflateSync`, `Bun.inflateSync`.

### Response.clone() / Request.clone() — ✅ functional; memory claim is 📋

Both clones verified readable and identical: `Response("body-data").clone()`
→ both `.text()` return `"body-data"`; same for Request bodies. The "share
body chunks instead of copying, cutting peak memory" sentence is a vendor
benchmark — behavior is correct, but the memory-sharing internals are not
locally observable.

## 2. TLS / sockets hardening — ✅ all probed and verified

Certs: openssl-3.6.3 — self-signed CA, server cert (SAN localhost/127.0.0.1),
client cert signed by the CA, self-signed wildcard cert (SAN DNS:*.example.com).

| Claim | Probe result | Verdict |
| --- | --- | --- |
| `tls.Server` (node:tls) defaults `rejectUnauthorized: true`, gated on `requestCert` | Server `{ requestCert: true }` (no explicit reject) → no-cert client triggers server `tlsClientError ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE`; CA-signed client cert → `authorized=true, peerCN=kalshi-client` | ✅ |
| `Bun.connect({ tls })` defaults `rejectUnauthorized: true` | `tls: true` vs self-signed server → `open, handshake, close`, **no data delivered**; `{ rejectUnauthorized: false }` → data flows; `{ ca }` → data flows | ✅ |
| `Bun.listen({ tls: { requestCert: true } })` defaults `rejectUnauthorized: true` | No-cert client → server-side `handshake(success: false, verify: { code: "EPROTO" })`, server closes; with client cert → `success: true`, data flows; `{ requestCert: true, rejectUnauthorized: false }` → `success: true` with `UNABLE_TO_GET_ISSUER_CERT`, connection continues | ✅ |
| Wildcard certs no longer match across multiple labels | Self-signed `*.example.com`; `Bun.connect({ tls: { servername: "b.example.com" } })` → data flows; `servername: "a.b.example.com"` → handshake, close, **no data** | ✅ |
| `fetch()` mTLS (`cert`/`key` in `tls`) | Server `{ requestCert: true }` + client `{ cert, key, ca }` → HTTP 200, server saw `authorized=true, peerCN=kalshi-client`; without client cert → server `ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE`, fetch `ECONNRESET` | ✅ |
| Long `tls.passphrase` values handled safely | (not independently reproducible) | 📋 |

Client-side failure mode (matches the release notes): the connection opens and
the handshake runs, then the socket closes **without delivering data** — no
exception thrown. `NODE_TLS_REJECT_UNAUTHORIZED=0` is documented as honored;
pass the CA or `rejectUnauthorized: false` for private-CA/dev servers.

## 3. WebSocket client — ✅ CloseEvent verified; race fixes 📋

| Claim | Probe result | Verdict |
| --- | --- | --- |
| Close events report correct `CloseEvent.code` / `wasClean` | Local `Bun.serve` + client: server `ws.close(4001, "bye-now")` → client `{ code: 4001, wasClean: true, reason: "bye-now" }` | ✅ |
| Protocol error when server flips permessage-deflate mid-message | Regression fix — not reproducible without a hostile server | 📋 |
| wss:// proxy races (concurrent writes/reads; open handler yielding) | Regression fixes — not reproducible here | 📋 |

## 4. Summary

| Claim | Verdict |
| --- | --- |
| ReadableStream / WritableStream native | ✅ |
| TransformStream native, passes 100% WPT | ⚠️ narrow repro hangs (writable.close() → read-to-done); bun's own suite passes 274/281 and doesn't cover the pattern — broad "broken" claim withdrawn |
| CompressionStream / DecompressionStream native | ✅ |
| clone() shares body chunks | ✅ functional; memory internals 📋 |
| node:tls / Bun.connect / Bun.listen rejectUnauthorized defaults | ✅ |
| Wildcard certs don't cross labels | ✅ |
| fetch() mTLS | ✅ |
| CloseEvent code/wasClean | ✅ |
| permessage-deflate / proxy fixes | 📋 |

**Docs:** https://bun.com/blog/bun-v1.4 · https://bun.com/docs/api/websockets ·
https://bun.com/docs/api/sockets · https://nodejs.org/api/tls.html
