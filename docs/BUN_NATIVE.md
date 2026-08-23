# Bun-native API grounding

This project is **Bun-native first**. Runtime dependencies are limited to the two domain libraries that earn their weight: `drizzle-orm` for typed SQL and `zod` for boundary schemas. Process, file, TOML, terminal, test, and other platform capabilities map directly to Bun or the Node-compatible standard library.

**Stack checklist (agents):** [`BUN_TECH_STACK.md`](BUN_TECH_STACK.md) — runtime, HTTP, DB, utils, markdown, production readiness mapped to this repo.

**Rule:** before adding any package, check the [Bun API map](#bun-api-map) below — the runtime almost certainly already provides it.

Canonical URLs (two planes — prefer both in `@see` when practical):

| Plane | Hub | What it is |
| ----- | --- | ---------- |
| **Guides** | [docs index / llms.txt](https://bun.com/docs/llms.txt) | Narrative how-to, examples, CLI flags |
| **API reference** | [bun.com/reference](https://bun.com/reference) | Generated from `bun-types` — signatures, overloads, types |

Top-level reference modules this repo uses most:

| Module | Reference | Guides (when present) |
| ------ | --------- | --------------------- |
| `Bun` (core) | [/reference/bun](https://bun.com/reference/bun) | [runtime](https://bun.com/docs/runtime) |
| `bun:test` | [/reference/bun/test](https://bun.com/reference/bun/test) | [test](https://bun.com/docs/test) |
| `bun:sqlite` | [/reference/bun/sqlite](https://bun.com/reference/bun/sqlite) | [sqlite](https://bun.com/docs/runtime/sqlite) |
| `bun:ffi` | [/reference/bun/ffi](https://bun.com/reference/bun/ffi) | (advanced) |
| Globals | [/reference/globals](https://bun.com/reference/globals) | — |
| Node compat | [/reference/node/…](https://bun.com/reference) (`fs`, `util`, `zlib`, …) | Node docs / Bun notes |

`@see` table: [Canonical `@see` links](#canonical-see-links) (guides primary; reference dual-link for symbols). Standalone repo; monorepo `bun tools/bun-doc-refs.ts` is optional.

Deep dive: [`BUN_SHELL.md`](BUN_SHELL.md) (`Bun.$` patterns)

## Bun APIs overview (official)

**Source:** [Bun APIs](https://bun.com/docs/runtime/bun-apis) · index [llms.txt](https://bun.com/docs/llms.txt) · types [reference](https://bun.com/reference)

Bun implements native APIs on the `Bun` global and built-in modules. Prefer **standard Web APIs** (`Blob`, `URL`, `Request`, `Response`, client `WebSocket`) when they exist; Bun adds surfaces for server-side work where no standard applies (file I/O, HTTP server, SQLite, …).

```ts
// @see https://bun.com/docs/runtime/http/server
// @see https://bun.com/reference/bun/serve
Bun.serve({
  fetch(req: Request) {
    return new Response("Success!");
  },
});
```

Full topic map (guides from the official table; **Ref** = types API; **Here** = used in this repo today):

| Topic | Guide APIs | Ref (when present) | Here |
| ----- | ---------- | ------------------ | ---- |
| HTTP Server | [`Bun.serve`](https://bun.com/docs/runtime/http/server) | [/serve](https://bun.com/reference/bun/serve) | yes — report browser |
| Shell | [`$`](https://bun.com/docs/runtime/shell) | [/$](https://bun.com/reference/bun/$) | yes — **default subprocess transport** · [`BUN_SHELL.md`](BUN_SHELL.md) |
| Bundler | [`Bun.build`](https://bun.com/docs/bundler) | [/build](https://bun.com/reference/bun/build) | rare |
| File I/O | [`Bun.file`](https://bun.com/docs/runtime/file-io#reading-files-bun-file), [`Bun.write`](https://bun.com/docs/runtime/file-io#writing-files-bun-write), `Bun.stdin`/`stdout`/`stderr` | [/file](https://bun.com/reference/bun/file) · [/write](https://bun.com/reference/bun/write) | yes |
| JSONL | [`Bun.JSONL.parse` / `.parseChunk`](https://bun.com/docs/api/jsonl) | [/JSONL](https://bun.com/reference/bun/JSONL/parse) | yes — [`src/lib/jsonl.ts`](../src/lib/jsonl.ts): streaming logs, WS captures, `/api/*.jsonl` endpoints. **Verified gotchas:** (1) `parse()` truncates at the first bad line — does not skip; (2) `parseChunk()` `read` is UTF-8 **bytes** for strings too — never `string.slice(read)` on multibyte; (3) naive `buffer.slice(read)` loops forever on a bad line; (4) `subarray()` retains the parent buffer. Use the lib's skip-and-continue streaming helpers |
| Child Processes | [`Bun.spawn`](https://bun.com/docs/runtime/child-process#spawn-a-process-bun-spawn), [`Bun.spawnSync`](https://bun.com/docs/runtime/child-process#blocking-api-bun-spawnsync) | [/spawn](https://bun.com/reference/bun/spawn) · [/spawnSync](https://bun.com/reference/bun/spawnSync) | yes — keep-list only: IPC, unref, sync, interactive ([`BUN_SHELL.md`](BUN_SHELL.md)) |
| TCP Sockets | [`Bun.listen`](https://bun.com/docs/runtime/networking/tcp#start-a-server-bun-listen), [`Bun.connect`](https://bun.com/docs/runtime/networking/tcp#start-a-server-bun-listen) | [/listen](https://bun.com/reference/bun/listen) · [/connect](https://bun.com/reference/bun/connect) | — |
| UDP Sockets | [`Bun.udpSocket`](https://bun.com/docs/runtime/networking/udp) | [/udpSocket](https://bun.com/reference/bun/udpSocket) | — |
| WebSockets | `new WebSocket()` (client), [`Bun.serve`](https://bun.com/docs/runtime/http/websockets) (server) | — | yes — Kalshi orderbook client |
| Transpiler | [`Bun.Transpiler`](https://bun.com/docs/runtime/transpiler) | [/Transpiler](https://bun.com/reference/bun/Transpiler) | — |
| Routing | [`Bun.FileSystemRouter`](https://bun.com/docs/runtime/file-system-router) | [/FileSystemRouter](https://bun.com/reference/bun/FileSystemRouter) | — |
| Streaming HTML | [`HTMLRewriter`](https://bun.com/docs/runtime/html-rewriter) | — | yes — social/OG meta |
| Headless Browser | [`Bun.WebView`](https://bun.com/docs/runtime/webview) | [/WebView](https://bun.com/reference/bun/WebView) | yes — tennis/liquidity ground, Massey ratings (CF bypass) |
| Terminal/PTY | [`Bun.Terminal`](https://bun.com/docs/runtime/terminal) | [/Terminal](https://bun.com/reference/bun/Terminal) | — (replaces node-pty) |
| Archive | [`Bun.Archive`](https://bun.com/docs/runtime/archive) | [/Archive](https://bun.com/reference/bun/Archive) | yes — `bun:backup` tars research DBs (§22; KNOWN bug: `BunFile` values archive 0-byte, use `.bytes()`) |
| Object Store | [`Bun.S3Client`](https://bun.com/docs/runtime/s3) | [/S3Client](https://bun.com/reference/bun/S3Client) | — |
| JSON5 / JSONC | [`Bun.JSON5.parse`](https://bun.com/docs/runtime/json5) · [`Bun.JSONC.parse`](https://bun.com/docs/runtime/jsonc) | [/JSON5](https://bun.com/reference/bun/JSON5/parse) | JSON5: config; JSONC: tsconfig-style comments |
| Hashing | [`Bun.password`](https://bun.com/docs/runtime/hashing#bun-password), [`Bun.hash`](https://bun.com/docs/runtime/hashing#bun-hash), [`Bun.CryptoHasher`](https://bun.com/docs/runtime/hashing#bun-cryptohasher), `Bun.sha` | [/hash](https://bun.com/reference/bun/hash) · [/CryptoHasher](https://bun.com/reference/bun/CryptoHasher) | yes — cache digests, canary |
| CSRF Protection | [`Bun.CSRF.generate`](https://bun.com/docs/runtime/csrf) / [`.verify`](https://bun.com/docs/runtime/csrf) | [/CSRF](https://bun.com/reference/bun/CSRF) | — (prefer when adding browser forms) |
| SQLite | [`bun:sqlite`](https://bun.com/docs/runtime/sqlite) | [/sqlite](https://bun.com/reference/bun/sqlite) | yes — event-store, research cache (+ drizzle) |
| SQL Client | [`Bun.SQL`](https://bun.com/docs/runtime/sql), `Bun.sql` | [/SQL](https://bun.com/reference/bun/SQL) | — (sqlite + drizzle own this plane) |
| Redis (Valkey) | [`Bun.RedisClient`](https://bun.com/docs/runtime/redis), `Bun.redis` | [/RedisClient](https://bun.com/reference/bun/RedisClient) | — |
| FFI | [`bun:ffi`](https://bun.com/docs/runtime/ffi) | [/ffi](https://bun.com/reference/bun/ffi) | — |
| DNS | [`Bun.dns.lookup`](https://bun.com/docs/runtime/networking/dns), `Bun.dns.prefetch`, `getCacheStats`, `resolveCname/NS/TXT/MX` (runtime-probed; types lag in 1.4.0 → isolated cast) | [/dns](https://bun.com/reference/bun/dns) · [/prefetch](https://bun.com/reference/bun/dns/prefetch) | yes — Kalshi live poll preconnect + host-discover native dig replacement |
| Testing | [`bun:test`](https://bun.com/docs/test) | [/test](https://bun.com/reference/bun/test) · [expectTypeOf](https://bun.com/reference/bun/test/expectTypeOf) | yes — `tests/**` + `*.types.test.ts` |
| Workers | [`new Worker()`](https://bun.com/docs/runtime/workers) | — | — |
| Module Loaders | [`Bun.plugin`](https://bun.com/docs/bundler/plugins) | [/plugin](https://bun.com/reference/bun/plugin) | — |
| Glob | [`Bun.Glob`](https://bun.com/docs/runtime/glob) | [/Glob](https://bun.com/reference/bun/Glob) | yes — watcher, blueprint |
| Cookies | [`Bun.Cookie`](https://bun.com/docs/runtime/cookies), [`Bun.CookieMap`](https://bun.com/docs/runtime/cookies) | [/Cookie](https://bun.com/reference/bun/Cookie) | — |
| Node-API | [Node-API](https://bun.com/docs/runtime/node-api) | — | — |
| `import.meta` | [`import.meta`](https://bun.com/docs/runtime/module-resolution#import-meta) | — | yes — `dir` / `main` |
| Utilities | [`Bun.version`](https://bun.com/docs/runtime/utils#bun-version), [`revision`](https://bun.com/docs/runtime/utils#bun-revision), [`env`](https://bun.com/docs/runtime/utils#bun-env), [`main`](https://bun.com/docs/runtime/utils#bun-main) | [/env](https://bun.com/reference/bun/env) | yes — `Bun.env` |
| Sleep & Timing | [`sleep`](https://bun.com/docs/runtime/utils#bun-sleep), [`sleepSync`](https://bun.com/docs/runtime/utils#bun-sleepsync), [`nanoseconds`](https://bun.com/docs/runtime/utils#bun-nanoseconds) | [/sleep](https://bun.com/reference/bun/sleep) · [/nanoseconds](https://bun.com/reference/bun/nanoseconds) | yes — backoff, phase timing, live poll |
| Random & UUID | [`Bun.randomUUIDv7()`](https://bun.com/docs/runtime/utils#bun-randomuuidv7) | [/randomUUIDv7](https://bun.com/reference/bun/randomUUIDv7) | prefer for new IDs when order matters |
| System | [`Bun.which()`](https://bun.com/docs/runtime/utils#bun-which) | [/which](https://bun.com/reference/bun/which) | yes — preflight `gh` |
| Comparison & Inspection | [`peek`](https://bun.com/docs/runtime/utils#bun-peek), [`deepEquals`](https://bun.com/docs/runtime/utils#bun-deepequals), `deepMatch`, [`inspect`](https://bun.com/docs/runtime/utils#bun-inspect) | [/inspect](https://bun.com/reference/bun/inspect) · [table](https://bun.com/reference/bun/inspect/table) | yes — tables, inspect utils |
| String & Text | [`escapeHTML`](https://bun.com/docs/runtime/utils#bun-escapehtml), [`stringWidth`](https://bun.com/docs/runtime/utils#bun-stringwidth), [`sliceAnsi`](https://bun.com/docs/runtime/utils#bun-sliceansi), `indexOfLine` | [/escapeHTML](https://bun.com/reference/bun/escapeHTML) · [/stringWidth](https://bun.com/reference/bun/stringWidth) · [/sliceAnsi](https://bun.com/reference/bun/sliceAnsi) | yes — TTY + views (replaces slice-ansi / cli-truncate) |
| URL & Path | [`fileURLToPath`](https://bun.com/docs/runtime/utils#bun-fileurltopath), [`pathToFileURL`](https://bun.com/docs/runtime/utils#bun-pathtofileurl) | [/fileURLToPath](https://bun.com/reference/bun/fileURLToPath) | yes |
| Compression | [`gzipSync` / `gunzipSync` / deflate / inflate / **zstd**](https://bun.com/docs/runtime/utils#bun-gzipsync) | [/zstdCompressSync](https://bun.com/reference/bun/zstdCompressSync) | yes — evidence + fantasy gunzip |
| Stream Processing | [`Bun.readableStreamTo*()`](https://bun.com/docs/runtime/utils#bun-readablestreamto) | — | as needed |
| Memory & Buffer | `ArrayBufferSink`, `allocUnsafe`, `concatArrayBuffers` | — | rare |
| Module Resolution | [`Bun.resolveSync()`](https://bun.com/docs/runtime/utils#bun-resolvesync) | [/resolveSync](https://bun.com/reference/bun/resolveSync) | — |
| Parsing & Formatting | [`semver`](https://bun.com/docs/runtime/semver), [`TOML.parse`](https://bun.com/docs/runtime/toml), [`XML`](https://bun.com/docs/runtime/xml), [`markdown`](https://bun.com/docs/runtime/markdown), [`color`](https://bun.com/docs/runtime/color), [`Image`](https://bun.com/docs/runtime/image) | [/markdown](https://bun.com/reference/bun/markdown) · [/color](https://bun.com/reference/bun/color) · [/Image](https://bun.com/reference/bun/Image) | yes — TOML, color, Image, `markdown.ansi` + [`markdownToHtml`](../src/lib/markdown.ts) |
| Low-level / Internals | `mmap`, `gc`, `generateHeapSnapshot`, [`bun:jsc`](https://bun.com/reference/bun/jsc) | [/jsc](https://bun.com/reference/bun/jsc) | — |

Repo-specific wiring (paths, not the full catalog) continues in [Bun API map](#bun-api-map).

## Utils (runtime)

**Source:** [Utils guide](https://bun.com/docs/runtime/utils) · types [reference/bun](https://bun.com/reference/bun) · overview row above under Sleep / Comparison / String / Compression

Native helpers on the `Bun` global. Prefer these over npm packages (`which`, `string-width`, `ms`, `uuid` v4 for sortable IDs, …).

### Identity & entry

| API | Behavior | Repo |
| --- | -------- | ---- |
| `Bun.version` | CLI version string (`"1.3.x"`) | doctor / ground banners when needed |
| `Bun.revision` | Compiled Bun git SHA | diagnostics only |
| `Bun.env` | Alias of `process.env` (auto `.env` load — see [Environment variables](#environment-variables)) | everywhere |
| `Bun.main` | Absolute path of the entry script for this process | prefer with `import.meta.path === Bun.main` **or** the shorter `import.meta.main` (this repo uses **`import.meta.main`** on CLIs) |

```ts
// @see https://bun.com/docs/runtime/utils#bun-main
// @see https://bun.com/docs/runtime/module-resolution#import-meta
if (import.meta.main) {
  // CLI entry — same intent as import.meta.path === Bun.main
  await main();
}
```

### Sleep & timing

| API | Notes | Repo |
| --- | ----- | ---- |
| `Bun.sleep(ms \| Date)` | Async delay; **Date** form resolves *at* that wall time | rate-limit backoff ([`gh.ts`](../src/research/gh.ts)), protonpass retry |
| `Bun.sleepSync(ms)` | **Blocks** the thread — avoid in request paths | rare / scripts only |
| `Bun.nanoseconds()` | Monotonic high-res clock (not wall epoch) | phase timing, live poll, protonpass telemetry · **not** a substitute for [`time-ssot`](TIME.md) event stamps |

```ts
// @see https://bun.com/docs/runtime/utils#bun-sleep
// @see https://bun.com/reference/bun/sleep
await Bun.sleep(1_000);
await Bun.sleep(new Date(Date.now() + 1_000)); // wake at absolute time
```

Domain wall-clock / epoch-ms joins stay in [`src/lib/time-ssot.ts`](../src/lib/time-ssot.ts) (`toEpochMs`, `bookTickClocks`, `watchWindowMs`). Use `nanoseconds` only for **duration** of local work.

### `Bun.which` — executable lookup

Built-in alternative to the `which` npm package. Optional `PATH` / `cwd` override.

```ts
// @see https://bun.com/docs/runtime/utils#bun-which
// @see https://bun.com/reference/bun/which
const gh = Bun.which("gh");
const ls = Bun.which("ls", { PATH: "/usr/local/bin:/usr/bin:/bin" });
```

Used by research preflight and protonpass CLI discovery.

### `Bun.randomUUIDv7` — monotonic IDs

UUID **v7** (timestamp-ordered, crypto random tail). Prefer over `crypto.randomUUID()` (v4) when inserts must sort by time without a separate `created_at` column.

```ts
// @see https://bun.com/docs/runtime/utils#bun-randomuuidv7
// @see https://bun.com/reference/bun/randomUUIDv7
import { randomUUIDv7 } from "bun";

const id = randomUUIDv7();                 // hex string
const buf = randomUUIDv7("buffer");        // 16-byte Buffer
const short = randomUUIDv7("base64url");
```

**Here:** store / order / journal / experiment / lease keys go through
[`mintSortableId()`](../src/lib/ids.ts) → `randomUUIDv7()`. Keep `crypto.randomUUID()` (v4) for pure entropy (temp SSH names, browser HQ form fallback, test temp paths).

### `Bun.peek` — settled-promise fast path

Read a promise result **without** `await` when already fulfilled/rejected. Pending → returns the same promise. Rejected → returns the error **without** marking the promise handled.

```ts
// @see https://bun.com/docs/runtime/utils#bun-peek
// @see https://bun.com/reference/bun/peek
import { peek } from "bun";

peek(Promise.resolve(true));     // true
peek.status(promise);            // "fulfilled" | "pending" | "rejected"
```

Repo: [`bun-settle.ts`](../src/research/bun-settle.ts), research pool / inspect paths. Advanced — do not use as a general `await` replacement.

### `Bun.openInEditor`

Opens a file in `$VISUAL` / `$EDITOR` (or `bunfig.toml` `[debug] editor`, or `{ editor, line, column }`).

```ts
// @see https://bun.com/docs/runtime/utils#bun-openineditor
Bun.openInEditor(import.meta.path, { editor: "vscode", line: 10, column: 5 });
```

Repo: pattern editor jump (`agent patterns --open`).

### `Bun.deepEquals` — structural equality

Powers `expect().toEqual()` / strict mode powers `toStrictEqual()`.

```ts
// @see https://bun.com/docs/runtime/utils#bun-deepequals
Bun.deepEquals(a, b);       // loose (undefined-ish tolerant)
Bun.deepEquals(a, b, true); // strict — undefined keys, sparse arrays, class instances
```

Repo: inspect cache equality ([`inspect-utils.ts`](../src/research/inspect-utils.ts)).

### String / TTY utils

| API | Role | Repo |
| --- | ---- | ---- |
| `Bun.escapeHTML` | Escape `<>&"'` — high throughput | views / HTML boards |
| `Bun.stringWidth` | Terminal column width (ANSI/emoji/wide); ~SIMD native | table alignment |
| `Bun.wrapAnsi` | Soft/hard wrap with ANSI-aware columns | report-term, terminal-out |
| `Bun.stripANSI` | Strip escape sequences | width-safe plain text |
| `Bun.inspect` / `.table` | Pretty print + tabular string | analyze desks, protonpass health |

```ts
// @see https://bun.com/docs/runtime/utils#bun-stringwidth
// @see https://bun.com/reference/bun/stringWidth
Bun.stringWidth("hello");                              // 5
Bun.stringWidth("\u001b[31mhello\u001b[0m");           // 5 (ANSI ignored)
Bun.stringWidth("\u001b[31mhello\u001b[0m", { countAnsiEscapeCodes: true }); // 12
```

**Do not** add `string-width` / `wrap-ansi` npm packages.

### Compression (utils plane)

`gzipSync` / `gunzipSync` / deflate / inflate / **zstd** sync+async — see overview Compression row. Repo uses **zstd** for audit evidence and **gunzip** on fantasy coefficients wire.

### `Bun.markdown` — native Markdown → HTML / ANSI

Zero-dependency parser. Prefer [`src/lib/markdown.ts`](../src/lib/markdown.ts) over ad-hoc options.

```ts
// @see https://bun.com/docs/runtime/markdown
// @see https://bun.com/reference/bun/markdown/html
import { markdownToHtml, markdownToAnsi } from '../src/lib/markdown.ts';

markdownToHtml(md);              // preset: docs (GFM + tagFilter + autolinks + heading ids)
markdownToHtml(md, 'dashboard'); // production boards: + noHtmlBlocks
markdownToHtml(md, 'strict');    // + noHtmlSpans
markdownToHtml(md, 'gfm');       // GFM + safety only
markdownToAnsi(md);              // TTY reports (same engine as report-term)
```

**Full options** ([docs](https://bun.com/docs/runtime/markdown#options)):

| Option | Default | Description |
| ------ | ------- | ----------- |
| `tables` | `true` | GFM tables |
| `strikethrough` | `true` | `~~text~~` |
| `tasklists` | `true` | `- [x]` |
| `autolinks` | `false` | URLs / emails / www. (`true` or `{ url, www, email }`) |
| `headings` | `false` | IDs / autolink (`true` or `{ ids, autolink }`) |
| `hardSoftBreaks` | `false` | Soft breaks → hard |
| `wikiLinks` | `false` | `[[wiki]]` |
| `underline` | `false` | `__text__` → `<u>` |
| `latexMath` | `false` | `$…$` / `$$…$$` |
| `collapseWhitespace` | `false` | Collapse text whitespace |
| `permissiveAtxHeaders` | `false` | `#no-space` headers |
| `noIndentedCodeBlocks` | `false` | Disable indented fences |
| `noHtmlBlocks` | `false` | Strip HTML blocks |
| `noHtmlSpans` | `false` | Strip inline HTML |
| `tagFilter` | `false` | Escape disallowed tags (`<script>`, …) |

**Presets in repo:**

| Preset | Use |
| ------ | --- |
| `gfm` | Safe GFM (tagFilter + autolinks) |
| `docs` | Artifacts / COLORS.html (heading ids + autolink headings) |
| `dashboard` | Boards: docs-like + `noHtmlBlocks` |
| `strict` | Untrusted paste: + `noHtmlSpans` |

| Surface | API | Repo |
| ------- | --- | ---- |
| Terminal reports | `Bun.markdown.ansi` / `markdownToAnsi` | [`report-term.ts`](../src/agent/report-term.ts) |
| Doc HTML artifacts | `markdownToHtml` | [`markdown.ts`](../src/lib/markdown.ts), `colors:artifacts` |

**vs Node ecosystem:** `marked` / `markdown-it` / `remark` add parse plugins and weight. For GFM tables/tasks + safe HTML, Bun is enough — do not add those packages.

### `bun:jsc` (low-level)

| API | Use |
| --- | --- |
| `serialize` / `deserialize` | Structured clone into SharedArrayBuffer (same algorithm as `postMessage`) |
| `estimateShallowMemoryUsageOf` | Best-effort shallow bytes; for deep heaps use `Bun.generateHeapSnapshot` |

Not required for desk paths; keep behind diagnostics.

## Environment variables

[@see Bun docs](https://bun.com/docs/runtime/environment-variables) · [Configuring Bun](https://bun.com/docs/runtime/environment-variables#configuring-bun) · index: [llms.txt](https://bun.com/docs/llms.txt)

| Concern | Practice in this repo |
|---------|------------------------|
| Load `.env` | **Automatic** — no `dotenv` / `dotenv-expand` |
| Precedence | `.env` → `.env.{NODE_ENV}` → `.env.local` (later wins) |
| Read | `Bun.env.KEY` (≡ `process.env` ≡ `import.meta.env`) |
| Types | `declare module "bun" { interface Env { … } }` in [`config.ts`](../src/lib/config.ts) |
| CLI override | `bun --env-file=.env.ci run …` · disable defaults: `--no-env-file` |
| bunfig | `env = false` disables auto `.env` (explicit `--env-file` still loads) |
| Expansion | `BAR=hello$FOO` in `.env`; escape with `\$` |
| Print | `bun --print process.env` |
| Config overrides | `KALSHI__SECTION__KEY=…` → TOML via [`loadConfig`](../src/lib/config.ts) |
| Secrets | Proton Pass inject → `.env` (gitignored); see [`PROTONPASS.md`](PROTONPASS.md) |

**Configuring Bun** knobs typed on `Env`: `BUN_OPTIONS`, `BUN_CONFIG_VERBOSE_FETCH`, `BUN_RUNTIME_TRANSPILER_CACHE_PATH`, `BUN_CONFIG_MAX_HTTP_REQUESTS`, `BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD`, `NO_COLOR` / `FORCE_COLOR`, `TMPDIR`, `DO_NOT_TRACK`, `NODE_TLS_REJECT_UNAUTHORIZED`.

Template: [`.env.example`](../.env.example). Smoke: `bun test tests/lib/bun-env.test.ts`.

## Color · dep-update visuals · social HTML

| Doc | What | Repo |
|-----|------|------|
| [runtime/color](https://bun.com/docs/runtime/color) | `Bun.color(input, format)` — css/ansi/hex/`{rgb}`/… | [`src/lib/color/`](../src/lib/color/) · facade [`design-colors.ts`](../src/lib/design-colors.ts) |
| [update § visual indicators](https://bun.com/docs/pm/cli/update#visual-indicators) | red major / yellow minor / green patch · □/■ selection | `COLORS.semverMajor|Minor|Patch` + `paintSemverChange()` |
| [HTMLRewriter social meta](https://bun.com/docs/guides/html-rewriter/extract-social-meta#extract-social-share-images-and-open-graph-tags) | OG + Twitter + title/description fallbacks | [`src/lib/extract-social-meta.ts`](../src/lib/extract-social-meta.ts) · `bun run social:meta [url]` · `bun run glossary:urls:og` |
| Operator CLI | interactive dep review | `bun update -i` · monorepo: `bun update -i -r` |
| Colorized outdated | `bun outdated` + semver paint | `bun run deps:outdated` · `deps:outdated:latest` · monorepo `bun run deps:outdated` (all workspaces) |
| Color bake gate | palette → CSS/JSON/MD | `bun run colors:artifacts` · `colors:check` (pre-commit when color staged) |

```ts
import { paintSemverChange, cssColor, ansi16mColor } from "../src/lib/color/index.ts";
console.log(paintSemverChange("major", "react 17 → 18")); // red
console.log(ansi16mColor("tennis"));                     // true-color open seq
console.log(cssColor("kalshi"));                         // "#7dd3fc" (cached)
// CLI: bun run deps:outdated · bun run deps:outdated:latest
```

## Verified Bun 1.4 patterns (2026-08-22, probe-backed)

Facts below were verified against the running Bun 1.4.0 binary this session;
each has a real consumer in the repo where marked.

### Color: Bun.color is a full conversion library, not just ANSI

- 14 output formats: css, ansi, ansi-16, ansi-256, ansi-16m, number, rgb,
  rgba, hsl, hex, HEX, {rgb}, {rgba}, [rgb], [rgba]. Replaces the npm color /
  tinycolor2 packages. Any CSS-parsable input (names, hex, rgb()/hsl()/lab(),
  objects, arrays, numbers).
- "ansi" auto-detects color depth FROM ENVIRONMENT: NO_COLOR=1 disables,
  FORCE_COLOR=1|2|3 forces on (16/256/truecolor) and WINS over NO_COLOR;
  unset = auto ("" when stdout lacks color support). TERM/COLORTERM/
  CLICOLOR_FORCE alone do NOT enable color in non-TTY.
- Bundle-time macro for client code: import { color } from "bun" with
  { type: "macro" } -> inlines plain literals (see browser-constants.ts).

      // verified: kernel caches every deterministic format at load
      Bun.color("trading", "css")  // "#e74c3c"
      Bun.color("#3498db", "{rgb}") // { r: 52, g: 152, b: 219 }
      Bun.color("red", "ansi-256") // "\x1b[38;5;196m"

### TOML: strict parser (1.4) + Temporal datetimes

- 1.4 throws SyntaxError on unquoted strings, missing newlines, unsafe
  integers; RangeError on deep nesting. All 10 repo .toml files pass.
- BARE datetimes become Temporal objects (Instant / PlainDateTime /
  PlainDate / PlainTime); QUOTED values stay strings. Gotcha: a future bare
  datetime in a seed/config yields Temporal, not string.
- import attribute: import cfg from "./x.conf" with { type: "toml" } (static
  or dynamic import(..., { with: { type: "toml" } })) — for non-.toml files.
- TOML.stringify skips undefined/function/symbol, throws on null/BigInt/
  circular; writes scalars then [table] then [[array-of-tables]].

### Semver: node-semver compatible, ~20x faster

      Bun.semver.satisfies("1.0.0", "^1.0.0"); // true
      versions.sort(Bun.semver.order);         // correct semver sort

- order() is prerelease-aware: order("2.1.0-beta.1", "2.1.0") -> -1.
  Consumers: bun-security-scanner (satisfies), scripts/deps-outdated.ts
  (order — same-core prerelease diffs classify as patch, fixed 2026-08-22).

### Terminal gate patterns (tools/pre-commit.ts)

- Bun.which("bun") resolves the runtime; Bun.spawnSync for one-shot git
  reads (src/lib/rg.ts + src/lib/breaking-audit.ts use the same sync-site
  pattern); Bun.color("ansi") + Bun.inspect.table(rows, { colors }) honor
  FORCE_COLOR; Bun.nanoseconds for timing. node:child_process is
  guard-banned (BANNED_PACKAGES) — subprocesses go through Bun APIs only.
  See commit history 2026-08-22.

### Inspect depth semantics (verified 2026-08-22)

- console.log honors [console] depth in bunfig.toml (this repo: 3) and the
  bun --console-depth N flag; truncates with [Object ...].
- Bun.inspect(value) does NOT honor console.depth — it always serializes at
  full depth (docs claim otherwise; verified on 1.4.0 with and without bunfig).
- Bun.inspect(value, { depth }) is the ONLY per-call bound; our inspectValue
  helper passes depth through (inspectValue(x, { depth: 2 })).

### Production inspect patterns (2026-08-22)

- Secret Redactor: src/lib/redact.ts redactSecrets(value) — recursive, NON-
  mutating deep clone with password/token/secret/api-key keys replaced by a
  marker; circular refs -> [Circular]; Date/typed arrays pass through. Wire:
  error dumps JSON.stringify({ ok:false, ...redactSecrets(wire) }) keep the
  JSON shape but never leak credentials (research + agent CLIs).
- inspectRedacted(value, opts): Bun.inspect over the redacted clone.
- Context-aware verbosity: inspectValue(value, { verbose: true|false }) — true
  = full depth + colors (DEBUG dumps), false = compact depth 2 plain;
  unset honors colors/depth as given.
- redactSecrets typing: RedactedClone<T> mapped type mirrors the redacted
  shape (secret-keyed props become the marker type; template-literal key
  check with Camel/Pascal variants — approximation of the case-insensitive
  runtime regex); depth option bounds recursion ([DepthLimit] past the cap).
- redactSecrets also redacts URL string VALUES carrying secret query
  params (cheap pre-check: string contains :// and ?) — e.g. callbackUrl
  "https://x/api?token=SECRET" -> token redacted. No type change (string
  stays string).
- redactUrlParams(url): stubs sensitive query keys (gsid/token/...) — wired
  into PandoraSocket display (key visible, value redacted).
- printf-style lines: formatLine / formatLineColor (%s, %d, %o via
  util.formatWithOptions; colors apply to object values).
- Bun.deepMatch(subset, actual): native subset matcher (OBJECT order is
  subset-first; arrays match exactly) — used in redaction tests.
- console is an AsyncIterable: src/lib/readline.ts readLine/confirmYes read
  stdin lines with a no-newline prompt (no readline dependency); injectable
  source, default value on empty input, and timeoutMs that aborts safely
  (auto-false) so scripts never hang. Consumers: tools/kalshi-rotate-key.ts
  (live key rotation confirm, --yes skips) and tools/db-push-gate.ts
  (db:push schema apply confirm, --yes / DB_PUSH_YES=1 skips).
- inspectValue supports sorted (verified); maxArrayLength/maxStringLength are
  NOT supported at runtime — do not pass them.
- [Bun.inspect.custom] hooks typed with the real 3-arg contract
  (depth, options, inspect) across all redacted classes.
- The 3-arg recurse power move (depth, opts, inspect) — used for custom tree
  formatting (e.g. FileNode); the redactor achieves the same via cloning
  instead of recursion-through-inspect.

### Bun.inspect.custom pattern (redaction-first)

- Any class holding secrets or large state implements [Bun.inspect.custom]()
  so console.log / Bun.inspect prints a compact, safe form automatically.
- Secret-bearing classes redact: CookieJar -> CookieJar(N cookies);
  FantasyUltraAdapter -> token=set|unset (credentials never printed);
  PandoraSocket -> host + state (gsid/query params stripped).
- Noisy value-types compact: CoefficientStore -> CoefficientStore(N events).
- Test rule: Bun.inspect(instance) contains the compact form AND NOT the
  secret values (see tests/partner/fantasy-ultra/redaction.test.ts).

### Markdown .md loader trap

- import html from "./x.md" renders with DEFAULT options — no tagFilter, so
  raw <script> passes through. Keep markdownToHtml presets (tagFilter) for
  untrusted/operator input; loader only for trusted defaults.

## `bunx` — zero-install CLI tools

For dev-time or one-off utilities, prefer `bunx` over adding to `package.json`:

```bash
# Schema introspection / migration (dev only — not in package.json deps)
bunx drizzle-kit generate   # generate migration from schema.ts
bunx drizzle-kit push       # push schema to DB
bunx drizzle-kit studio     # browse tables in browser

# Lint / audit (run on demand)
bunx @biomejs/biome check src/
bunx knip                   # find unused exports
```

Rule: if a tool is **not needed for a reproducible local or CI check**, keep it out of `dependencies`/`devDependencies` and use `bunx`. The compiler and Bun types remain pinned dev dependencies because `bun run typecheck` must not borrow them from a parent workspace.

## Drizzle ORM — type-safe SQLite

This project uses **`drizzle-orm`** (~12 KB runtime) over `bun:sqlite` for type-safe queries. `drizzle-kit` is **never** a project dependency — run it via `bunx`.

| Layer | File | Role |
|-------|------|------|
| Schema SSOT | [`src/db/schema.ts`](../src/db/schema.ts) | Drizzle table definitions (parallel to `schema.sql`) |
| Client | [`src/db/client.ts`](../src/db/client.ts) | `drizzle(bun:sqlite)` wrapper with lazy init + reset for tests |
| Raw SQL fallback | [`open-db.ts`](../src/institutions/event-store/open-db.ts) | Existing `db.query()` / `db.run()` still works |

**Query examples:**

```typescript
import { db, schema } from "../db/client.ts";
import { eq, gt, and } from "drizzle-orm";

// Type-safe select
const itfEvents = await db
  .select()
  .from(schema.events)
  .where(eq(schema.events.tour, "ITF-M"));

// Relational: events with their markets
const eventWithMarkets = await db.query.events.findMany({
  where: eq(schema.events.tour, "ITF-M"),
  with: { markets: true },   // defined in schema relations
});

// Aggregate
const topPlayers = await db
  .select()
  .from(schema.playerProfiles)
  .where(gt(schema.playerProfiles.winRate, 0.6))
  .orderBy(schema.playerProfiles.avgKalshiVolumeFp);
```

**Migration workflow (dev-only, via bunx):**

```bash
# 1. Edit src/db/schema.ts
# 2. Generate migration
bunx drizzle-kit generate

# 3. Push to local DB
bunx drizzle-kit push

# 4. (Optional) browse
bunx drizzle-kit studio
```

Legacy raw SQL in `kalshi-itf-sync.ts`, `cache.ts`, etc. is preserved — Drizzle is additive, not a rewrite mandate.

Deep dive: [`BUN_SHELL.md`](BUN_SHELL.md) (`Bun.$` patterns)

## Bun API map

| Capability | Runtime utility | Used in |
|------------|-----------------|---------|
| Subprocess / `gh` calls | `Bun.$` + `.json()` / `.text()` via `.nothrow().quiet()` | [`gh.ts`](../src/research/gh.ts) (rate_limit + auth token) |
| GitHub REST + code search | `Bun.fetch` + `fetch.preconnect` / `dns.prefetch` | [`github-api.ts`](../src/research/github-api.ts), [`github-search.ts`](../src/research/github-search.ts), [`github-network.ts`](../src/research/github-network.ts) |
| Offline dry-run | `search_cache` + synthetic quota | [`cli.ts`](../src/research/cli.ts) `--dry-run --offline` / `bun run research:dry` |
| Test cache isolation | `RESEARCH_CACHE_DB=:memory:` (exact) + `resetCacheDbConnection`; suite runs with `bun test --isolate`. Named `:memory:…` paths are cwd files — use [`tests/tmp-db.ts`](../tests/tmp-db.ts) instead. | [`cache.ts`](../src/research/cache.ts), [`tests/temp-cache.ts`](../tests/temp-cache.ts) |
| Preflight `gh` on PATH | `Bun.which("gh")` | [`preflight.ts`](../src/research/preflight.ts) |
| Config load | `Bun.file(…).json()` | [`discover.ts`](../src/research/discover.ts) |
| Artifact write | `Bun.write` | [`io.ts`](../src/research/io.ts), [`report.ts`](../src/research/report.ts) |
| CLI JSON stdout | `Bun.write(Bun.stdout, …)` | [`cli.ts`](../src/research/cli.ts) |
| Env overrides | `Bun.env` (`RESEARCH_*`, `KALSHI__*`) | [`cli.ts`](../src/research/cli.ts), [`config.ts`](../src/lib/config.ts) |
| Package-root paths | `import.meta.dir` | [`paths.ts`](../src/research/paths.ts) |
| CLI entry guard | `import.meta.main` + `#!/usr/bin/env bun` | [`cli.ts`](../src/research/cli.ts) |
| Embedded cache + run history | `bun:sqlite` + `Bun.hash` | [`cache.ts`](../src/research/cache.ts) |
| Inspect cache equality | `Bun.deepEquals` + `Bun.inspect` | [`inspect-utils.ts`](../src/research/inspect-utils.ts), [`bun-native.ts`](../src/research/bun-native.ts) |
| HTML escaping | `Bun.escapeHTML` | [`bun-native.ts`](../src/research/bun-native.ts), [`views.ts`](../src/research/views.ts) |
| Evidence compression | `Bun.zstdCompressSync` / `decompress` | [`evidence-io.ts`](../src/research/evidence-io.ts), [`export-audit.ts`](../src/research/export-audit.ts) |
| Pattern editor jump | `Bun.openInEditor` | [`pattern-editor.ts`](../src/agent/pattern-editor.ts), [`agent/cli.ts`](../src/agent/cli.ts) |
| Rate-limit backoff | `Bun.sleep` | [`gh.ts`](../src/research/gh.ts) |
| Bounded concurrency | [`pool.ts`](../src/research/pool.ts) + `Bun.peek` | [`cli.ts`](../src/research/cli.ts), [`inspect.ts`](../src/research/inspect.ts) |
| Settled-promise fast path | `Bun.peek` / `peek.status` | [`bun-settle.ts`](../src/research/bun-settle.ts) |
| Scheduled research | OS-level `Bun.cron` + `.parse` / `.remove` | [`scheduled.ts`](../src/research/scheduled.ts), [`schedule-cli.ts`](../src/research/schedule-cli.ts) |
| Tennis / toxicity OS cron | `Bun.cron` + `export default { scheduled }` | [`ws-recorder-scheduled.ts`](../tools/tennis/ws-recorder-scheduled.ts), [`live-canary-scheduled.ts`](../tools/tennis/live-canary-scheduled.ts), [`toxicity-scheduled.ts`](../src/calibration/toxicity-scheduled.ts), tennis/toxicity `*-schedule-cli.ts` |
| Audit digests | `Bun.CryptoHasher("sha3-256")` | [`audit-adapter.ts`](../src/research/audit-adapter.ts), [`export-audit.ts`](../src/research/export-audit.ts) |
| GitHub URL SSOT | `BunURLPattern` + `URLPattern` ([v1.3.4+](https://bun.com/blog/bun-v1.3.4#urlpattern-api)) | [`patterns.ts`](../src/research/patterns.ts) |
| Report browser | `Bun.serve` routes + `Bun.file` | [`serve.ts`](../src/research/serve.ts), [`views.ts`](../src/research/views.ts) |
| Agent CLI | status / patterns / blueprint / tennis over `cache.db` + event-store | [`cli.ts`](../src/agent/cli.ts), [`docs/AGENT.md`](../docs/AGENT.md) |
| Kalshi live poll | `dns.prefetch` + `fetch.preconnect` + `mapPool` + `Bun.nanoseconds` | [`kalshi-network.ts`](../src/bot/kalshi-network.ts), [`live-scores.ts`](../src/institutions/event-store/live-scores.ts) |
| Tennis canary artifacts | `Bun.write` + `Bun.hash` under `research/cache/tennis-canary/` | [`live-canary-store.ts`](../src/institutions/event-store/live-canary-store.ts) |
| Tennis WS dashboard ground | `Bun.WebView` (`backend`: webkit on macOS, chrome elsewhere; `url` + `data:text/html`) + `Bun.file().image()` chain; persisted `snapshotMeta` uses native WebView constructor and `Bun.Image.metadata()` return types | [`tennis-ws-ground.ts`](../src/institutions/event-store/tennis-ws-ground.ts), [`visual-snapshot-meta.ts`](../src/institutions/event-store/visual-snapshot-meta.ts), [`tennis-ws-dashboard.ts`](../src/institutions/event-store/tennis-ws-dashboard.ts), [`tennis-book-coverage.ts`](../src/institutions/event-store/tennis-book-coverage.ts) |
| Match liquidity ground | Same typed WebView + Image metadata pipeline over `match_liquidity` KPIs | [`match-liquidity-ground.ts`](../src/institutions/event-store/match-liquidity-ground.ts), [`visual-snapshot-meta.ts`](../src/institutions/event-store/visual-snapshot-meta.ts), [`match-liquidity-dashboard.ts`](../src/institutions/event-store/match-liquidity-dashboard.ts), `bun run liquidity:ground` · snapshot: `tools/snapshot-data-plane.ts` `liquidity` block |
| Partner WebView CDP capture | Native `Bun.WebView.addEventListener<T>()`; a local structural adapter validates `data`/`detail` because Bun 1.3.x-era types expose the documented callback event as `typeof MessageEvent` during TS resolution. No ambient `Bun` augmentation. | [`webview-ws-capture.ts`](../src/partner/webview-ws-capture.ts), [`webview-cdp-events.ts`](../src/partner/webview-cdp-events.ts), `bun run partner:webview-ws-capture` |
| Match liquidity pipeline cron | In-process `Bun.cron` + OS `export default { scheduled }` | [`match-liquidity-pipeline.ts`](../src/institutions/event-store/match-liquidity-pipeline.ts), [`match-liquidity-scheduled.ts`](../tools/match-liquidity-scheduled.ts), `cron:start` · `liquidity:pipeline:register` |
| Match liquidity db watch | `fs.watch` on **cache dir** for `event-store.db` (+ `-wal`/`-shm`) → debounced recompute + HTML ground | pure: [`match-liquidity-db-watch.ts`](../src/institutions/event-store/match-liquidity-db-watch.ts) · CLI: [`tools/match-liquidity-db-watch.ts`](../tools/match-liquidity-db-watch.ts) · `bun run liquidity:ground:watch-db` · `--once` · `--fetch-volume` |
| Kalshi WS orderbook | Bun client `WebSocket` + RSA handshake headers; proxy/TLS types derive from `Bun.WebSocketOptions`. A local constructor cast is isolated at creation because `lib.dom` hides Bun 1.3.x-era options overloads during TypeScript resolution; JSON-only wire; official error codes 1–25; ping keepalive; reconnect jitter; `NO_PROXY` + proxy/TLS env | [`kalshi-ws.ts`](../src/bot/kalshi-ws.ts), [`kalshi-ws-errors.ts`](../src/bot/kalshi-ws-errors.ts), [`kalshi-ws-recorder.ts`](../src/institutions/event-store/kalshi-ws-recorder.ts), [`tennis-ws-recorder-store.ts`](../src/institutions/event-store/tennis-ws-recorder-store.ts) |
| Cadence / scoreboard tables | `Bun.inspect.table` | [`terminal-out.ts`](../src/research/terminal-out.ts), tennis CLI + `agent tennis` |
| Terminal reports | `Bun.markdown.ansi` + `Bun.wrapAnsi` | [`report-term.ts`](../src/agent/report-term.ts) |
| TTY tables + OSC 8 links | `Bun.inspect.table` + `Bun.stringWidth` / `wrapAnsi` / `stripANSI` | [`terminal-out.ts`](../src/research/terminal-out.ts) |
| Phase timings | `Bun.nanoseconds` | [`phase-timing.ts`](../src/research/phase-timing.ts) |
| Agent IPC research progress | `Bun.spawn` + `process.send` | [`research-runner.ts`](../src/agent/research-runner.ts), [`research-progress.ts`](../src/research/research-progress.ts) |
| GitHub rate limit probe | `Bun.fetch` — `readGitHubRateLimitWire()` (no gh subprocess) | [`github-rate-limit.ts`](../src/research/github-rate-limit.ts), [`github-rate-budget.ts`](../tools/github-rate-budget.ts) |
| Repo / alpha file scan | `Bun.Glob` | [`watcher.ts`](../src/calibration/watcher.ts), [`architecture-blueprint.ts`](../src/agent/architecture-blueprint.ts) |
| CLI flags | `parseArgs` from `node:util` | [`cli.ts`](../src/research/cli.ts) |
| Reproducible package install | `bun install --frozen-lockfile` | [`package.json`](../package.json), [`bun.lock`](../bun.lock) |
| Unit tests | `bun:test` + `mock.module()` + `expect` matchers | [`tests/`](../tests/) |
| Type contracts | `expectTypeOf` (compile-time; `bun run typecheck`) | [`*.types.test.ts`](../tests/) e.g. [`time-ssot.types.test.ts`](../tests/lib/time-ssot.types.test.ts), [`snapshot-data-plane.types.test.ts`](../tests/tools/snapshot-data-plane.types.test.ts) |
| Test coverage | `bun run test:coverage` | [`package.json`](../package.json) |

**Pattern excerpts from local clones:** `bun run agent patterns --open` reads source files under `REPO_CLONE_ROOT/{owner}/{repo}` when set (optional — default remains `gh api` reads with no clone). This is an intentional scope extension beyond the original no-clone plan; set `REPO_CLONE_ROOT` only when you maintain local checkouts for excerpt review.

### Canonical `@see` links

**Guides** = narrative (`bun.com/docs/…`). **Ref** = types API (`bun.com/reference/…`, from [bun-types](https://github.com/oven-sh/bun/tree/main/packages/bun-types)). Prefer `// @see <guide>` for agents; add ref when overloads / exact types matter.

| API | Guide | Ref |
|-----|-------|-----|
| Hub | [docs/llms.txt](https://bun.com/docs/llms.txt) | [reference](https://bun.com/reference) |
| `Bun` module | [runtime](https://bun.com/docs/runtime) | [/bun](https://bun.com/reference/bun) |
| `Bun.$` | [shell](https://bun.com/docs/runtime/shell#getting-started) | [/$](https://bun.com/reference/bun/$) |
| `Bun.which` | [utils#which](https://bun.com/docs/runtime/utils#bun-which) | [/which](https://bun.com/reference/bun/which) |
| `Bun.file` | [file-io](https://bun.com/docs/runtime/file-io#reading-files-bun-file) | [/file](https://bun.com/reference/bun/file) |
| `Bun.write` | [file-io#write](https://bun.com/docs/runtime/file-io#writing-files-bun-write) | [/write](https://bun.com/reference/bun/write) |
| Utils hub | [runtime/utils](https://bun.com/docs/runtime/utils) | [/bun](https://bun.com/reference/bun) |
| `Bun.version` | [utils#version](https://bun.com/docs/runtime/utils#bun-version) | [/version](https://bun.com/reference/bun/version) |
| `Bun.revision` | [utils#revision](https://bun.com/docs/runtime/utils#bun-revision) | [/revision](https://bun.com/reference/bun/revision) |
| `Bun.env` / `.env` load | [environment-variables](https://bun.com/docs/runtime/environment-variables) · [utils#env](https://bun.com/docs/runtime/utils#bun-env) | [/env](https://bun.com/reference/bun/env) |
| `Bun.main` | [utils#main](https://bun.com/docs/runtime/utils#bun-main) | [/main](https://bun.com/reference/bun/main) |
| `Bun.sleep` / `sleepSync` | [utils#sleep](https://bun.com/docs/runtime/utils#bun-sleep) · [sleepSync](https://bun.com/docs/runtime/utils#bun-sleepsync) | [/sleep](https://bun.com/reference/bun/sleep) · [/sleepSync](https://bun.com/reference/bun/sleepSync) |
| `Bun.randomUUIDv7` | [utils#randomUUIDv7](https://bun.com/docs/runtime/utils#bun-randomuuidv7) | [/randomUUIDv7](https://bun.com/reference/bun/randomUUIDv7) |
| Configuring Bun (`BUN_*`, `NO_COLOR`, …) | [configuring-bun](https://bun.com/docs/runtime/environment-variables#configuring-bun) | — |
| `Bun.color` | [color](https://bun.com/docs/runtime/color) | [/color](https://bun.com/reference/bun/color) |
| `bun update` interactive visuals | [update § visual](https://bun.com/docs/pm/cli/update#visual-indicators) | — |
| HTMLRewriter social / OG meta | [guide](https://bun.com/docs/guides/html-rewriter/extract-social-meta) | — |
| `HTMLRewriter` | [html-rewriter](https://bun.com/docs/runtime/html-rewriter) | — |
| `Bun.hash` | [hashing](https://bun.com/docs/runtime/hashing#bun-hash) | [/hash](https://bun.com/reference/bun/hash) |
| `Bun.deepEquals` | [utils#deepEquals](https://bun.com/docs/runtime/utils#bun-deepequals) | [/deepEquals](https://bun.com/reference/bun/deepEquals) |
| `Bun.inspect` | [utils#inspect](https://bun.com/docs/runtime/utils#bun-inspect) | [/inspect](https://bun.com/reference/bun/inspect) · [BunInspectOptions](https://bun.com/reference/bun/BunInspectOptions) |
| `Bun.inspect.table` | [utils#table](https://bun.com/docs/runtime/utils#bun-inspect-table-tabulardata-properties-options) | [/inspect/table](https://bun.com/reference/bun/inspect/table) |
| `Bun.peek` | [utils#peek](https://bun.com/docs/runtime/utils#bun-peek) | [/peek](https://bun.com/reference/bun/peek) |
| `Bun.openInEditor` | [utils#openInEditor](https://bun.com/docs/runtime/utils#bun-openineditor) | [/openInEditor](https://bun.com/reference/bun/openInEditor) |
| `Bun.escapeHTML` | [utils#escapeHTML](https://bun.com/docs/runtime/utils#bun-escapehtml) | [/escapeHTML](https://bun.com/reference/bun/escapeHTML) |
| `Bun.zstdCompressSync` | [utils#zstd](https://bun.com/docs/runtime/utils#bun-zstdcompress-bun-zstdcompresssync) | [/zstdCompressSync](https://bun.com/reference/bun/zstdCompressSync) |
| `Bun.zstdDecompressSync` | [utils#zstd](https://bun.com/docs/runtime/utils#bun-zstddecompress-bun-zstddecompresssync) | [/zstdDecompressSync](https://bun.com/reference/bun/zstdDecompressSync) |
| `Bun.fileURLToPath` | [utils#fileURLToPath](https://bun.com/docs/runtime/utils#bun-fileurltopath) | [/fileURLToPath](https://bun.com/reference/bun/fileURLToPath) |
| `Bun.pathToFileURL` | [utils#pathToFileURL](https://bun.com/docs/runtime/utils#bun-pathtofileurl) | [/pathToFileURL](https://bun.com/reference/bun/pathToFileURL) |
| `bun:sqlite` | [sqlite](https://bun.com/docs/runtime/sqlite) | [/sqlite](https://bun.com/reference/bun/sqlite) |
| `import.meta.dir` | [module-resolution](https://bun.com/docs/runtime/module-resolution#import-meta) | — |
| `import.meta.main` | [import.meta](https://bun.com/docs/runtime/module-resolution#import-meta) (CLI entry; ≡ `path === Bun.main`) | — |
| `bun:test` | [test](https://bun.com/docs/test/index#run-tests) · [type testing](https://bun.com/docs/test/writing-tests#type-testing) | [/test](https://bun.com/reference/bun/test) |
| `expect` | [matchers](https://bun.com/docs/test/writing-tests#matchers) | [/test/expect](https://bun.com/reference/bun/test/expect) |
| `expectTypeOf` | [type testing](https://bun.com/docs/test/writing-tests#type-testing) | [/test/expectTypeOf](https://bun.com/reference/bun/test/expectTypeOf) |
| `mock` / `mock.module` | [mocks](https://bun.com/docs/test/mocks) | [/test/mock](https://bun.com/reference/bun/test/mock) |
| `Bun.cron` | [cron](https://bun.com/docs/runtime/cron) | [/cron](https://bun.com/reference/bun/cron) |
| `Bun.cron.parse` / `.remove` | [cron](https://bun.com/docs/runtime/cron) | [/cron](https://bun.com/reference/bun/cron) |
| `Bun.Glob` | [glob](https://bun.com/docs/runtime/glob) | [/Glob](https://bun.com/reference/bun/Glob) |
| `Bun.CryptoHasher` | [hashing#CryptoHasher](https://bun.com/docs/runtime/hashing#bun-cryptohasher) | [/CryptoHasher](https://bun.com/reference/bun/CryptoHasher) |
| `URLPattern` | [blog v1.3.4](https://bun.com/blog/bun-v1.3.4#urlpattern-api) | — |
| `Bun.serve` | [http/server](https://bun.com/docs/runtime/http/server#basic-setup) | [/serve](https://bun.com/reference/bun/serve) |
| `Bun.markdown.ansi` | [markdown#ansi](https://bun.com/docs/runtime/markdown#ansi-terminal-output) | [/markdown/ansi](https://bun.com/reference/bun/markdown/ansi) |
| `Bun.markdown.html` | [markdown#html](https://bun.com/docs/runtime/markdown#bun-markdown-html) · [options](https://bun.com/docs/runtime/markdown#options) | [/markdown/html](https://bun.com/reference/bun/markdown/html) |
| `Bun.stringWidth` | [utils#stringWidth](https://bun.com/docs/runtime/utils#bun-stringwidth) | [/stringWidth](https://bun.com/reference/bun/stringWidth) |
| `Bun.wrapAnsi` | [utils#wrapAnsi](https://bun.com/docs/runtime/utils#bun-wrapansi) | [/wrapAnsi](https://bun.com/reference/bun/wrapAnsi) |
| `Bun.stripANSI` | [utils#stripANSI](https://bun.com/docs/runtime/utils#bun-stripansi) | [/stripANSI](https://bun.com/reference/bun/stripANSI) |
| `Bun.nanoseconds` | [utils#nanoseconds](https://bun.com/docs/runtime/utils#bun-nanoseconds) | [/nanoseconds](https://bun.com/reference/bun/nanoseconds) |
| `Bun.fetch` / `fetch.preconnect` | [fetch](https://bun.com/docs/runtime/networking/fetch#sending-an-http-request) · [preconnect](https://bun.com/docs/runtime/networking/fetch#preconnect-to-a-host) | [/fetch](https://bun.com/reference/bun/fetch) · [dns.prefetch](https://bun.com/reference/bun/dns/prefetch) |
| `Bun.spawn` IPC | [child-process IPC](https://bun.com/docs/runtime/child-process#inter-process-communication-ipc) | [/spawn](https://bun.com/reference/bun/spawn) |
| `Bun.spawn` (pipes) | [spawn](https://bun.com/docs/runtime/child-process#spawning-a-process-bun-spawn) | [/spawn](https://bun.com/reference/bun/spawn) |
| `Bun.Terminal` (PTY) | [terminal PTY](https://bun.com/docs/runtime/child-process#terminal-pty-support) | [/Terminal](https://bun.com/reference/bun/Terminal) |
| `Bun.spawnSync` | [spawnSync](https://bun.com/docs/runtime/child-process#blocking-api-bun-spawnsync) | [/spawnSync](https://bun.com/reference/bun/spawnSync) |
| `Bun.WebView` | [webview](https://bun.com/docs/runtime/webview) | [/WebView](https://bun.com/reference/bun/WebView) |
| `Bun.Image` | [image](https://bun.com/docs/runtime/image) | [/Image](https://bun.com/reference/bun/Image) |
| Client `WebSocket` (headers, `proxy`) | [websockets](https://bun.com/docs/runtime/http/websockets) · [proxy v1.3.6](https://bun.com/docs/blog/bun-v1.3.6#httphttps-proxy-support-for-websocket) | — |
| `bun install` | [install](https://bun.com/docs/pm/cli/install) | — |
| `bun.lock` / lockfile | [lockfile](https://bun.com/docs/pm/lockfile) | — |
| `bunfig.toml` `[install]` | [bunfig](https://bun.com/docs/runtime/bunfig) | — |
| Isolated installs | [isolated-installs](https://bun.com/docs/pm/isolated-installs) | — |
| `Buffer.indexOf` / `Buffer.includes` | [blog v1.3.6](https://bun.com/docs/blog/bun-v1.3.6#faster-bufferindexof) | [node:buffer](https://bun.com/reference/node/buffer) |
| `bun test --grep` | [blog v1.3.6](https://bun.com/docs/blog/bun-v1.3.6#grep-flag-for-bun-test) | — |
| `Response.json()` perf | [blog v1.3.6](https://bun.com/docs/blog/bun-v1.3.6#responsejsonobject-is-now-35x-faster) | — |

## Runtime notes (Bun v1.3.6+)

### Faster `Response.json()`

`Response.json()` now uses JavaScriptCore’s SIMD-optimized **FastStringifier** (v1.3.6+). Before, it was much slower than `new Response(JSON.stringify(obj))`; they are now at parity on large payloads.

```typescript
const obj = {
  items: Array.from({ length: 100 }, (_, i) => ({ id: i, value: `item-${i}` })),
};

Response.json(obj);                      // preferred — sets Content-Type
new Response(JSON.stringify(obj));       // equivalent perf after v1.3.6
```

| Approach | Before (v1.3.5) | After (v1.3.6) |
|----------|-----------------|----------------|
| `Response.json()` | 2415 ms | ~700 ms |
| `JSON.stringify()` + `new Response()` | 689 ms | ~700 ms |
| Ratio | **3.50× slower** | **~1.0× (parity)** |

**This repo:** [`serve.ts`](../src/research/serve.ts) already uses `Response.json(data, { status })` for JSON routes. Test mocks still use `new Response(JSON.stringify(…))` — fine on v1.3.6+; no need to rewrite unless you want explicit `Content-Type`. See [Bun v1.3.6 — Response.json() is now 3.5× faster](https://bun.com/docs/blog/bun-v1.3.6#responsejsonobject-is-now-35x-faster).

### Faster `Buffer.indexOf` / `Buffer.includes`

`Buffer.indexOf` and `Buffer.includes` use SIMD-optimized search (v1.3.6+). Largest wins on **large buffers** and **miss paths** (pattern not found) — up to ~2× in Bun’s benchmark (~44 KB buffer, 99,999 iterations):

| Case | Bun 1.3.5 | Bun 1.3.6 |
|------|-----------|-----------|
| `.includes` true | 25.52 ms | 21.90 ms |
| `.includes` false | 3.25 s | 1.42 s |

```typescript
const buffer = Buffer.from("a".repeat(1_000_000) + "needle");

buffer.indexOf("needle");   // single- and multi-byte patterns
buffer.includes("needle");
```

**This repo:** no `Buffer.indexOf` / `includes` call sites today. Prefer these over manual byte scans when parsing binary wire (WS frames, tarball sniffing, etc.). See [Bun v1.3.6 — Faster Buffer.indexOf](https://bun.com/docs/blog/bun-v1.3.6#faster-bufferindexof).

### WebSocket `proxy` option (HTTP/HTTPS)

Bun’s client `WebSocket` constructor accepts a `proxy` option (v1.3.6+) for corporate / gated networks.

```typescript
// Simple proxy URL
new WebSocket("wss://example.com", {
  proxy: "http://proxy:8080",
});

// With authentication
new WebSocket("wss://example.com", {
  proxy: "http://user:pass@proxy:8080",
});

// Object format with custom headers
new WebSocket("wss://example.com", {
  proxy: {
    url: "http://proxy:8080",
    headers: { "Proxy-Authorization": "Bearer token" },
  },
});

// HTTPS proxy with TLS options
new WebSocket("wss://example.com", {
  proxy: "https://proxy:8443",
  tls: { rejectUnauthorized: false },
});
```

All combinations of `ws://` and `wss://` connections through both HTTP and HTTPS proxies are supported, along with Basic authentication and custom proxy headers. The `tls` option now also supports full TLS configuration (`ca`, `cert`, `key`, `passphrase`, etc.) matching the options available in `fetch`.

| Option | Type | Purpose |
|--------|------|---------|
| `ca` | string / Buffer / BunFile / array | Trust store (replaces default Mozilla CAs when set) |
| `cert` | string / Buffer / BunFile / array | Client certificate chain (PEM) |
| `key` | string / Buffer / BunFile / `{ pem, passphrase? }[]` | Private key(s) |
| `passphrase` | string | Decrypt encrypted `key` PEM |
| `rejectUnauthorized` | boolean | `false` accepts any cert (dev/self-signed) |
| `checkServerIdentity` | function | Custom hostname validation (**fetch only**) |
| `serverName` | string | TLS SNI override |
| `requestCert` | boolean | Request client cert from server |
| `ciphers` | string | OpenSSL cipher list |
| `secureOptions` | number | `SSL_OP_*` bitmask |
| `ALPNProtocols` | string / Buffer | ALPN negotiation |
| `dhParamsFile` | string | Custom DH params PEM path |
| `clientRenegotiationLimit` / `Window` | number | TLS renegotiation limits |
| `lowMemoryMode` | boolean | `OPENSSL_RELEASE_BUFFERS=1` |

**This repo:** [`kalshi-ws.ts`](../src/bot/kalshi-ws.ts) passes handshake `headers` for Kalshi RSA auth (fresh signature per `connect()`). Wire format is **JSON only** per [Kalshi WS docs](https://docs.kalshi.com/getting_started/quick_start_websockets) — no documented protobuf subprotocols. Server errors use `{ type: "error", msg: { code, msg } }` with codes 1–25 parsed in [`kalshi-ws-errors.ts`](../src/bot/kalshi-ws-errors.ts).

Reliability: client ping every 20s (`pingIntervalMs`); recorder reconnect via `kalshiWsReconnectBackoffMs` (exponential + jitter); `AbortSignal` closes WS on SIGTERM; OS cron via [`ws-recorder-scheduled.ts`](../tools/tennis/ws-recorder-scheduled.ts).

Net env: `resolveKalshiWsNetOptions()` reads `KALSHI_WS_PROXY` → `HTTPS_PROXY` → `HTTP_PROXY`, honoring `NO_PROXY` / `no_proxy` for the WS host (`KALSHI_WS_PROXY` explicit override wins). TLS via `KALSHI_WS_TLS_*` (`REJECT_UNAUTHORIZED`, `CA_FILE`, `CERT_FILE`, `KEY_FILE`, `PASSPHRASE`, `SERVER_NAME`, `CIPHERS`) in `defaultWsFactory`. Per-instance override via constructor `net: { proxy, tls }`; full control with injectable `wsFactory`.

See [Bun v1.3.6 — HTTP/HTTPS Proxy Support for WebSocket](https://bun.com/docs/blog/bun-v1.3.6#httphttps-proxy-support-for-websocket) · [WebSocket client](https://bun.com/docs/runtime/http/websockets).

## Cache: `bun:sqlite` not JSON blobs

[`research/cache/cache.db`](../research/cache/cache.db) (gitignored) replaces per-file JSON under `research/cache/`.

```sql
-- api_cache: hash = Bun.hash(repo + endpoint + pushed_at), TTL on expires_at
-- runs: full ResearchRun payloads keyed by run_id
```

Benefits:

- Transactional read/write
- Queryable: `searchCachedPayloads("readme", "websocket")` 
- Run IDs stored for `--diff <run-id>` against any historical run

## Modules

### [`gh.ts`](../src/research/gh.ts) — subprocess SSOT

See [`BUN_SHELL.md`](BUN_SHELL.md).

### [`cache.ts`](../src/research/cache.ts) — sqlite SSOT

```typescript
// @see https://bun.com/docs/runtime/sqlite
await withCache(repo, pushedAt, "readme", fetcher);
saveRun(runId, generatedAt, run);
```

### [`preflight.ts`](../src/research/preflight.ts)

```typescript
// @see https://bun.com/docs/runtime/utils#bun-which
Bun.which("gh") ?? throw
```

### [`patterns.ts`](../src/research/patterns.ts) — URL SSOT

One `BunURLPattern` for `github.com/:owner/:repo` serves **three consumers**:

1. **Discover** — normalize `.git`, deep `/tree/…` links; URL wins over bad `gh` `fullName`
2. **Reports** — `githubRepoWebUrl()` + `localRepoPath()` from capture groups (no ad-hoc concat)
3. **Serve** — `/repo/:owner/:name` route matches the same shape

```typescript
const ref = parseGitHubRepoRef(url);
const web = githubRepoWebUrl(ref.owner, ref.repo);
const local = localRepoPath(ref.owner, ref.repo); // → /repo/:owner/:name
```

### [`serve.ts`](../src/research/serve.ts) — report browser

`bun run serve` (`bun --hot`) — no router package; `Bun.serve` routes +
**two v1.4 static dir mounts** for baked artifacts:

| Route | Source |
|-------|--------|
| `/` | latest shortlist + diff excerpt + run history |
| `/api/runs` | run summaries JSON |
| `/api/runs/:id` | full run JSON |
| `/repo/:owner/:name` | repo detail (`?run=` for historical) |
| `/reports/latest.md` | `Bun.file(research/reports/latest.md)` |
| `/registry/*` | `{ dir: public/registry }` — sendfile + ETag + 304 + Range |
| `/partner-dashboard/*` | `{ dir: public/partner-dashboard }` — index.html auto |

`process.on('memoryPressure')` (v1.4): `createResearchServer` clears the
book/source-catalog/auth/tennis-board caches on `critical` (see
`docs/AGENT-PITFALLS.md` §21).

HTML lives in [`views.ts`](../src/research/views.ts) — handlers in [`serve.ts`](../src/research/serve.ts) stay thin.

## Terminal: three layers (PTY vs IPC vs parent TTY)

Bun exposes **three separate terminal mechanisms**. This repo uses layer 1 and 2; layer 3 is optional for a future interactive agent shell.

| Layer | API | Who has `isTTY` | Used here for |
|-------|-----|-----------------|---------------|
| **1 — Parent stdout** | `Bun.inspect.table`, `Bun.stringWidth` / `wrapAnsi` / `stripANSI`, `Bun.markdown.ansi` | The **bun research/agent** process you run in Terminal/iTerm | Shortlist tables, lift map, `report:term` |
| **2 — Child pipes + IPC** | `Bun.spawn({ cmd, ipc, stdout: "pipe" })` + `process.send` | Child sees **pipes** (`isTTY=false`); parent relays stdout | Agent → research progress + final table ([`research-runner.ts`](../src/agent/research-runner.ts)) |
| **3 — Child PTY** | `Bun.spawn({ terminal: { cols, rows, data } })` or `new Bun.Terminal()` | The **child subprocess** (`isTTY=true`) | **Not used** — see below |

### When PTY (`terminal` option) applies

From [Terminal (PTY) support](https://bun.com/docs/runtime/child-process#terminal-pty-support):

- Child needs **interactive** behavior: prompts, cursor movement, pagers, `bash` REPL.
- Child checks **`process.stdout.isTTY`** and changes output (colors, width) based on that.
- You write to **`proc.terminal.write()`** — `proc.stdout`/`stderr` are **null** when `terminal` is set.
- **`data(terminal, data)`** relays PTY output to the parent (often `process.stdout.write(data)`).
- **`proc.exited`** = process exit; **`terminal.exit` callback** = PTY stream lifecycle (not the same thing).
- **Reusable terminal:** `await using terminal = new Bun.Terminal({…})` then pass `{ terminal }` to multiple spawns for one session.

### Why this repo does not use PTY for research

| Subprocess | Why pipes/IPC, not PTY |
|------------|------------------------|
| **`gh` via `Bun.$`** | JSON `--json` output; `.quiet()` batch mode; no TTY needed ([`BUN_SHELL.md`](BUN_SHELL.md)) |
| **Research child** | Structured `ResearchProgressMessage` over IPC; markdown/table on stdout pipe — parsing PTY ANSI would be fragile |
| **Parent CLI** | Already running in a real TTY — use layer 1 natively |

PTY would only help if we spawned **`gh` without `--json`** for human-readable logs, or built an **interactive research TUI** (pick dimension, watch live inspect in a full-screen view).

### Platform notes (if we add PTY later)

- **macOS/Linux:** `openpty()` — termios, line echo, SIGWINCH.
- **Windows:** ConPTY — output is re-encoded VT (semantically same, not byte-identical); `\r` not mapped to `\n`; kill child before `terminal.close()` on older Windows.
- **`Bun.spawnSync`:** blocking; good for tiny CLI tools, not long research runs ([reference](https://bun.com/docs/runtime/child-process#reference)).

## Testing

Colocated under [`tests/`](../tests/):

| File | Covers |
|------|--------|
| `gate.test.ts` | popularity gate |
| `score.test.ts` | weighted scoring |
| `detect.test.ts` | detector pure functions |
| `gh.test.ts` | rate-limit + JSON parse helpers |
| `cache.test.ts` | sqlite cache + run storage |
| `research/patterns.test.ts` | `BunURLPattern` / `SERVE_PATTERNS` (mirrors `src/research/patterns.ts`) |
| `serve.test.ts` | `Bun.serve` report browser handlers |
| `inspect.mock.test.ts` | `mock.module("../src/research/gh.ts")` — no network |
| `preflight.test.ts` | `Bun.which("gh")` |
| `audit-adapter.test.ts` | sha3 digest + high-value gate |
| `export-audit.test.ts` | audit export round-trip |
| `diversify.test.ts` | shortlist caps + tag coverage |
| `schedule-cli.test.ts` | cron admin parse + preview |
| `constants.test.ts` | weights.json alignment |
| `validate.test.ts` | RepoReport wire |
| `evidence.test.ts` | detectors + fingerprints |
| `diff.test.ts` | run diffs |
| `paths.test.ts` | audit evidence paths |

```bash
bun test
bun test --coverage
bun test --grep "live-scores"
bun test tests/institutions/live-scores.test.ts --grep "poll"
```

- Use `bun test --grep "pattern"` (v1.3.6+) or `bun test -t "pattern"` to filter by test name.
- `--grep` is an alias for `--test-name-pattern`.

Filters on **`test()` / `describe()` names**, not file paths; pass a file path separately to narrow scope. Works with `--parallel --timings` (this repo’s default via [`package.json`](../package.json) `"test"` script — 5.5x faster than the old `--isolate`, §23). See [Bun v1.3.6](https://bun.com/docs/blog/bun-v1.3.6#grep-flag-for-bun-test).

Integration (live `gh`) is `bun run research` only.

## Package manager

This repo keeps a deliberately small dependency surface in [`package.json`](../package.json):

- Runtime: `drizzle-orm` and `zod`.
- Development: pinned `typescript` and `@types/bun` for a self-contained typecheck.

Run `bun install --frozen-lockfile` before `bun run check`. The committed [`bun.lock`](../bun.lock) makes the same graph available locally and in CI.

### When `bun install` matters

| Situation | Action |
|-----------|--------|
| Normal setup / CI | `bun install --frozen-lockfile`, then `bun run check`. |
| Intentional dependency change | Temporarily permit lockfile updates, run `bun install`, review and commit both `package.json` and `bun.lock`, then restore frozen mode. |
| Lockfile out of sync | `frozenLockfile = true` in [`bunfig.toml`](../bunfig.toml) makes install fail until `package.json` and `bun.lock` agree. |

**Footgun:** do not delete `bun.lock` or loosen frozen mode as a permanent workaround. A manifest change and its reviewed lockfile update are one change.

### Project `bunfig.toml`

[`bunfig.toml`](../bunfig.toml) holds **project-only** overrides (not machine linker/cache policy — that lives in the monorepo `~/.bunfig.toml` when applicable):

| Key | Value | Purpose |
|-----|-------|---------|
| `[install] frozenLockfile` | `true` | Reproducible installs |
| `[run] shell` | `"bun"` | `bun run …` uses Bun Shell — see [`BUN_SHELL.md`](BUN_SHELL.md) |
| `[console] depth` | `3` | Consistent inspect depth; override per run when needed |

The canonical `bun run test` command carries the 15-second integration timeout explicitly, so local, hook, and CI runs cannot drift with their working directory. Coverage is explicit through `bun run test:coverage`; the default test path optimizes for rapid feedback.

### Install pipeline

Bun install is not “download into `node_modules`” directly — it is **resolve → cache → link**:

```text
package.json + bun.lock
        │
        ▼
   Resolve graph (registry / git / tarball)
        │
        ├── no lock or deps changed → eager: fetch tarballs while resolving
        └── lock + unchanged deps     → lazy: fetch only missing packages
        │
        ▼
   Extract to global store
   ~/.bun/install/cache/${name}@${version}
   (pre/build semver tags → hashed dir name)
        │
        ▼
   Link into node_modules (--backend / platform default)
        │
        ▼
   Optional: project lifecycle scripts (pre/post install on *root* only)
```

**Kalshi-bot today:** the lock resolves the two runtime libraries, the pinned compiler toolchain, and their type dependencies into a project-local `node_modules` layout.

### Eager vs lazy resolution

| Condition | Behavior |
|-----------|----------|
| No `bun.lock`, or `package.json` deps changed | **Eager** — download and extract tarballs during resolution |
| `bun.lock` present and deps unchanged | **Lazy** — skip packages already satisfied in `node_modules` (name+version check below) |

[`frozenLockfile = true`](../bunfig.toml) adds a gate: install fails if lockfile would change, regardless of eager/lazy path.

### Global cache vs project `node_modules`

Two layers:

| Layer | Location | Role |
|-------|----------|------|
| **Global store** | `~/.bun/install/cache/${name}@${version}` | Canonical extracted package bytes (shared across projects on the machine) |
| **Project tree** | `./node_modules/` (gitignored here) | Per-project layout — hoisted flat or isolated `.bun/` + symlinks |

Monorepo **machine** policy ([`docs/UNIFIED.md`](../../docs/UNIFIED.md) on the parent `Projects` tree) sets absolute `[install.cache].dir`, `globalStore = true`, and `linker = isolated` in `~/.bunfig.toml`. **This repo’s** [`bunfig.toml`](../bunfig.toml) does not duplicate those machine-owned keys; it only carries project install, run, and console behavior.

Registry metadata (versions, dist-tags) is cached separately as binary `~/.bun/install/cache/*.npm` (hashed package name). Bun ignores `Cache-Control: Age` on registry responses — metadata can lag npm by ~5 minutes.

### Cache directory layout (finding packages on disk)

Canonical layout ([bun install — global cache](https://bun.com/docs/pm/cli/install), [global cache](https://bun.com/docs/pm/global-cache)):

```text
$(bun pm cache)/                    # default ~/.bun/install/cache
├── ${name}@${version}@@@1/         # extracted tarball (release semver)
├── ${name}@${hash}@@@1/            # pre/build semver → hash, not literal version
├── ${hash(packageName)}.npm        # registry metadata blobs (scoped names hashed)
└── links/                          # global virtual store (globalStore = true only)
    └── ${name}@${version}-${entry_hash}/
        └── node_modules/           # linked dep closure for this project graph
```

**Release semver** — directory name matches lockfile version, often with an `@@@1` suffix on the extracted cache entry (e.g. `esbuild@0.28.1@@@1`). Scoped packages use the scope in the name: `@types/node@20.0.0@@@1`.

**Pre-release or build metadata** — if the version string has a pre suffix (`1.0.0-beta.0`) or build suffix (`1.0.0+20220101`), Bun **replaces that semver segment with a hash** in the cache path. This avoids OS errors from overlong paths, but you cannot `ls ~/.bun/install/cache/foo@1.0.0-beta.0` and expect a hit.

**Registry metadata** — `*.npm` files use `${hash(packageName)}.npm` so scoped packages do not need extra directory nesting ([install docs](https://bun.com/docs/pm/cli/install)).

**Global virtual store** — when `globalStore = true` (monorepo machine default in [`docs/UNIFIED.md`](../../docs/UNIFIED.md)), isolated installs also materialize under `cache/links/` with a 16-hex `entry_hash` suffix encoding the resolved dependency closure ([global virtual store](https://bun.com/docs/pm/global-store)). Project `node_modules/.bun/<pkg>@<version>` symlinks there; `readlink` on those paths is the reliable way to see the canonical on-disk tree.

**Practical lookup** (once deps exist):

| Goal | Command / path |
|------|----------------|
| Cache root | `bun pm cache` |
| Why a package is installed | `bun pm why <pkg>` |
| Version in the tree | `node_modules/<pkg>/package.json` → `"version"` |
| Canonical path (isolated + global store) | `readlink node_modules/.bun/<pkg>@<version>` |
| Clear everything | `bun pm cache rm` |

**Kalshi-bot today:** the shared cache contains the resolved runtime and compiler packages; `node_modules` remains project-local and gitignored.

### Name + version skip (existing `node_modules`)

When `node_modules/` already exists and `bun.lock` matches `package.json`, Bun **lazy-installs**: for each resolved package it checks whether `node_modules/<pkg>/package.json` has the expected `"name"` and `"version"`. A custom JSON parser reads **only those two fields** and stops — it does not hash file contents.

Implications:

- **Fast path:** repeat `bun install` on a warm tree skips tarball fetch when name+version match.
- **Stale tree:** edited files under `node_modules/` still “pass” until version string changes — symptoms look like “wrong runtime behavior” not “install failed”. Fix: `rm -rf node_modules && bun install`.
- **Cross-platform:** same lockfile on macOS (clonefile) vs Linux CI (hardlink) still agrees on name+version; backend affects *how* bytes appear in `node_modules`, not resolution.
- **Today:** repeat installs take the lazy path when `bun.lock` and the local package versions agree.

### Linker strategies (`--linker`)

Backends (`clonefile` / `hardlink`) control **how files land** from cache. **Linker** controls **layout**:

| Linker | Layout | Default when |
|--------|--------|--------------|
| `hoisted` | Flat shared `node_modules` (npm/Yarn classic) | Existing pre-v1.3.2 projects; new single-package projects |
| `isolated` | Central `node_modules/.bun/` + symlinks; blocks phantom imports | New workspaces; monorepo machine policy |

Lockfile `configVersion` records the chosen strategy. The machine `~/.bunfig.toml` supplies `linker = isolated`, so this project does not repeat that key.

See [isolated installs](https://bun.com/docs/pm/isolated-installs).

### Install backends (platform) — deep dive

After extract, Bun populates `node_modules` from the global cache using the **fastest platform backend**. On failure, `clonefile` and `hardlink` **automatically fall back** to copy ([bun install — platform backends](https://bun.com/docs/pm/cli/install)).

| Backend | OS | Mechanism | When to use |
|---------|-----|-----------|-------------|
| `clonefile` | macOS (default) | APFS `clonefile()` — CoW, one syscall per tree | Default local dev on Darwin |
| `clonefile_each_dir` | macOS | Per-directory clone; slower than `clonefile` | Debugging clonefile edge cases |
| `hardlink` | Linux (default) | Same inode, multiple directory entries | Default on CI (`ubuntu-latest`) |
| `copyfile` | all | `fcopyfile()` (macOS) / `copy_file_range()` (Linux) | Slowest; explicit fallback or `--backend copyfile` |
| `symlink` | special | Used for `file:` deps; not normal npm layout | Requires `--preserve-symlinks` for Node-compatible resolution if forced globally |

**Why backends matter:** they avoid duplicating megabytes per project. Hardlinks and clones share disk blocks with the global cache; copies do not. All backends must still present a normal `node_modules` tree to Bun’s resolver.

**Force a backend:**

```bash
rm -rf node_modules
bun install --backend hardlink    # Linux-style on any OS
bun install --backend clonefile   # macOS-only; errors elsewhere
bun install --backend copyfile    # portable slow path
```

**Kalshi-bot mapping:**

| Environment | Install backend |
|-------------|-----------------------------------|
| Your Mac | `clonefile` → cache at `~/.bun/install/cache/…` |
| GitHub Actions `ubuntu-latest` | `hardlink` during the frozen install |
| Docker / exotic FS (no hardlink) | silent fallback to `copyfile` |

### Lifecycle scripts and security

Bun **does not** run `postinstall` / `preinstall` on **dependency** packages by default (supply-chain risk). Root project scripts in `package.json` still run. To allow a specific dependency’s scripts: add it to `trustedDependencies` in `package.json`, then reinstall.

Popular native addons (`esbuild`, `sharp`) get Bun optimizations. Neither is part of this project’s dependency graph.

### CI

[`.github/workflows/check.yml`](../.github/workflows/check.yml) uses `oven-sh/setup-bun`, runs `bun install --frozen-lockfile`, then invokes the same `bun run check` entry point used by the hook and local development.

### Debugging (when deps exist)

```bash
bun install --dry-run              # preview resolution
bun install --verbose              # debug logging
rm -rf node_modules && bun install # bust stale name+version skip
bun pm cache rm                    # clear ~/.bun/install/cache
```

### Canonical references

| Topic | Doc |
|-------|-----|
| `bun install` / backends / CI | https://bun.com/docs/pm/cli/install |
| Global cache / pre-build hashing | https://bun.com/docs/pm/global-cache |
| Global virtual store (`links/`) | https://bun.com/docs/pm/global-store |
| Lockfile / `configVersion` | https://bun.com/docs/pm/lockfile |
| Isolated vs hoisted | https://bun.com/docs/pm/isolated-installs |
| `bunfig.toml` `[install]` | https://bun.com/docs/runtime/bunfig |
| Monorepo machine install policy | [`docs/UNIFIED.md`](../../docs/UNIFIED.md) (parent `Projects` repo) |

## TypeScript

[`tsconfig.json`](../tsconfig.json): `"module": "Preserve"`, `"moduleResolution": "bundler"`, `"noEmit": true`, `"types": ["bun"]`.

## Dependency smell test

| If you need… | Use instead |
|--------------|-------------|
| GitHub HTTP | `gh.ts` (`Bun.$`) |
| File cache | `cache.ts` (`bun:sqlite`) |
| Read/write JSON artifacts | `io.ts` |
| Parallel map | `pool.ts` |
| CLI flags | `parseArgs` |
| Unit tests | `bun:test` + `mock.module` |
| Type-safe SQLite queries | `src/db/schema.ts` + `src/db/client.ts` (`drizzle-orm`) |
| SQLite migration tool (dev) | `bunx drizzle-kit` (not in package.json) |

| If you need… | Use instead |
|--------------|-------------|
| GitHub HTTP | `gh.ts` (`Bun.$`) |
| File cache | `cache.ts` (`bun:sqlite`) |
| Read/write JSON artifacts | `io.ts` |
| Parallel map | `pool.ts` |
| CLI flags | `parseArgs` |
| Unit tests | `bun:test` + `mock.module` |

## Data-model unification

[`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) surveys the fragmented state (four event-id namespaces, four side dialects across `massey.db` + `event-store.db`) and prescribes the unified model: `match_key` as the canonical event key, home/away as the single side vocabulary, and one odds-row contract. Implemented so far: `src/institutions/event-store/event-identity.ts` (match_key build/parse SSOT + `normalizeSideToHomeAway` covering home/away, 1/2, yes/no, winner/loser-by-name), wired into `odds-ticks-store`. Migration steps 2–5 (add `match_key` columns, migrate tennis-history odds to home/away, join on match_key, unified odds view) are tracked in the doc.

## Gap register (Bun 1.4 audit)

### Adopted this round

| API | Where | What |
|-----|-------|------|
| `Bun.CSRF` + `Bun.Cookie`/`CookieMap` | `src/research/csrf.ts`, `serve.ts`, `views.ts` | Double-submit CSRF on all browser-facing POSTs (`/place-bet`, `/api/trading/order`, `/api/trading/cancel`, `/agent/dispatch`, `/ops/kalshi-rotate-key`). GET `/ops` issues a token (HttpOnly SameSite=Lax cookie, inlined `OPS_CSRF` in the page), clients echo it in `x-csrf-token`, and `csrfGuard` 403s before any handler runs. Tokens are **session-bound** per the Bun docs warning: `Bun.CSRF.generate(secret, { sessionId })` where `sessionId` rides the HttpOnly `kalshi_session` cookie, and `verify` requires the same `sessionId` — a token from another session is rejected (Bun 1.4 quirk: `generate(undefined, opts)` throws, so a module-level fallback secret mirrors the documented per-thread default). `KALSHI_CSRF_SECRET` pins a stable signing secret so tokens survive restarts. The `/polymarket/ingest` webhook is deliberately excluded (no browser session).
| `Bun.secrets` (OS keychain) | `src/lib/secrets.ts`, `tools/kalshi-secrets-cli.ts`, `tests/lib/secrets.test.ts` | Credential-store wrapper: backend-injectable (tests use an in-memory map), feature-detected, reads degrade to an env-var fallback. `bun run kalshi:secrets store|get|delete` moves the plaintext Kalshi key and `.env` credential values into the OS vault under service `com.kalshi-bot`. Complement to `redactSecrets` — store in the vault, redact on the way out. Wired end-to-end: `loadKalshiCredentials` is now async and falls back to this vault when env/file is absent (env stays authoritative when both present); per-account resolvers pass `{ keychain: false }` so account-scoped clients never pick up the machine-global key. Full API surface covered: `get`/`set`/`delete` object forms, `allowUnrestrictedAccess` (macOS CI option, `store --unrestricted`), empty-string-set-deletes semantics documented. Verified: Bun's positional forms (`secrets.get('app','name')`) work at runtime but bun-types 1.4.0 does not declare them — we use the typed object form. CLI is verification-safe: `--service` namespaces round-trips (e.g. `kalshi-api-test`) away from production, `store`/`delete` prompt unless `--force` (stdin-EOF defaults to no), and `inspect` prints existence + sha256 fingerprint, never the value. E2E verified on this machine: store → `loadKalshiCredentials({}, { service })` resolves from the keychain → guarded delete; `com.kalshi-bot` untouched. Live chain proven: `kalshi:live-probe` loads keychain-only creds (empty env) and hits Kalshi's demo API — a throwaway key yields a signature-valid HTTP 401 (request executed, key rejected); gated test runs only when `KALSHI_TEST_KEYCHAIN_SERVICE` is set; prod probe additionally requires `KALSHI_PROD_ARMED=1`.

`massey:edge-flags` — automatic edge flags (Massey implied vs live book odds): `computeEdgeFlags` engine + md/json formatters (threshold-configurable, tested); `odds-ticks-store` implements the live-odds persistence contract (`skin_events.odds_event_id` → `odds_ticks`, sides `home`/`away`, latest tick per side); CLI writes `research/outputs/massey-edge-flags.{md,json}`; cron runs it after crossref. Capture bridge built: `persistOddsTicks` (upsert-ignore on event_id+source+side+ts, corpus trading, limit_context live) + `odds-persist` mapper (`PartnerMarket` American prices → decimal home/away under `odds_event_id`) + `FantasyUltraAdapter` `persistence: { db }` hook (persists after every coefficient ingest) + `kalshi:odds-capture` CLI (subscribes to the skin_events `odds_event_id` set, `--dry-run` lists it without connecting; needs live fantasy402 env creds to run). Persist/mapper fully unit-tested; dry-run verified (118 tennis event ids). Tennis-history CSVs write `winner`/`loser` sides under the canonical `events` corpus — outside this join, so flags still report 0 priced events until a live capture session runs.
| `Bun.sleep` | `src/bot/kalshi-client.ts`, `src/institutions/resilient-fetch.ts`, `src/lib/readline.ts` | Replaced the `new Promise(r => setTimeout(r, ms))` sleep/backoff/timeout wrappers with the native timer (injectable `sleep` option in kalshi-client kept for tests).
| `AbortSignal.timeout` | `src/institutions/url-health.ts` | `probeHttp` now uses the self-aborting signal instead of an AbortController + manual timer + `clearTimeout` in `finally`.
| `Promise.withResolvers` | `src/institutions/event-store/kalshi-ws-recorder.ts` | Deferred session promise — removes the `new Promise` executor indirection for the `sessionDone` resolver.
| `Bun.ArrayBufferSink` | `src/partner/visuals.ts` | PNG builder's final part concatenation now uses a single-pass sink instead of the manual total+offset loop; structural PNG test pins the bytes.
| `Bun.semver.satisfies` | `src/research/bun-native.ts`, `tools/massey-sync-cli.ts`, `tools/massey-crossref-cli.ts` | `assertBunAtLeast` runtime gate — CLI entries that need Bun 1.4-only APIs (WebView, cron) fail fast with a clear upgrade message instead of a ReferenceError.
| `Bun.file().json()` | `src/lib/json-file.ts`, `src/research/export-audit.ts`, `tools/tennis/harvest-nationalities.ts` | JSON artifact SSOT (`readJsonFile`/`readJsonFileOr`/`writeJsonFile`); two manual `JSON.parse(await Bun.file(p).text())` sites refactored.
| `Bun.file().json()` (expanded) | `src/research/hq-data.ts`, `src/research/export-audit.ts` | 6 more manual sites refactored: hq-data alpha/calibration loaders are now async `readJsonFileOr` (caller `buildHqPayload` already awaited); export-audit manifest/concept reads consolidated. `readJsonFileOr` widened to `T | null` for the optional-file pattern.
| `Bun.serve` hardening | `src/research/serve.ts` | `maxRequestBodySize: 16MB` (default is 128MB) + `idleTimeout: 255` (u8 max; default 10s) for the long-lived ndjson/SSE streams. Probe note: idleTimeout is a u8 — 300 throws.
| `Bun.stdout.write` | `src/regulatory/scripts/migrate.ts`, `tools/tennis/live-scores-cli.ts` | Replaced the last `process.stdout.write` spots (readline.ts already native).
| `Bun.serve routes { dir }` | `src/research/serve.ts` | v1.4 static dir mounts for `/registry/*` + `/partner-dashboard/*` (sendfile, ETag/Last-Modified, 304, Range/206, index.html, openat2 O_RESOLVE_BENEATH on Linux). Replaces ~60 lines of hand-rolled `Bun.file` handlers; verified + test-locked (§19). Requires the path to end in `/*`; a root-level mount would shadow API routes.
| `process.on('memoryPressure')` | `src/research/serve.ts` | Real handler on `createResearchServer`: clears book/source-catalog/auth/tennis-board caches on `critical` (levels `warning`/`critical`); listener removed on `server.stop()` (§21).
| `fetch()` h2 client (`protocol:'http2'`) | `src/lib/fetch-pool.ts` | Experimental h2 client: `protocol:'http2'` over TLS multiplexes concurrent requests on ONE connection (verified 20 parallel → 1 conn/20 streams); `BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1` offers h2 globally. Requires https (plaintext h2c → `HTTP2Unsupported`); the earlier 'no h2 on 1.4.0' claim was an h2c probe artifact (§14).
| `fetch()` compress option | `src/lib/fetch-pool.ts` | First-class `compress` on `fetchText`/`fetchPool` (gzip/deflate/br/zstd, auto Content-Encoding; verified all four codecs). Only worth it for large bodies (>~100KB); zero current consumers.
| TLS session resumption | (implicit) | 32-entry LRU of BoringSSL sessions per origin; reconnect after pool eviction resumes at 1 RTT (§14). Automatically active.
| `Bun.Archive` | `tools/bun-backup.ts` | `bun:backup` tars research/cache DBs (incl. 88MB event-store.db) with keep-N pruning; round-trip verified. KNOWN 1.4.0 BUG: `Bun.Archive.write` with a `BunFile` value archives 0-byte entries — must pass `.bytes()` (test-locked, §22).
| fetch-pool defaults | `src/lib/fetch-pool.ts` | Canonical fetch layer: `fetchPool` (bounded concurrency 8, DNS warm-up, per-URL error capture, never throws) + `fetchText` (body always consumed, `AbortSignal.timeout`, UTF-8 `bytes`) + `warmDns` (§12).
| Five audit tools | `tools/bun-{breaking,claims,deps,perf,adoption}-audit.ts` | `bun:breaking-audit` (v1.4 break scan, in `check`), `bun:claims-audit` (blog claim verification), `bun:deps-audit` (dependency-killer report), `bun:perf-audit` (toolchain wins, in `check`), `bun:adoption-audit` (networking coverage report) + `runtime-surface` probe in the guard (§17-26).

### Flagged (no adoption yet — honest no-fit)

- `bun test --shard` — unused (no multi-runner CI; hosted runners billing-blocked). `--timings/--parallel` are now ADOPTED (§23): the gate's test script is `--parallel --timings=.bun-test-timings.json`, 5.5x faster than the old `--isolate` (measured 11.1s → 2.0s on 1959 tests); pre-commit hook uses it too.
- `Bun.password` — no current hashing consumer in this repo; candidate only if a local vault passphrase ever appears. Do not force-fit.
- `Bun.XML` — ADOPTED: `src/lib/release-blog.ts` parses the bun.com RSS with `Bun.XML.parse` (SIMD; 87KB feed in ~1.9ms verified). Import loader `with { type: 'xml' }` returns the parsed object, not the file path (verified — the 1.4 breaking change holds). Shape notes: repeated elements become arrays, single elements stay objects; RSS 2.0 is `rss.channel.item[]` with plain strings, Atom is `feed.entry` with `@`-prefixed attributes.
- `Bun.deepMatch` — subset-matching has no consumer; `Bun.deepEquals` (via `bun-native.ts`) covers equality. Revisit if a schema-subset check appears.
- `Bun.mmap` — no random-access large-file consumer; all file reads are full-buffer or streamed. Revisit if a memory-mapped scan appears.
- `Bun.Transpiler` / `Bun.unsafe` — no runtime transpilation or unsafe-FFI need; nothing to adopt.
- Sync seed loaders (`tennis-meta.ts` `loadSeed`, hq-data hypothesis reads) stay `readFileSync` — `Bun.file().json()` is async-only and the `??=` memoized dicts are sync by design.

