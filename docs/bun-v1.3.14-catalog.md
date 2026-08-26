# Bun v1.3.14 — Verified Feature Catalog

> **DEPRECATED (2026-08-25).** Historical catalog for the **1.3.14** era — the
> repo now pins **bun@1.4.0** (`packageManager`), and the claims below were
> verified against 1.3.14. Do not treat them as current. The 1.4.0 grounding:
> [`docs/BUN_API_COVERAGE.md`](BUN_API_COVERAGE.md) (full shape matrix,
> gate-pinned) · [`docs/BUN_BUILD_FINDINGS.md`](BUN_BUILD_FINDINGS.md)
> (BuildArtifact/BuildConfig/Blob#image()/slice()/Image-constructor claims,
> probe-grounded on 1.4.0) · `docs/AGENT-PITFALLS.md` §176-§177 (1.4.0 probe
> ledger; §125 covers the fetch-h2 1.3.14→1.4.0 change).

> **Scope.** Feature-by-feature catalog of the Bun v1.3.14 release, verified
> **in-session against the installed binary** (`bun --version` → 1.3.14) and the
> shipped `bun-types@1.3.14` declarations, with a web cross-check against the
> official release notes and docs. This repo pins `bun@1.3.14`
> (`packageManager`, `engines`, CI `oven-sh/setup-bun`).
>
> **Status legend.** ✅ verified locally · ⚠️ experimental per types/docs ·
> 🧪 exists but not end-to-end verifiable in this sandbox (no outbound network,
> no PTY allocation, no Windows) · ✏️ pasted analysis corrected · 📈 perf claim,
> not benchmarked here.


## Bun 1.4 delta (2026-08-22) — Rust rewrite now active

> The default runtime on this machine is now Bun 1.4.0 (the Rust rewrite).
> packageManager, @types/bun, and bun-types were bumped to 1.4.0 and
> "bun run typecheck" passes on 1.4.0 types. The catalog below is the
> 1.3.14 baseline snapshot; the delta (verified against the official
> Bun 1.4 release post, bun.com/blog/bun-v1.4) is:

| New / changed API | Introduced | Notes |
| --- | --- | --- |
| Bun.TOML.stringify | 1.4.0 | native TOML serialization; src/partner/toml-stringify.ts feature-detects it with a pre-1.4 fallback |
| Bun.XML (parse/stringify) | 1.4.0 | SIMD XML parser; .xml imports return the parsed object |
| Bun.JSONC.parse | 1.4.0 | JSON with comments/trailing commas |
| Bun.isStandaloneExecutable | 1.4.0 | standalone build detection |
| Bun.WebView | 1.3.12 -> 1.4.0 | headless browser automation (Massey fetch + tennis/liquidity grounds) |
| Bun.markdown | 1.3.8 -> 1.4.0 | HTML/React/ANSI rendering (wrapped in src/lib/markdown.ts) |
| Bun.Terminal | 1.3.5 -> 1.4.0 | native PTY |
| Bun.Archive | 1.3.6 | tarball create/extract |
| Bun.S3Client | 1.3.1 -> 1.4.0 | object store client |
| bun run --parallel / bun test --parallel | 1.3.9 / 1.3.13 | parallel scripts and test workers |
| Runtime | 1.4.0 | Zig -> Rust port; -35% memory, 5x less idle CPU, faster start |

**npm packages Bun 1.4 replaces** (the guard scripts/audit-bun-native.ts now
bans all of these): sharp -> Bun.Image; puppeteer -> Bun.WebView;
marked -> Bun.markdown; node-cron -> Bun.cron(); node-pty ->
Bun.Terminal; concurrently / npm-run-all -> bun run --parallel;
serve-static / express -> Bun.serve; json5 -> Bun.JSON5; ndjson ->
Bun.JSONL; jsonc-parser -> Bun.JSONC; fast-xml-parser / xml2js ->
Bun.XML; tar -> Bun.Archive; string-width / slice-ansi / cli-truncate /
wrap-ansi -> Bun.stringWidth / Bun.sliceAnsi; path-to-regexp -> Bun.serve.

## Verified inventory

| # | Feature | Status | Evidence |
|---|---------|--------|----------|
| 1 | `Bun.Image` chainable pipeline | ✅ | `metadata()` → `{width,height,format}`; `resize(4,4).webp({quality:80}).bytes()` ✓; `Bun.file(...).image().rotate(90).jpeg().bytes()` ✓; `.write("thumb.webp")` ✓ |
| 2 | `new Bun.Image(upload).resize(200).jpeg()` | ✅ | constructor from bytes ✓ (formats: jpeg/png/webp encode; bmp/tiff/gif decode-only per types) |
| 3 | `new Bun.Image(buf).metadata()` | ✅ | `{ width: 1, height: 1, format: "png" }` on probe image |
| 4 | `.placeholder()` thumbhash LQIP | ✅ | returns `data:image/png;base64,…` ThumbHash URL (`placeholder(as?: "dataurl")`) — 2.6 KB data URL on probe |
| 5 | `[install] globalStore = true` | 🧪 | official docs exist (bun.com/docs/pm/global-store); not exercised here (no registry network); repo policy keeps global-store in `~/.bunfig.toml` |
| 6 | `Bun.serve({ http3: true, tls })` | ✅ (startup) | option typed `@experimental`, "requires tls" enforced; started with real self-signed cert (dual HTTP/1.1+HTTP/3 and HTTP/3-only modes) |
| 7 | `Bun.serve({ http3: true, http1: false })` | ✅ (startup) | h3-only server started on macOS |
| 8 | `fetch(..., { protocol: "http2" })` | 🧪 | typed `@experimental`, union `"http2" | "http1.1" | "h2" | "h1"`; flag `--experimental-http2-fetch` confirmed in `--help`; e2e blocked by sandbox network |
| 9 | `fetch(..., { protocol: "http1.1" })` | 🧪 | typed (see #8); pins to HTTP/1.1 |
| 10 | HTTP/3 fetch client | ✏️ | **not** in the typed `protocol` union; actual client is flag-driven (`--experimental-http3-fetch` / `BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT=1`, Alt-Svc upgrade per `--help`); runtime parsed `{protocol:"http3"}` (reached `HTTP3HandshakeFailed`) but e2e blocked |
| 11 | `fs.watch` recursive rewrite | ✅ | macOS: `fs.watch(dir, {recursive:true})` emitted `rename:newdir` on subdir creation |
| 12 | `--no-orphans` | ✅ | CLI + `bun run --help` confirmed: "Exit when the parent process dies, and on exit SIGKILL every descendant. Linux/macOS only." Runs clean; `[run] noOrphans = true` bunfig key accepted |
| 13 | `process.execve` | ✅ (warn ✏️) | real exec into `/bin/echo` worked (output + exit 0); **no `ExperimentalWarning` observed** on 1.3.14 |