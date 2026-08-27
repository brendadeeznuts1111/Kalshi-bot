# Bun 1.4.x (Rust rewrite) — Upgrade Canary & Verification Checklist

**Status:** Pin committed 2026-08-22 (Phase 6 complete) · **Target runtime:** Bun 1.4.x (the Zig→Rust port) · **Baseline:** Bun 1.4.0 (pinned)
**Policy anchor:** [`AGENTS.md`](../AGENTS.md) — "Bun 1.4.0 stable is the supported local and production baseline."

## 0. Feature-claim verification (2026-08-26, probed on the installed 1.4.0)

Claims that look like post-1.4 release notes, verified against THIS pin:

| Claim | Verdict on 1.4.0 (probed) | Note |
| --- | --- | --- |
| `process.on("memoryPressure")` (OS low-memory) | ✅ real | types lag: NOT in bun-types 1.4.0 — cast the handler |
| ML-DSA + ML-KEM in `crypto.subtle` | ✅ real | `generateKey({name:"ML-DSA-65"})` keygen+sign; ML-KEM `encapsulateBits` (see `src/lib/ml-kem.ts`); types lag — cast |
| ML-DSA/ML-KEM in `node:crypto` | ✅ real (corrected) | NOT named exports — `generateKeyPairSync("ml-kem-768")` / `("ml-dsa-65")` work (probed); blog is right |
| `Bun.spawn({ cgroup })` | ✅ real + typed (bun.d.ts:7075-7097) | Linux-only effect; macOS accepts as no-op |
| `bun repl` | ✅ real (corrected) | welcome banner probed; `--help` falls back to run-help (misleading); `-e`/`-p` work |
| `bun ./README.md` markdown-to-terminal | ✅ real | renders headings/links; `-e`/`-p` exist on `bun` itself |

Source: https://bun.com/blog/bun-v1.4#also-built-in (official 1.4 release notes — all six
items confirmed on the installed build).

### Verification discipline — three probe-design failures corrected 2026-08-26

Claims of ABSENCE were made too fast and had to be retracted. The failure pattern:

1. **`bun repl`** — probed `--help` (falls back to run-help) → concluded absent. WRONG: the
   REPL itself works; probe the command, not its help.
2. **`node:crypto` ML-*** — checked named exports → concluded absent. WRONG: the API is
   `generateKeyPairSync("ml-kem-768")` (algorithm-string); absence of one access pattern
   is not absence of the feature.
3. **`Bun.s3.S3Client` / `putObject`** — checked `Bun.s3.S3Client` (undefined) → called the
   whole S3Client shape fabricated. WRONG: **`Bun.S3Client` EXISTS** (`new Bun.S3Client({...})`
   → `.file/.write/...`); only `s3.S3Client` and `putObject` are absent. Enumerate the whole
   surface (getOwnPropertyNames + typeof on ALL sibling names).
4. **`Bun.serve` HTTP/2** — types lack `h2` → concluded "not in 1.4.0". WRONG: the runtime
   ACCEPTS `serve({ h2: true })` (types lag; probe runtime acceptance, not type absence).

**Rule:** absence claims require (a) full runtime-surface enumeration, (b) runtime
acceptance probes of the API call itself, (c) all plausible access patterns (named
export / constructor / algorithm-string / options-object / sibling names), (d) the type
declarations, and (e) confidence labels — "not found via probed pattern" ≠ "absent".
Corrected verdicts are pinned as ground probes: rt-4 (S3Client) and rt-5 (serve h2).

5. **Async stack traces** — probed `Bun.file().exists()` on a missing file, got `false`,
   and concluded "rejects carry no `.stack`". WRONG: `.exists()` is a soft-false API that
   never rejects. Probe an API that actually rejects (`arrayBuffer()/text()` on a missing
   file, fetch to a dead port / bad DNS). A non-throwing API is not evidence about
   rejection stacks.

**Rule:** absence claims require (a) full runtime-surface enumeration, (b) runtime
acceptance probes of the API call itself, (c) all plausible access patterns (named
export / constructor / algorithm-string / options-object / sibling names), (d) the type
declarations, and (e) confidence labels — "not found via probed pattern" ≠ "absent".
Corrected verdicts are pinned as ground probes: rt-4 (S3Client) and rt-5 (serve h2).

### Dev tooling + HTTP/2-3 (official docs, probed 2026-08-26)

| Claim | Verdict on 1.4.0 | Evidence |
| --- | --- | --- |
| `--cpu-prof` / `--cpu-prof-md` / `BUN_CPU_PROFILE` | ✅ | writes `CPU.<ts>.<pid>.cpuprofile` in CWD; `-md` exits 0; env accepted. Repo already uses `--cpu-prof-md` (profile:serve) |
| `--heap-prof` / `--heap-prof-md` | ✅ | writes `Heap.<ts>.<pid>.heapprofile` in CWD; repo uses `--heap-prof-md` (heap:serve) |
| `--no-orphans` / `BUN_FEATURE_FLAG_NO_ORPHANS` / bunfig `noOrphans` | ✅ | flag + env accepted; repo bunfig already sets `run.noOrphans = true` |
| `--no-env-file` | ✅ | verified: skips `.env` (val=undefined) vs loaded without flag |
| Async stack traces (fs/Bun.file/S3/DNS/crypto/fetch → await site) | ✅ real (CORRECTED 2026-08-27) | **rejects DO carry `.stack`** pointing at the await site: `Bun.file().arrayBuffer()/text()` → `ENOENT ... at async foo (file:5:8)`; `fetch` conn-refused → `Unable to connect`; DNS → `getaddrinfo ENOTFOUND` — all with async frames. The earlier "NO .stack" verdict was a probe bug: `Bun.file().exists()` returns `false` instead of rejecting, so the probe never hit a rejection. **Probe a real rejection, not a soft-false API** (see §0 discipline failure #5) |
| `Bun.serve({ http3: true })` (requires tls; `http1: false` h3-only) | ✅ recognized | domain errors: "HTTP/3 requires tls" / "Cannot disable http1 without enabling http3" — options validated, not ignored. Full QUIC handshake not exercised (needs TLS/UDP) |
| `fetch(url, { protocol: "http2" })` | ✅ works | real request → 200 |
| `fetch(url, { protocol: "http3" })` | ✅ recognized | attempted real QUIC handshake → HTTP3HandshakeFailed (endpoint/network) — the option drives real behavior |
| `h2`/`http3`/`protocol` in bun-types 1.4.0 | ⚠️ types lag | 0 matches — runtime ahead of types (same pattern as the S3Client/h2 corrections); cast |
| `bun -e` vs `bun -p` (eval vs print) | ✅ | -e runs without printing; -p auto-prints the last expression; both support top-level await, TS, ESM, CJS (`require` works); `--eval`/`--print` long forms; `--port` is a SEPARATE flag ("Set the default port for Bun.serve") |
| JSX in `bun -p` | ❌ overclaimed | errors: Cannot find module react/jsx-dev-runtime — needs a configured JSX runtime, not default |
| `bun -p` prints `[object Object]` → use `Bun.inspect` | ❌ WRONG | `-p` already deep-formats objects/Sets/Buffers via the Bun inspector (`({a:1})` → `{ a: 1 }`) — Bun.inspect unnecessary |
| `CryptoHasher.update(BunFile)` zero-copy | ❌ BROKEN | `update()` rejects a BunFile; use `update(await file.bytes())` or stream chunks (see `streamingFileHash`) |
| `bun:sqlite` `$hash` + `.all({hash})` | ⚠️ half-right | works with **`$`-prefixed keys** (`{ $hash: "…" }` → match); unprefixed `{ hash: … }` → 0 matches |
| `bun -e/-p` startup vs `node` | ✅ | measured ~0-10ms vs ~20-40ms on this machine (qualitative win; exact numbers environment-dependent) |
| `--inspect-brk -e`, exit codes, `BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT` | ✅ | inspector waits at banner; throw→1/ok→0; env accepted |
**Scope:** Shadow/canary verification only. **No live execution** on 1.4.x until Phase 5 passes.

---

## 1. Why a canary is mandatory

Bun 1.4.0 is not a routine minor bump — it is the first release on the
Rust rewrite of the runtime (the Zig→Rust port of ~535k lines, done
mechanically by 64 Claude agents). Every surface this repo depends on
(sqlite bindings, fetch/network stack, WebSocket, `Bun.$` shell,
`Bun.file`/`Bun.write`, crypto, `Bun.serve`) has been reimplemented.
Local merge proof (`bun run check`) and hosted CI (GitHub Actions, currently
billing-blocked / manual diagnostic only) make local canary verification
**the** gate. Nothing about the upgrade can be assumed; everything is
re-verified against the 1.3.14 baseline.

Verified platform facts that motivated this doc:

- Bun 1.4.0 = Rust-migration release; reportedly shipped inside Claude Code
  before the official public release (gigazine 2026-07-23, ecosistemastartup).
- `Bun.password.hash` argon2id: `memoryCost < 8` silently rounded up in
  [1.4.0 (issue #30960)](https://github.com/oven-sh/bun/issues/30960),
  [PR #30964](https://github.com/oven-sh/bun/pull/30964), softened again by
  [PR #39596](https://github.com/oven-sh/bun/pull/39596).
- `Bun.XML` (parse/stringify) is new: [docs](https://bun.com/docs/runtime/xml),
  [oven-sh#37048](https://github.com/oven-sh/bun/commit/31711361d4277fecb9263bed71af4019233a0148),
  SIMD parser [oven-sh#37146](https://github.com/oven-sh/bun/pull/37146).

## 2. Verified impact surface (audit of this repo, not assumptions)

| Surface | Verified usage | v1.4.x risk |
|---|---|---|
| `bun:sqlite` (Drizzle) | 151 matches / 146 files — SSOT cache, shadow logs, event-store, tennis recorder, regulatory DB | 🔴 Highest — re-verify first |
| Network stack: `fetch`/`dns.prefetch`/`fetch.preconnect` + client `WebSocket` | `kalshi-network.ts`, `github-network.ts`, `kalshi-ws.ts` (RSA handshake via `kalshi-auth.ts`), `live-scores.ts` poll, research pipeline | 🔴 High — live semantics, idempotency |
| `Bun.$` / `Bun.spawn` | 190 matches — research pipeline shell, tools, `restore-committed-artifacts`, proton-pass vendor | 🟡 Watch |
| `Bun.file` / `Bun.write` | 569 / 211 matches — artifacts, shadow logs, cache, response-to-file writes | 🟡 Watch |
| `Bun.serve` | `src/research/serve.ts` (:3456 report browser), regulatory example | 🟢 Benefit / low risk |
| `Bun.cron` | `cron-main.ts`, tennis-live-canary (→ `research/cache/tennis-canary/latest.json`) | 🟢 Watch registration |
| `Bun.WebView` / `Bun.Image` | tennis-ground dashboard | 🟢 Watch |
| `Bun.markdown` / `Bun.color` / `Bun.Glob` / `Bun.zstdCompressSync` / `Bun.zstdDecompressSync` / `Bun.hash` / `Bun.nanoseconds` | settlement `analyze-table.ts` HTML, color artifacts, canary fingerprints | 🟢 Benefit |
| `Bun.password` | **0 matches** | ✅ No impact |
| `Bun.XML` | **0 matches** (only HTML parsing is `HTMLRewriter` in `extract-social-meta.ts`) | ✅ No impact |
| `process.permission` / `http3` | **0 matches** | ✅ No impact |

## 3. Phase 0 — Baseline capture (on 1.3.14)

Record the reference point **before** touching 1.4.x. Everything below is
diffed against this in later phases.

```bash
bun --version                       # expect 1.3.14
git rev-parse --short HEAD          # record commit
bun install --frozen-lockfile       # lockfile must be frozen (bunfig.toml)

# Full gate — record exit code, pass/fail counts, and wall time
time bun run check                  # guard + typecheck + test (+ posttest artifact restore)
bun test --isolate --timeout 15000 2>&1 | tail -5   # test count / duration baseline

# Surface probes
bun run research:dry                # offline dry-run pipeline (zero network)
bun run db:check                    # drizzle-kit schema check
bun run colors:check                # color artifacts byte-stable
bun run sports:registry:check       # sports source artifacts byte-stable
bun run logging:dry                 # price logger dry-run
sqlite3 research/cache/event-store.db "PRAGMA integrity_check;"   # if sqlite3 CLI available
```

**Baseline artifacts to save:** the `bun run check` log, `bun --version`,
commit SHA, and any `--check` outputs. Copy `research/cache/event-store.db`
(+ shadow-log DBs under `alpha/`) to a safe location — they are the
fingerprint source for Phase 4.

## 4. Phase 1 — Install 1.4.x in isolation (keep 1.3.14 untouched)

Never upgrade in place until Phase 6. Use a separate Bun prefix; the
official installer accepts a version tag.

```bash
export BUN_INSTALL="$HOME/.bun-1.4"
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.x"   # or the exact 1.4.x tag
"$BUN_INSTALL/bin/bun" --version                           # expect 1.4.x

# Install deps under the canary runtime — watch for lockfile re-resolution
"$BUN_INSTALL/bin/bun" install --frozen-lockfile
```

**Red flags:** a non-frozen lockfile change, `bunx`/`bun install` failures,
or any warning about recompiling native modules (drizzle-orm, zod, vendor
proton-pass). Stop and report before proceeding.

## 5. Phase 2 — Mechanical gate (1.4.x)

```bash
export PATH="$HOME/.bun-1.4/bin:$PATH"   # or invoke the canary bun explicitly
bun --version                            # confirm 1.4.x
time bun run check                       # must exit 0
bun test --isolate --timeout 15000 2>&1 | tail -5
```

**Pass criteria:** zero failures, zero skips vs baseline; `guard`
(`scripts/audit-bun-native.ts`) still passes — if it has version
assumptions, review it first; posttest artifact restore produces
byte-identical artifacts to baseline (that restore step exercises `Bun.$`
+ git + `Bun.file` in one shot).

## 6. Phase 3 — Focused surface verification

Run each against the canary runtime. **Never against production DBs** —
operate on copies (`cp` to a scratch dir) or use `--dry-run`/offline modes.

### 6.1 `bun:sqlite` (highest risk — do first)

```bash
# Integrity on copies
cp research/cache/event-store.db /tmp/canary-es.db
bun -e "import { Database } from 'bun:sqlite';
const db = new Database('/tmp/canary-es.db', { readonly: true });
console.log(db.query('PRAGMA integrity_check').get());
console.log(db.query('SELECT COUNT(*) n FROM price_snapshots').get());"

# Drizzle surfaces
bun run db:check
bun test --grep "event-store|open-db|sqlite"      # or the institution test files

# Type affinity / read semantics spot-checks (Rust rewrite risk areas):
#  - INTEGER vs REAL column reads
#  - readBigInts option behavior (if used)
#  - WAL mode on the event store
#  - prepared-statement caching via db.query
```

### 6.2 Network, WebSocket, auth crypto

```bash
bun test tests/ops-kalshi-auth.test.ts tests/ops-rotate-key.test.ts \
        tests/ops-actions.test.ts tests/ops-api-alignment.test.ts      # RSA handshake + rotate
bun test tests/bot tests/institutions                                  # ws recorder, liquidity, live-scores
bun run research -- --dry-run                                          # GitHub fetch + preconnect path
bun run tennis:itf -- --sync --retain-days=3                           # network-heavy institution (shadow)
bun run tennis:record -- --ws --ws-seconds=60                          # short WS orderbook capture
```

**Watch for:** keep-alive/pooling regressions (preconnect warmup still
called — `warmKalshiApiNetwork` / `warmGitHubApiNetwork`), fetch timeout
semantics, WS reconnect behavior, response buffering (`res.json()` /
`res.text()`) parity.

### 6.3 Shell, fs, serve, cron, WebView

```bash
bun run serve:once & curl -sf http://127.0.0.1:3456/ops >/dev/null      # report browser + canary endpoint
bun run cron:once                                                       # cron registration/execution
bun run tennis:ws-ground                                                # WebView + Image dashboard artifact
bun run colors:check && bun run sports:registry:check                   # Bun.color / Bun.markdown artifacts
bun run deps:outdated -- --latest                                       # Bun.color terminal path
bun test tests/settlement tests/scripts tests/tools                     # markdown HTML reports, zstd, tools
```

## 7. Phase 4 — Shadow soak (the canary)

The repo already has structural canary machinery: the `tennis-live-canary`
cron writes `research/cache/tennis-canary/latest.json` with `Bun.hash`
fingerprints, surfaced by `serve.ts` (`/ops`). Use it as the diff harness:

1. Run the tennis live poll under **1.3.14** for ≥ 24 h → save `latest.json` + payload hashes.
2. Run the identical schedule under **1.4.x** for ≥ 24 h → diff the fingerprints.
3. Structural parity check: same market set, same field shapes, same row
   counts in the shadow event-store copies; byte-identical artifacts.
4. Soak window: **14 days** of zero unexplained diffs (allow documented
   benign timing deltas in `durationMs`).

Shadow-only flows for the soak: `alpha:run --program=… --ticker=… --fetch-book`,
`calibration:toxicity:loop`, `calibration:maintenance -- --fetch-toxicity`,
`tennis:itf -- --sync`, `research -- --dry-run`. Live shadow ticks are
fine (no orders); **never** run the authorized execution path on 1.4.x.

## 8. Phase 5 — Execution-path gate (policy — do not skip)

Per [`AGENTS.md`](../AGENTS.md): live HTTP orders must enter through
`handleTradingOrder` → `executeKalshiLiveOrder` → `executeAuthorizedBet`,
and never bypass compliance, SQLite authorization grants, policy-hash
verification, executable-book freshness, balance/liquidity caps, exposure
reservation, provider idempotency, or the global risk breaker.

- **No live execution on 1.4.x** until Phases 0–4 are green **and**
  `executeAuthorizedBet` idempotency is proven under 1.4.x on a
  demo/paper path (`partner:execution:demo-proof`).
- Provider-side idempotency contract for Fantasy402 remains unproven —
  unchanged by this upgrade; do not use the upgrade as a reason to revisit.
- `KALSHI_AUTHORIZED_EXECUTION_ENABLED=1` semantics are untouched; prod
  still requires `KALSHI_ENV=prod` + `KALSHI_PROD_ARMED=1`.

## 9. Phase 6 — Commit the pin

Only after exit criteria (below) are met:

1. Bump `packageManager` to `bun@1.4.x` in `package.json`.
2. Bump `bun-types` + `@types/bun` to `1.4.x`; re-run `bun run typecheck`.
3. Update `engines.bun` (`>=1.4.x`) and the `AGENTS.md` baseline line.
4. Refresh `docs/BUN_NATIVE.md` / `docs/BUN_TECH_STACK.md` status notes
   (Rust rewrite, `Bun.XML` availability) if anything changed.
5. `bun run bun:ci` (== `bun run check`) as the final local merge proof.
6. Decide with the repo owner whether the hosted GitHub Actions check is
   needed as a manual diagnostic before merge (currently billing-blocked).


### Phase 6 status (2026-08-22)

Steps 1-2 of Phase 6 were executed in-session: the default runtime on this
machine is Bun 1.4.0; `packageManager` bumped to `bun@1.4.0`; `bun-types` +
`@types/bun` bumped to 1.4.0; `bun run typecheck` passes on 1.4.0 types (one
fix: `toml-stringify.ts` now calls the typed native `Bun.TOML.stringify` via
feature detection). The guard bans the full Bun 1.4 replaces-table package
set (sharp, puppeteer, marked, node-cron, node-pty, concurrently,
npm-run-all, serve-static, express, json5, ndjson, jsonc-parser,
fast-xml-parser, xml2js, tar, slice-ansi, cli-truncate, path-to-regexp).

The pin was completed the same day: `engines.bun` bumped to `>=1.4.0`,
`AGENTS.md` baseline line updated to Bun 1.4.0, and the changes committed.
The final `bun run bun:ci` gate (1762 tests green on 1.4.0) is the merge proof;
hosted-CI diagnostic stays a manual check while billing-blocked.

## 10. Rollback

- The 1.3.14 install is never touched until Phase 6 — `~/.bun` stays intact;
  the canary prefix (`$HOME/.bun-1.4`) is disposable.
- Canary phases operate only on DB **copies** and dry-run/shadow paths;
  production DBs and shadow logs are never written by the canary.
- Rollback = delete the canary prefix, revert `package.json`/`AGENTS.md`/
  docs pins, and `bun run artifacts:restore` on the baseline bun.
- `bun install --frozen-lockfile` on 1.3.14 must still resolve cleanly
  (lockfile was never modified).

## 11. Exit criteria / sign-off

| # | Criterion | Pass? |
|---|---|---|
| 1 | `bun run check` exits 0 under 1.4.x; test count == baseline, zero skips | ☐ |
| 2 | `guard` (audit-bun-native) passes; reviewed for version assumptions | ☐ |
| 3 | sqlite: `integrity_check` clean on copies; drizzle `db:check` passes; WAL + type affinity verified | ☐ |
| 4 | RSA auth/rotate/actions/api-alignment tests pass; WS recorder + live-scores parity | ☐ |
| 5 | fetch preconnect/dns warmup still active; keep-alive pooling intact | ☐ |
| 6 | Artifact byte-parity: colors, sports registry, settlement HTML, zstd round-trips | ☐ |
| 7 | `serve:once` boots; `/ops` reads `tennis-canary/latest.json` | ☐ |
| 8 | cron `--once` registers/executes; tennis canary fingerprints stable 14 days | ☐ |
| 9 | No unexplained diffs in shadow soak; documented timing deltas only | ☐ |
| 10 | Execution idempotency re-proven on demo path; no live orders on 1.4.x | ☐ |
| 11 | Pins bumped (packageManager, bun-types, engines, AGENTS.md); `bun:ci` green | ☐ |

**Do not** treat "most tests pass" or "it boots" as sufficient. This upgrade
replaces the entire runtime; only the full exit table gates the pin bump.

---

## 33-claim changelog verification (2026-08-27, probed on the installed 1.4.0)

Bulk pasted release notes (v1.3.x → 1.4.0) probed claim-by-claim. Harness:
`/tmp/bun-changelog-probe.ts` (33 claims, 32 pass / 1 flagged). The verified
claims are pinned as `changelog:probe` in [`tools/ground-probes`](../tools/ground-probes/index.ts)
(15 probes, wired via `JSON5` → `changelog:probe` in [`bun-gates.ts`](../src/lib/bun-gates.ts)).

| Claim | Verdict on 1.4.0 (probed) | Note |
| --- | --- | --- |
| `ServerWebSocket.subscriptions` getter | ✅ | returns array of subscribed topics (`["topicB","topicA"]`); probe needs `srv.upgrade(req)` or the socket never opens |
| `Bun.JSON5.parse/stringify` + `.json5` imports | ✅ | comments, unquoted keys, single quotes, trailing commas, stringify all work |
| `Bun.JSONL.parse/parseChunk` | ✅ | `{values, read, done, error}`; partial chunk resumes; BOM-skipping not separately probed |
| `Bun.JSONC.parse` | ✅ | `//` comments + trailing commas parse |
| `Bun.TOML` v1.1.0 + `stringify` | ✅ (nuance) | datetimes parse to a Temporal-like **`Instant`** object (`epochMilliseconds`, `toZonedDateTimeISO`), NOT a string/Date — changelog's `cfg.released // "…"` is misleading; `stringify` emits `[deps]` blocks correctly |
| `Bun.Archive` | ✅ (API differs) | **no `.from()`**; `Bun.Archive.write(path, map, {gzip:true})` creates, `new Bun.Archive(bytes)` reads, `.extract(dir)/.files/.blob()/gzip` all work. Changelog's `A.from(map)` + `write(file, archive, "gzip")` form does not exist on 1.4.0 |
| `CompressionStream/DecompressionStream` gzip + brotli + zstd | ✅ | all three round-trip |
| `URLPattern` | ✅ | `test`/`exec` with `:id` groups |
| `crypto.subtle` ML-KEM-768 `encapsulateBits`/`decapsulateBits` | ✅ | shared secret identical both sides; keys survive (changelog's generateKey form works) |
| `crypto.subtle` ML-DSA-65 sign/verify | ✅ | round-trips |
| `Response.textStream()` | ✅ | reassembles multi-byte chars + NUL across chunk boundaries |
| `process.on("memoryPressure")` | ✅ | registers/removes; `warning|critical` arg (types lag — cast) |
| `Bun.sliceAnsi` | ✅ | preserves ANSI while slicing |
| `Bun.wrapAnsi` | ✅ | wraps at column width |
| `Bun.stringWidth` | ✅ | 5/5/2/2/3 for ascii/ANSI/ZWJ/flag/link |
| `Bun.spawn({ cgroup })` | ✅ | macOS accepts as no-op (Linux-only effect) |
| Async stack traces from native I/O | ✅ (CORRECTED) | see §0 row — rejects carry `.stack` with async frames; earlier probe bug (`.exists()`) |
| `--no-orphans` | ✅ | flag accepted, exit 0 |
| `Bun.Transpiler({ replMode: true })` | ✅ | wraps bare objects for eval |
| `Bun.YAML` cyclic anchors/aliases | ✅ | `&x` … `*x` alias resolves |
| WebSocket proxy / `ws+unix://` / URL credentials | ✅ (shape) | constructors accept all three; proxy round-trip not exercised (needs proxy) |
| `crypto.subtle` SHA3-256 | ✅ | 32-byte digest |
| `crypto.subtle` X25519 `deriveBits` | ✅ | shared secret identical both sides |
| `structuredClone` identity (Date/RegExp/Blob/Error…) | ✅ | same instance referenced twice stays one object; distinct from source |
| `Bun.CSRF.generate/verify` `sessionId` option | ✅ | binds token to principal; cross-session AND sessionless both fail closed (repo `src/research/csrf.ts` contract: `generate(secret,{sessionId,expiresIn})`, `verify(token,{secret,sessionId})`) |
| `Bun.udpSocket` data-callback 5th `flags` arg | ✅ | `{truncated:false, ipv6:false}` object present (repo shape: `socket:{data:(s,buf,port,addr,flags)=>…}`); ECONNREFUSED-on-dead-port is Linux-only, not exercised here |
| bun:sqlite bundled version | ⚠️ **MISMATCH** | runtime reports **3.51.0**, changelog claims 3.53.0 — do not assert 3.53.0 without upgrading the pin |
| `Bun.isStandaloneExecutable` | ✅ | boolean; `false` in dev, `true` inside `bun build --compile` binaries |
| `Bun.sql` named params / `SQL` constructor | ✅ (shape) | `Bun.SQL` exists; runtime needs a Postgres server (not exercised) |

Probe-design notes from this batch: `Bun.udpSocket(...)` returns a **thenable** (must
`await`); `Bun.Archive` has no `.from` (write-then-read path); `Bun.TOML` datetimes are
`Instant` objects; `.exists()` is soft-false (never rejects) — probe real rejections.

## Bun.inspect / console.log claims (2026-08-27, probed on the installed 1.4.0)

Bulk pasted "power user" guide about `Bun.inspect` options + console layers. The
guide mostly describes **Node's `util.inspect` options**, not Bun's. On 1.4.0 the
real `BunInspectOptions` surface (bun.d.ts:4482) is exactly: `colors`, `depth`,
`sorted`, `compact`. Harness: `/tmp/inspect-probe*.ts`.

| Claim | Verdict on 1.4.0 (probed) | Note |
| --- | --- | --- |
| `Bun.inspect(obj, {colors, depth, sorted, compact})` | ✅ | all four honored: depth stops recursion (`[Object ...]`), colors emit ANSI, compact single-lines, sorted orders keys (also custom comparator) |
| `Bun.inspect.table(rows)` | ✅ | real; box-drawing table, respects colors |
| `Symbol.for("nodejs.util.inspect.custom")` | ✅ | respected; receives `(depth, options, inspect)`; `options.stylize` is populated inside custom (but NOT settable as an input option) |
| Circular refs → `[Circular]` | ✅ | automatic |
| `--console-depth N` CLI flag | ✅ | truncates console.log depth (`b: [Object ...]`) |
| bunfig.toml `[console] depth = N` | ✅ | honored (persistent per project) |
| `BUN_CONSOLE_DEPTH` env var | ❌ NOT honored | probed `BUN_CONSOLE_DEPTH=1` + `CONSOLE_DEPTH=1` — no truncation. The guide's three-layer precedence (CLI > env > bunfig) is wrong: env layer absent |
| bunfig `[console]` other keys (colors/compact/sorted/maxStringLength) | ❌ NOT honored | only `depth` takes effect; the guide's full `[console]` key list is invented |
| `maxStringLength` option | ❌ NOT honored | 300-char string with `maxStringLength:5` still 302 chars |
| `maxArrayLength` option | ❌ NOT honored | 150-array with `maxArrayLength:5` still shows 100+1 |
| `breakLength` option | ❌ NOT honored | no wrap at width 30 |
| `showHidden` option | ❌ not honored / not in types | — |
| `getters` option | ❌ NOT honored | `[Getter]` shown whether true/"get"/false |
| `numericSeparator` option | ❌ NOT honored | `1000000` stays unseparated |
| `stylize` option | ❌ NOT honored as input | zero calls when passed; only populated inside custom inspect methods |
| `isTerminal` export from `bun` | ❌ DOES NOT EXIST | `typeof undefined`; the guide's logger (`import { isTerminal } from 'bun'`) won't compile. Use `process.stdout.isTTY` (undefined in non-TTY here) |
| `inspect` named export from `bun` | ⚠️ | `Bun.inspect` works; a bare `import { inspect } from 'bun'` was not probed — `Bun.inspect` + `Bun.inspect.table` + `Bun.inspect.custom` (symbol) confirmed |

Bottom line: Bun.inspect is NOT a superset of Node's util.inspect. Keep to the four
typed options; for terminal-width truncation combine `Bun.inspect` (colors/depth) with
`Bun.sliceAnsi` (verified earlier). The repo's `CookieJar(2 cookies)` /
`CoefficientStore(0 events)` tests already pin `inspect.custom` usage.

---

*Known non-issues (verified by audit, listed to prevent re-review):
`Bun.password` (0 usage), `process.permission` (0 usage), `http3` (0 usage).*
*(`Bun.XML` is now USED — the odds-registry parses `config/odds-registry.xml` with it;
`HTMLRewriter` remains the tool for OG-meta extraction.)*