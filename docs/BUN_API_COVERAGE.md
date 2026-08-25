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
| `env` | object | ✓ | ✓ | runtime:probe | 236 |
| `color` | function | ✓ | ✓ | ansi:probe | 119 |
| `serve` | function | ✓ | ✓ | serve-tls/routes | 108 |
| `cron` | function | ✓ | ✓ | cron tests §126/128 | 103 |
| `argv` | object | ✓ | ✓ | runtime:probe | 83 |
| `inspect` | function | ✓ | ✓ | ansi:probe | 78 |
| `Image` | function | ✓ | ✓ | image:probe | 74 |
| `markdown` | object | ✓ | ✓ | format:probe | 73 |
| `sleep` | function | ✓ | ✓ | runtime:probe | 70 |
| `WebView` | function | ✓ | ✓ | runtime:probe | 68 |
| `spawnSync` | function | ✓ | ✓ | spawn:probe | 66 |
| `build` | function | ✓ | ✓ | build-deep:probe | 62 |
| `Glob` | function | ✓ | ✓ | fsx:probe | 49 |
| `$` | function | ✓ | ✓ | shell:probe | 47 |
| `spawn` | function | ✓ | ✓ | spawn:probe | 47 |
| `version` | string | ✓ | ✓ | runtime:probe | 44 |
| `Transpiler` | function | ✓ | ✓ | runtime:probe | 43 |
| `escapeHTML` | function | ✓ | ✓ | ansi:probe | 43 |
| `XML` | object | ✓ | ✓ | format:probe | 42 |
| `which` | function | ✓ | ✓ | fsx:probe | 37 |
| `Archive` | function | ✓ | ✓ | fs:probe | 33 |
| `CryptoHasher` | function | ✓ | ✓ | crypto:probe | 32 |
| `TOML` | object | ✓ | ✓ | format:probe | 30 |
| `semver` | object | ✓ | ✓ | bun:apis-probe | 28 |
| `stringWidth` | function | ✓ | ✓ | ansi:probe | 28 |
| `hash` | function | ✓ | ✓ | crypto:probe | 26 |
| `dns` | object | ✓ | ✓ | net:probe | 22 |
| `nanoseconds` | function | ✓ | ✓ | runtime:probe | 20 |
| `JSON5` | object | ✓ | ✓ | bun:apis-probe | 18 |
| `JSONL` | object | ✓ | ✓ | format:probe | 18 |
| `sha` | function | ✓ | ✓ | bun:apis-probe | 14 |
| `stripANSI` | function | ✓ | ✓ | ansi:probe | 13 |
| `wrapAnsi` | function | ✓ | ✓ | ansi:probe | 13 |
| `secrets` | object | ✓ | ✓ | net:probe | 11 |
| `sliceAnsi` | function | ✓ | — | ansi:probe | 11 |
| `stdout` | object | ✓ | ✓ | fs:probe | 11 |
| `YAML` | object | ✓ | ✓ | format:probe | 9 |
| `revision` | string | ✓ | ✓ | runtime:probe | 9 |
| `connect` | function | ✓ | ✓ | security:probe | 8 |
| `deepEquals` | function | ✓ | ✓ | crypto:probe | 8 |
| `CSRF` | object | ✓ | ✓ | csrf:probe | 6 |
| `SQL` | function | ✓ | ✓ | sqlite:probe | 6 |
| `Cookie` | function | ✓ | ✓ | defaults:probe | 5 |
| `CookieMap` | function | ✓ | ✓ | defaults:probe | 5 |
| `JSONC` | object | ✓ | ✓ | format:probe | 5 |
| `deflateSync` | function | ✓ | ✓ | fs:probe | 5 |
| `plugin` | function | ✓ | ✓ | build-deep:probe | 5 |
| `randomUUIDv7` | function | ✓ | ✓ | crypto:probe | 5 |
| `zstdCompressSync` | function | ✓ | ✓ | fs:probe | 5 |
| `SHA256` | function | ✓ | — | crypto:probe | 4 |
| `fetch` | function | ✓ | ✓ | serve-tls/routes | 4 |
| `gzipSync` | function | ✓ | ✓ | fs:probe | 4 |
| `sql` | function | ✓ | ✓ | sqlite:probe | 4 |
| `Terminal` | function | ✓ | ✓ | runtime:probe | 3 |
| `gunzipSync` | function | ✓ | ✓ | fs:probe | 3 |
| `listen` | function | ✓ | ✓ | net:probe | 3 |
| `openInEditor` | function | ✓ | ✓ | fsx:probe | 3 |
| `peek` | function | ✓ | ✓ | runtime:probe | 3 |
| `zstdDecompressSync` | function | ✓ | ✓ | fs:probe | 3 |
| `mmap` | function | ✓ | ✓ | fs:probe | 2 |
| `readableStreamToArrayBuffer` | function | ✓ | ✓ | runtime:probe | 2 |
| `udpSocket` | function | ✓ | ✓ | net:probe | 2 |
| `ArrayBufferSink` | function | ✓ | ✓ | runtime:probe | 1 |
| `fileURLToPath` | function | ✓ | ✓ | fsx:probe | 1 |
| `inflateSync` | function | ✓ | ✓ | fs:probe | 1 |
| `pathToFileURL` | function | ✓ | ✓ | fsx:probe | 1 |
| `readableStreamToText` | function | ✓ | ✓ | runtime:probe | 1 |
| `redis` | object | ✓ | ✓ | net:probe | 1 |
| `resolve` | function | ✓ | ✓ | fsx:probe | 1 |
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
## Module imports (objective step 1 — inventory)

| Import | Uses (repo) | Gate |
|---|---|---|
| bun:test | 295 | test suite (bun test) |
| bun:sqlite | 126 | sqlite:probe |
| bun | 47 (+6 dynamic) | all Bun.* probes above |
| bun:ffi | 2 | ffi:probe |
| node:path | 103 | runtime:probe P12 (imports resolve) |
| node:fs | 74 | runtime:probe P12 |
| node:util | 33 | runtime:probe P12 |
| node:os | 32 | runtime:probe P12 |
| node:crypto | 10 | runtime:probe P12 |
| node:tls | 2 | runtime:probe P12 |
| node:net | 1 | runtime:probe P12 |
| node:child_process | 1 | runtime:probe P12 |

All bun: and node: modules resolve on 1.4.0 (runtime:probe P12). Coverage:
**102/102 Bun.* tokens classified · 73 runtime values gated · 29
type-only/non-existent pinned · 0 GAP rows** — verify:contracts 47/47.


## Full Bun surface (110 runtime members — repo-used vs probed)

The matrix above covers the repo's USAGE. This table covers ALL of
Bun's runtime namespace on 1.4.0, so unprobed members are visible.
Gate: surface:probe (#47).

| Member | Status |
|---|---|| `$` | probed |
| `Archive` | probed |
| `ArrayBufferSink` | probed |
| `CSRF` | probed |
| `Cookie` | probed |
| `CookieMap` | probed |
| `CryptoHasher` | probed |
| `FFI` | probed |
| `FileSystemRouter` | probed |
| `Glob` | probed |
| `Image` | probed |
| `JSON5` | probed |
| `JSONC` | probed |
| `JSONL` | probed |
| `MD4` | probed |
| `MD5` | probed |
| `RedisClient` | probed |
| `S3Client` | probed |
| `SHA1` | probed |
| `SHA224` | probed |
| `SHA256` | UNPROBED |
| `SHA384` | probed |
| `SHA512` | probed |
| `SHA512_256` | probed |
| `SQL` | probed |
| `TOML` | probed |
| `Terminal` | probed |
| `Transpiler` | probed |
| `WebView` | probed |
| `XML` | probed |
| `YAML` | probed |
| `allocUnsafe` | probed |
| `argv` | probed |
| `build` | probed |
| `color` | probed |
| `concatArrayBuffers` | probed |
| `connect` | probed |
| `cron` | probed |
| `deepEquals` | probed |
| `deepMatch` | probed |
| `deflateSync` | probed |
| `dns` | probed |
| `embeddedFiles` | probed |
| `enableANSIColors` | probed |
| `env` | probed |
| `escapeHTML` | probed |
| `fetch` | probed |
| `file` | probed |
| `fileURLToPath` | probed |
| `gc` | probed |
| `generateHeapSnapshot` | probed |
| `gunzipSync` | probed |
| `gzipSync` | probed |
| `hash` | probed |
| `indexOfLine` | probed |
| `inflateSync` | probed |
| `inspect` | probed |
| `isMainThread` | probed |
| `isStandaloneExecutable` | probed |
| `listen` | probed |
| `main` | probed |
| `markdown` | probed |
| `mmap` | probed |
| `nanoseconds` | probed |
| `openInEditor` | probed |
| `password` | probed |
| `pathToFileURL` | probed |
| `peek` | probed |
| `plugin` | probed |
| `postgres` | probed |
| `randomUUIDv5` | probed |
| `randomUUIDv7` | probed |
| `readableStreamToArray` | probed |
| `readableStreamToArrayBuffer` | probed |
| `readableStreamToBlob` | probed |
| `readableStreamToBytes` | probed |
| `readableStreamToFormData` | probed |
| `readableStreamToJSON` | probed |
| `readableStreamToText` | probed |
| `redis` | probed |
| `resolve` | probed |
| `resolveSync` | probed |
| `revision` | probed |
| `s3` | probed |
| `secrets` | probed |
| `semver` | probed |
| `serve` | probed |
| `sha` | probed |
| `shrink` | probed |
| `sleep` | probed |
| `sleepSync` | probed |
| `sliceAnsi` | probed |
| `spawn` | probed |
| `spawnSync` | probed |
| `sql` | probed |
| `stderr` | probed |
| `stdin` | probed |
| `stdout` | probed |
| `stringWidth` | probed |
| `stripANSI` | probed |
| `udpSocket` | probed |
| `unsafe` | probed |
| `version` | probed |
| `which` | probed |
| `wrapAnsi` | probed |
| `write` | probed |
| `zstdCompress` | probed |
| `zstdCompressSync` | probed |
| `zstdDecompress` | probed |
| `zstdDecompressSync` | probed |

