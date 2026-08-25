# Bun API Coverage Matrix

Every `Bun.*` token the repo uses (src/ tools/ scripts/ tests/) — 102 tokens — grounded in:
- **Runtime**: typeof on Bun 1.4.0 (34cbb9a40). `NO` = not a runtime value: type-only, or documented non-existence (see tools/docs-api-validate.ts INTENTIONAL + tests/lib/docs-api.test.ts).
- **Types**: the word appears in installed bun-types 1.4.0 `*.d.ts`.
- **Docs**: the word appears in installed bun-types `docs/**/*.mdx`.
- **Gate**: verify:contracts gate covering the token; GAP = unprobed, folded by the 100% coverage goal.
- **Uses**: count of `Bun.X` occurrences in repo source.

Runtime values (73):

| Token | Runtime | Types | Docs | Gate | Uses |
|---|---|---|---|---|---|
| `file` | function | ✓ | ✓ | fs:probe | 474 |
| `write` | function | ✓ | ✓ | fs:probe | 251 |
| `env` | object | ✓ | ✓ | GAP | 236 |
| `color` | function | ✓ | ✓ | ansi:probe | 119 |
| `serve` | function | ✓ | ✓ | serve-tls/routes | 108 |
| `cron` | function | ✓ | ✓ | cron tests §126/128 | 103 |
| `argv` | object | ✓ | ✓ | GAP | 83 |
| `inspect` | function | ✓ | ✓ | ansi:probe | 78 |
| `Image` | function | ✓ | ✓ | GAP | 74 |
| `markdown` | object | ✓ | ✓ | GAP | 73 |
| `sleep` | function | ✓ | ✓ | GAP | 70 |
| `WebView` | function | ✓ | ✓ | GAP | 68 |
| `spawnSync` | function | ✓ | ✓ | spawn:probe | 66 |
| `build` | function | ✓ | ✓ | build-deep:probe | 62 |
| `Glob` | function | ✓ | ✓ | GAP | 49 |
| `$` | function | ✓ | ✓ | shell:probe | 47 |
| `spawn` | function | ✓ | ✓ | spawn:probe | 47 |
| `version` | string | ✓ | ✓ | GAP | 44 |
| `Transpiler` | function | ✓ | ✓ | GAP | 43 |
| `escapeHTML` | function | ✓ | ✓ | ansi:probe | 43 |
| `XML` | object | ✓ | ✓ | GAP | 42 |
| `which` | function | ✓ | ✓ | GAP | 37 |
| `Archive` | function | ✓ | ✓ | fs:probe | 33 |
| `CryptoHasher` | function | ✓ | ✓ | crypto:probe | 32 |
| `TOML` | object | ✓ | ✓ | GAP | 30 |
| `semver` | object | ✓ | ✓ | bun:apis-probe | 28 |
| `stringWidth` | function | ✓ | ✓ | ansi:probe | 28 |
| `hash` | function | ✓ | ✓ | crypto:probe | 26 |
| `dns` | object | ✓ | ✓ | GAP | 22 |
| `nanoseconds` | function | ✓ | ✓ | GAP | 20 |
| `JSON5` | object | ✓ | ✓ | bun:apis-probe | 18 |
| `JSONL` | object | ✓ | ✓ | GAP | 18 |
| `sha` | function | ✓ | ✓ | bun:apis-probe | 14 |
| `stripANSI` | function | ✓ | ✓ | ansi:probe | 13 |
| `wrapAnsi` | function | ✓ | ✓ | ansi:probe | 13 |
| `secrets` | object | ✓ | ✓ | GAP | 11 |
| `sliceAnsi` | function | ✓ | — | ansi:probe | 11 |
| `stdout` | object | ✓ | ✓ | fs:probe | 11 |
| `YAML` | object | ✓ | ✓ | GAP | 9 |
| `revision` | string | ✓ | ✓ | GAP | 9 |
| `connect` | function | ✓ | ✓ | GAP | 8 |
| `deepEquals` | function | ✓ | ✓ | crypto:probe | 8 |
| `CSRF` | object | ✓ | ✓ | GAP | 6 |
| `SQL` | function | ✓ | ✓ | sqlite:probe | 6 |
| `Cookie` | function | ✓ | ✓ | GAP | 5 |
| `CookieMap` | function | ✓ | ✓ | GAP | 5 |
| `JSONC` | object | ✓ | ✓ | GAP | 5 |
| `deflateSync` | function | ✓ | ✓ | fs:probe | 5 |
| `plugin` | function | ✓ | ✓ | build-deep:probe | 5 |
| `randomUUIDv7` | function | ✓ | ✓ | crypto:probe | 5 |
| `zstdCompressSync` | function | ✓ | ✓ | fs:probe | 5 |
| `SHA256` | function | ✓ | — | crypto:probe | 4 |
| `fetch` | function | ✓ | ✓ | serve-tls/routes | 4 |
| `gzipSync` | function | ✓ | ✓ | fs:probe | 4 |
| `sql` | function | ✓ | ✓ | sqlite:probe | 4 |
| `Terminal` | function | ✓ | ✓ | GAP | 3 |
| `gunzipSync` | function | ✓ | ✓ | fs:probe | 3 |
| `listen` | function | ✓ | ✓ | GAP | 3 |
| `openInEditor` | function | ✓ | ✓ | GAP | 3 |
| `peek` | function | ✓ | ✓ | GAP | 3 |
| `zstdDecompressSync` | function | ✓ | ✓ | fs:probe | 3 |
| `mmap` | function | ✓ | ✓ | fs:probe | 2 |
| `readableStreamToArrayBuffer` | function | ✓ | ✓ | GAP | 2 |
| `udpSocket` | function | ✓ | ✓ | GAP | 2 |
| `ArrayBufferSink` | function | ✓ | ✓ | GAP | 1 |
| `fileURLToPath` | function | ✓ | ✓ | GAP | 1 |
| `inflateSync` | function | ✓ | ✓ | fs:probe | 1 |
| `pathToFileURL` | function | ✓ | ✓ | GAP | 1 |
| `readableStreamToText` | function | ✓ | ✓ | GAP | 1 |
| `redis` | object | ✓ | ✓ | GAP | 1 |
| `resolve` | function | ✓ | ✓ | GAP | 1 |
| `zstdCompress` | function | ✓ | ✓ | fs:probe | 1 |
| `zstdDecompress` | function | ✓ | ✓ | fs:probe | 1 |

Type-only / non-existent (29):

| Token | Types | Docs | Notes |
|---|---|---|---|
| `WebSocketOptions` | ✓ | — | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `image` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `CronController` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `rename` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `Networking` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `X` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `ffi` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `zstd` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `Quic` | — | — | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `Serve` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `html` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `watch` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `BunFile` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `File` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `HTMLBundle` | ✓ | — | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `S` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `Security` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `SourceMap` | — | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `term` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `tok` | — | — | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `ArchiveInput` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `BunInspectOptions` | ✓ | — | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `CSV` | — | — | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `Foo` | — | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `Request` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `Shell` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `gzip` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `readableStreamTo` | — | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
| `x` | ✓ | ✓ | type-only / INTENTIONAL non-existence (docs-api-validate) |
