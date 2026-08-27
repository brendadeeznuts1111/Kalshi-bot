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

### Benchmark claims (vendor) — 📋 not locally measurable

All numbers are the blog's own (AMD EPYC 9R14, Linux x64, median of 3 runs,
peak RSS via /usr/bin/time -v). Transcribed for reference; the functional paths
are probed in the sections below.

| Pipeline (64 MB, 4 KiB chunks) | Bun 1.4 | Bun 1.3 | Node 26 | Deno 2.9 |
| --- | --- | --- | --- | --- |
| Download (fetch → gunzip → decode → for-await) | 1,519 MB/s | n/a | 204 MB/s | 530 MB/s |
| Upload (file → gzip → fetch POST) | 179 MB/s | n/a | 78 MB/s | 137 MB/s |
| Transcode (decode → encode → file) | 132 MB/s | 116 MB/s | 52 MB/s | 91 MB/s |
| Subprocess (fetch → cat → cat) | 751 MB/s | 505 MB/s | 256 MB/s | 170 MB/s |

Peak memory 57/60/62/65 MB vs Node 86/84/72/106 MB ("up to 69% lower", 207→65 MB
subprocess). clone(): 220 MB @ 96 ms (both branches) / 155 MB @ 63 ms
(clone-only) vs Node 382/318 MB — "shares body chunks, saves 128 MB per clone"
(functional clone ✅ probed below; memory internals 📋). CompressionStream
152 MB/s (zlib-bound, close across runtimes), DecompressionStream 2,291 MB/s
(4.6× Node). TextEncoderStream 44 MB / 1,963 MB/s, TextDecoderStream 56 MB /
1,489 MB/s ("about half the memory of 1.3" — functional round-trips ✅ probed
below).

### Backpressure — ✅ pull() pauses for a slow/stalled client

Bun.serve pauses ReadableStream request & response bodies when the connection
can't accept more data ("a slow or stalled client holds at most one buffer's
worth of server memory"). Probe P5 (`bun run serve-stream:probe`): a 64 KiB-
chunk response read by a client at one chunk per 120 ms pulled ~85 times across
8 reads (83-95 across runs; cap 500 — pull() does NOT race ahead to buffer
everything), **0 extra pulls during a 500 ms stall**, and pulls resumed once
the client read again. Enqueued-but-undelivered bytes stay bounded (≈ 85 ×
64 KiB vs 32 MiB if unpaused — a few socket buffers' worth, not exactly one).
The direct-stream analogue is `Promise<number>` writes under backpressure
([BUN_DIRECT_STREAMS §2](BUN_DIRECT_STREAMS.md)). Extended coverage (P6-P9,
same probe, 13/13 checks): ✅ `Bun.file().stream()` and `Blob.stream()`
responses stream correctly to a slow client; ✅ a **CompressionStream
(TransformStream) pipeline** pauses the SOURCE `pull()` (P7: 63 source pulls,
cap 500); ✅ **request-body backpressure** — a slow server read pauses the
client's fetch() upload `pull()` (P8: 30 pulls, cap 500); ✅ **Bun.spawn /
child_process** — a child writing 64 MiB BLOCKS on the OS pipe (not heap
buffering) while the parent reads slowly (P9: dd still running after 8 slow
reads) and delivers every byte with a clean exit (P9b: slow 1,179,648 +
drained 65,929,216 = 67,108,864). Not probed: HTMLRewriter.transform 📋.

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

### BuildArtifact.stream() — ✅ returns a ReadableStream (#10004 type confusion fixed)

`Bun.build()` outputs expose `.stream()` (Blob method). A long-standing
type-confusion regression ([#10004](https://github.com/oven-sh/bun/issues/10004),
fixed by [PR #33144](https://github.com/oven-sh/bun/pull/33144), merged
2026-07-01) made `.stream()` read the WRONG cached slot on a `BuildArtifact`
receiver: reading any cached getter (e.g. `.kind`) before the first
`.stream()` call returned that getter's string instead of a `ReadableStream`,
and an fd-backed stream write could overwrite `.kind`. Probe-locked on this
runtime (build `34cbb9a40` >= fix merge `7f33321f`): `.kind` first, then
`new Response(artifact.stream()).text()` === `.text()`, and `.kind`
survives the stream (evidence S01c, [`BUN_BUILD_FINDINGS.md`](BUN_BUILD_FINDINGS.md) §1).

### Web Streams fixes (bun-v1.4 blog, "Web Streams" list) — probe matrix

The blog's Web Streams bullet list (anchor `Web Streams# … drain. #32640`) claims ~27
fixes. Locally measured on 34cbb9a40; the rest are 📋 vendor claims.

| Blog claim | Verdict on 1.4.0 (34cbb9a40) |
| --- | --- |
| #25484 clone() no longer locks the body after `.body` access — both independently readable | ✅ `.body` first, then `clone()`: both `text()` return `"body-data"` |
| #29229 `console.log(ReadableStream)` prints `[class ReadableStream]` not `[class Function]` | ✅ `Bun.inspect(ReadableStream)` = `[class ReadableStream]` (console.log path); `util.inspect`/`String()` still show the function form |
| Removed the non-existent `.formData()`/`.arrayBuffer()` from ReadableStream | ✅ both `undefined` on a plain ReadableStream |
| #37692 direct streams deliver bytes written after `flush()` inside `pull()` to pipeTo/pipeThrough/tee/for-await/textStream | ✅ `"part1-" → flush(true) → "part2"` → `pipeTo` yields `"part1-part2"` (corroborates [`BUN_DIRECT_STREAMS.md`](BUN_DIRECT_STREAMS.md) §3) |
| #37692 direct `pull()` sync throw → no stray `unhandledRejection` | ✅ 0 stray rejections probed |
| #33782 direct `pull()` serialized on the JS reader path | ✅ two concurrent `read()`s → max concurrent pull = 1 |
| #33144 BuildArtifact.stream() kind-string regression fixed | ✅ probe-locked S01c ([`BUN_BUILD_FINDINGS.md`](BUN_BUILD_FINDINGS.md) §1) |
| #32640 "write() returns a negative number under backpressure" | ❌ contradicted — real backpressure (slow client) returns `Promise<number>` (200/200 promises, 0 negatives); the `n < 0` guard is dead code ([BUN_DIRECT_STREAMS §2](BUN_DIRECT_STREAMS.md)) |
| #32640 "await flush(true) waits for the sink to drain" | ✅ consistent — equivalent to awaiting the write promise ([BUN_DIRECT_STREAMS §3](BUN_DIRECT_STREAMS.md)) |
| Error inside a Response-body stream → reported + connection aborted | ⚠️ reported server-side; client gets a truncated/empty body — clean abort is pattern-dependent |
| direct-controller `write()`/`close()` no-op after the stream is closed | ✅ returns 1 silently, no throw ([BUN_DIRECT_STREAMS §2](BUN_DIRECT_STREAMS.md)) |
| #29891 TransformStream GC'd without close (OOM fixed) · #27191 cancelled fetch() body freed · #33329 pipeTo drains in place (12%) · single-chunk `.bytes()`/`.arrayBuffer()` copy · #32863 fromWeb/finished · #32656/#36666/#36624/#36809/#36785 GC/closure internals · FileSink items (#33538 #35365 #35278 #35344 #36250, Windows teardown) · fetch() streamed-body wire framing (empty chunks / keep-alive / Content-Length) | 📋 not locally falsifiable (memory/GC/wire internals; request-body iteration itself ✅ — serve-stream-probe P3) |

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
| BuildArtifact.stream() type confusion (#10004) | ✅ fixed in this runtime — kind-then-stream yields real content, .kind survives (S01c, PR #33144) |
| Backpressure (slow/stalled client) | ✅ pull() pauses — P5-P9: response bodies, CompressionStream pipelines, uploads, file/Blob streams, Bun.spawn pipes (probe 13/13) |
| Throughput/memory benchmarks (streams, clone, gzip, text codecs) | 📋 vendor numbers (AMD EPYC 9R14); functional paths ✅ probed |
| node:tls / Bun.connect / Bun.listen rejectUnauthorized defaults | ✅ |
| Wildcard certs don't cross labels | ✅ |
| fetch() mTLS | ✅ |
| CloseEvent code/wasClean | ✅ |
| permessage-deflate / proxy fixes | 📋 |

**Docs:** https://bun.com/blog/bun-v1.4 · https://bun.com/docs/api/websockets ·
https://bun.com/docs/api/sockets · https://nodejs.org/api/tls.html
