# Bun-native API grounding

This project is **Bun-native first**. Runtime dependencies are limited to the two domain libraries that earn their weight: `drizzle-orm` for typed SQL and `zod` for boundary schemas. Process, file, TOML, terminal, test, and other platform capabilities map directly to Bun or the Node-compatible standard library.

**Rule:** before adding any package, check the [Bun API map](#bun-api-map) below — the runtime almost certainly already provides it.

Canonical URLs: [Bun docs index](https://bun.com/docs/llms.txt) — use the [@see links](#canonical-see-links) table below (standalone repo; monorepo `bun tools/bun-doc-refs.ts` is optional).

Deep dive: [`BUN_SHELL.md`](BUN_SHELL.md) (`Bun.$` patterns)

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

**Pattern excerpts from local clones:** `bun run agent patterns --open` reads source files under `REPO_CLONE_ROOT/{owner}/{repo}` when set (optional — default remains `gh api` reads with no clone). This is an intentional scope extension beyond the original no-clone plan; set `REPO_CLONE_ROOT` only when you maintain local checkouts for excerpt review.
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
| Tennis WS dashboard ground | `Bun.WebView` (`backend`: webkit on macOS, chrome elsewhere; `url` + `data:text/html`) + `Bun.file().image()` chain | [`tennis-ws-ground.ts`](../src/institutions/event-store/tennis-ws-ground.ts), [`tennis-ws-dashboard.ts`](../src/institutions/event-store/tennis-ws-dashboard.ts), [`tennis-book-coverage.ts`](../src/institutions/event-store/tennis-book-coverage.ts) |
| Match liquidity ground | Same WebView + Image pipeline over `match_liquidity` KPIs | [`match-liquidity-ground.ts`](../src/institutions/event-store/match-liquidity-ground.ts), [`match-liquidity-dashboard.ts`](../src/institutions/event-store/match-liquidity-dashboard.ts), `bun run liquidity:ground` · snapshot: `tools/snapshot-data-plane.ts` `liquidity` block |
| Match liquidity pipeline cron | In-process `Bun.cron` + OS `export default { scheduled }` | [`match-liquidity-pipeline.ts`](../src/institutions/event-store/match-liquidity-pipeline.ts), [`match-liquidity-scheduled.ts`](../tools/match-liquidity-scheduled.ts), `cron:start` · `liquidity:pipeline:register` |
| Kalshi WS orderbook | Bun client `WebSocket` + RSA handshake headers; JSON-only wire; official error codes 1–25; ping keepalive; reconnect jitter; `NO_PROXY` + proxy/TLS env | [`kalshi-ws.ts`](../src/bot/kalshi-ws.ts), [`kalshi-ws-errors.ts`](../src/bot/kalshi-ws-errors.ts), [`kalshi-ws-recorder.ts`](../src/institutions/event-store/kalshi-ws-recorder.ts), [`tennis-ws-recorder-store.ts`](../src/institutions/event-store/tennis-ws-recorder-store.ts) |
| Cadence / scoreboard tables | `Bun.inspect.table` | [`terminal-out.ts`](../src/research/terminal-out.ts), tennis CLI + `agent tennis` |
| Terminal reports | `Bun.markdown.ansi` + `Bun.wrapAnsi` | [`report-term.ts`](../src/agent/report-term.ts) |
| TTY tables + OSC 8 links | `Bun.inspect.table` + `Bun.stringWidth` / `wrapAnsi` / `stripANSI` | [`terminal-out.ts`](../src/research/terminal-out.ts) |
| Phase timings | `Bun.nanoseconds` | [`phase-timing.ts`](../src/research/phase-timing.ts) |
| Agent IPC research progress | `Bun.spawn` + `process.send` | [`research-runner.ts`](../src/agent/research-runner.ts), [`research-progress.ts`](../src/research/research-progress.ts) |
| GitHub rate budget probe | `Bun.spawn` (stdout/stderr pipes) | [`github-rate-budget.ts`](../tools/github-rate-budget.ts) |
| Repo / alpha file scan | `Bun.Glob` | [`watcher.ts`](../src/calibration/watcher.ts), [`architecture-blueprint.ts`](../src/agent/architecture-blueprint.ts) |
| CLI flags | `parseArgs` from `node:util` | [`cli.ts`](../src/research/cli.ts) |
| Reproducible package install | `bun install --frozen-lockfile` | [`package.json`](../package.json), [`bun.lock`](../bun.lock) |
| Unit tests | `bun:test` + `mock.module()` | [`tests/`](../tests/) |
| Test coverage | `bun run test:coverage` | [`package.json`](../package.json) |

### Canonical `@see` links

| API | Doc |
|-----|-----|
| `Bun.$` | https://bun.com/docs/runtime/shell#getting-started |
| `Bun.which` | https://bun.com/docs/runtime/utils#bun-which |
| `Bun.file` | https://bun.com/docs/runtime/file-io#reading-files-bun-file |
| `Bun.write` | https://bun.com/docs/runtime/file-io#writing-files-bun-write |
| `Bun.env` / `.env` load | https://bun.com/docs/runtime/environment-variables |
| Configuring Bun (`BUN_*`, `NO_COLOR`, …) | https://bun.com/docs/runtime/environment-variables#configuring-bun |
| `Bun.color` | https://bun.com/docs/runtime/color |
| `bun update` interactive visuals | https://bun.com/docs/pm/cli/update#visual-indicators |
| HTMLRewriter social / OG meta | https://bun.com/docs/guides/html-rewriter/extract-social-meta |
| `HTMLRewriter` | https://bun.com/docs/runtime/html-rewriter |
| `Bun.hash` | https://bun.com/docs/runtime/hashing#bun-hash |
| `Bun.deepEquals` | https://bun.com/docs/runtime/utils#bun-deepequals |
| `Bun.inspect` | https://bun.com/docs/runtime/utils#bun-inspect |
| `Bun.peek` | https://bun.com/docs/runtime/utils#bun-peek |
| `Bun.openInEditor` | https://bun.com/docs/runtime/utils#bun-openineditor |
| `Bun.escapeHTML` | https://bun.com/docs/runtime/utils#bun-escapehtml |
| `Bun.zstdCompressSync` | https://bun.com/docs/runtime/utils#bun-zstdcompress-bun-zstdcompresssync |
| `Bun.zstdDecompressSync` | https://bun.com/docs/runtime/utils#bun-zstddecompress-bun-zstddecompresssync |
| `Bun.fileURLToPath` | https://bun.com/docs/runtime/utils#bun-fileurltopath |
| `Bun.pathToFileURL` | https://bun.com/docs/runtime/utils#bun-pathtofileurl |
| `bun:sqlite` | https://bun.com/docs/runtime/sqlite |
| `Bun.sleep` | https://bun.com/docs/runtime/utils#bun-sleep |
| `import.meta.dir` | https://bun.com/docs/runtime/module-resolution#import-meta |
| `import.meta.main` | https://bun.com/docs/runtime/utils#bun-main |
| `bun:test` | https://bun.com/docs/test/index#run-tests |
| `mock.module` | https://bun.com/docs/test/mocks |
| `Bun.cron` | https://bun.com/docs/runtime/cron |
| `Bun.cron.parse` / `.remove` | https://bun.com/docs/runtime/cron |
| `Bun.Glob` | https://bun.com/docs/runtime/glob |
| `Bun.CryptoHasher` | https://bun.com/docs/runtime/hashing#bun-cryptohasher |
| `URLPattern` | https://bun.com/blog/bun-v1.3.4#urlpattern-api |
| `Bun.serve` | https://bun.com/docs/runtime/http/server#basic-setup |
| `Bun.markdown.ansi` | https://bun.com/docs/runtime/markdown#ansi-terminal-output |
| `Bun.inspect.table` | https://bun.com/docs/runtime/utils#bun-inspect-table-tabulardata-properties-options |
| `Bun.stringWidth` | https://bun.com/docs/runtime/utils#bun-stringwidth |
| `Bun.wrapAnsi` | https://bun.com/docs/runtime/utils#bun-wrapansi |
| `Bun.stripANSI` | https://bun.com/docs/runtime/utils#bun-stripansi |
| `Bun.nanoseconds` | https://bun.com/docs/runtime/utils#bun-nanoseconds |
| `Bun.fetch` / `fetch.preconnect` | https://bun.com/docs/runtime/networking/fetch#sending-an-http-request · [preconnect](https://bun.com/docs/runtime/networking/fetch#preconnect-to-a-host) |
| `Bun.spawn` IPC | https://bun.com/docs/runtime/child-process#inter-process-communication-ipc · [reference](https://bun.com/docs/runtime/child-process#reference) |
| `Bun.spawn` (pipes) | https://bun.com/docs/runtime/child-process#spawning-a-process-bun-spawn |
| `Bun.Terminal` (PTY) | https://bun.com/docs/runtime/child-process#terminal-pty-support |
| `Bun.spawnSync` | https://bun.com/docs/runtime/child-process#blocking-api-bun-spawnsync |
| `Bun.WebView` | https://bun.com/docs/runtime/webview |
| `Bun.Image` | https://bun.com/docs/runtime/image |
| Client `WebSocket` (headers, `proxy`) | https://bun.com/docs/runtime/http/websockets · [proxy v1.3.6](https://bun.com/docs/blog/bun-v1.3.6#httphttps-proxy-support-for-websocket) |
| `bun install` | https://bun.com/docs/pm/cli/install |
| `bun.lock` / lockfile | https://bun.com/docs/pm/lockfile |
| `bunfig.toml` `[install]` | https://bun.com/docs/runtime/bunfig |
| Isolated installs | https://bun.com/docs/pm/isolated-installs |
| `Buffer.indexOf` / `Buffer.includes` | https://bun.com/docs/blog/bun-v1.3.6#faster-bufferindexof |
| `bun test --grep` | https://bun.com/docs/blog/bun-v1.3.6#grep-flag-for-bun-test |
| `Response.json()` perf | https://bun.com/docs/blog/bun-v1.3.6#responsejsonobject-is-now-35x-faster |

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

`bun run serve` (`bun --hot`) — **5 routes**, no router package:

| Route | Source |
|-------|--------|
| `/` | latest shortlist + diff excerpt + run history |
| `/api/runs` | run summaries JSON |
| `/api/runs/:id` | full run JSON |
| `/repo/:owner/:name` | repo detail (`?run=` for historical) |
| `/reports/latest.md` | `Bun.file(research/reports/latest.md)` |

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

Filters on **`test()` / `describe()` names**, not file paths; pass a file path separately to narrow scope. Works with `--isolate` (this repo’s default via [`package.json`](../package.json) `"test"` script). See [Bun v1.3.6](https://bun.com/docs/blog/bun-v1.3.6#grep-flag-for-bun-test).

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
