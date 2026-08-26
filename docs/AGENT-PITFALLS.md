# Agent working notes: pitfall catalog (read before editing)

Everything below is a real failure observed in this session, with the fix that
unblocks it. Order matters: run_code -> file tools -> bash/git -> tests -> verification.

> **Numbering convention:** "pitfalls N" / "section N" references in this file
> and across the repo are HISTORICAL lesson counters from the 2026-08 audit
> rounds (the N-th lesson added) - NOT pointers to the §1-§11 headings above.
> The headings were renumbered to §1-§11 on 2026-08-23; the counters were kept
> so historical notes stay traceable.
>
> **Current contract status: verify:contracts 59/59** (see docs/BUN_API_COVERAGE.md
> for the full matrix). `verify:contracts N/N` lines inside older sections are
> HISTORICAL (each records its era) — docs:check enforces that only this header
> and non-pitfall docs may reference the current count.


## Section index — 178 lessons

> Navigation aid. §1-§11 are the topical headings; §12+ are the historical
> lesson counters (see the header note above).

- §1 — run_code program text (the harness lexer)
- §2 — Calling the tools
- §3 — bash / git
- §4 — bun:test
- §5 — Verification discipline (Bun APIs, docs, claims)
- §6 — Tooling sharp edges (beyond the lexer)
- §7 — Repo-domain facts (hard-won)
- §8 — Bun utilities that defuse the failure classes (all PROVEN in this session)
- §9 — Bun Shell (`Bun.$`) switch — verified API surface (2026-08-23)
- §10 — Grep discipline + Node->Bun spawnSync (2026-08-23)
- §11 — Docs-grounding: a word across Bun docs pages is NOT a concept (2026-08-23)
- §12 — Bun.Image 1.4.0 — file-based decode/meta, NO rasterizer (2026-08-24)
- §13 — Bun.serve video Range/206 + data-URL inlining pitfall (2026-08-24)
- §14 — Bun.serve routing precedence + param-route traversal guard (2026-08-24)
- §15 — Bun.Networking claims probed (2026-08-24) — what the marketing copy gets wrong
- §16 — Streams + terminal primitives probed (2026-08-24) — the observability widgets
- §17 — Built-in utilities + fetch client probed (2026-08-24) — updated widgets
- §18 — WebView in the merge gate — final call (2026-08-24)
- §19 — GitHub releases.atom feed folded in (2026-08-24)
- §20 — Install/test tooling folded in (2026-08-24)
- §21 — Bun.cron signal channel + dynamic dashboard (2026-08-24)
- §22 — Bun color stack probed (2026-08-24) — what the marketing copy gets wrong
- §23 — Integrated architecture probed (2026-08-24) — feed + theme + live channel
- §24 — Content hashing probed (2026-08-24) — Bun.sha, CryptoHasher, ETags
- §25 — Content pruning probed (2026-08-24) — archive vs delete, .trash/
- §26 — Archive + prune-channel + dynamic content verified (2026-08-24)
- §27 — Deepen pass: markdown render, FFI, restore (2026-08-24)
- §28 — Bun 1.4 security hardening probed (2026-08-24) — release-blog security section
- §29 — Faster / build / test / install claims probed (2026-08-24)
- §30 — Full sub-header mapping — every anchor's sub-headers to the repo (2026-08-24)
- §31 — Blog → repo mapping TRACKER (2026-08-24) — automatic, contract-gated
- §32 — Native markdown automation — heading ids, GFM, child tracking (2026-08-24)
- §33 — Bun.markdown documented API surface — CORRECTION (2026-08-24)
- §34 — Bun.markdown FULL API matrix (2026-08-24) — systematic, no more gaps
- §35 — Bun.markdown — release version + React target (verified, not guessed) (2026-08-24)
- §36 — Poor-grounding audit — claims corrected to their real evidence level (2026-08-24)
- §37 — Deeper grounding audit — the full claim surface re-checked (2026-08-24)
- §38 — Repo docs managed by Bun.markdown (2026-08-24)
- §39 — Dev tooling / HTTP3 / static / conditional / compression probed (2026-08-24)
- §40 — Automation pass — better Bun usage (2026-08-24)
- §41 — Deeper automation — consolidate + native conversions (2026-08-24)
- §42 — Bun.which() probed (2026-08-24) — the which-replacement, with PATH semantics
- §43 — Bun utils probed — deepEquals, escapeHTML, randomUUIDv7, version (2026-08-24)
- §44 — Utils page re-probed — the missed items + Options section (2026-08-24)
- §45 — Hand-rolled vs native — the honest test (2026-08-24)
- §46 — assets:check gate — content-hashed images via Bun.markdown hooks (2026-08-24)
- §47 — Bun.Transpiler probed (2026-08-24) — transform/scan + Import.kind
- §48 — Transpiler deeper — options + parse oracle (2026-08-24)
- §49 — Transpiler constructor loader (2026-08-24) — the anchor's option
- §50 — Transpiler full options surface — the last unprobed ones (2026-08-24)
- §51 — Import.kind — separated + highlighted reference + CSS correction (2026-08-24)
- §52 — Type-only imports/exports CORRECTION (2026-08-24) — the docs were right
- §53 — Transpiler deeper — accuracy, options, imports:graph (2026-08-24)
- §54 — bun pm pkg + bun pm version — native package.json editing (2026-08-24)
- §55 — Production / Observability / Streams probed (2026-08-24)
- §56 — "We rewrote Bun in Rust" — verified + resolves the §35 contradiction (2026-08-24)
- §57 — Context + fetch defaults — two corrections (2026-08-24)
- §58 — "grep -c bullet count" proposal — probed + rejected for the smart gate (2026-08-24)
- §59 — Docs code-block validation via Bun.Transpiler (2026-08-24)
- §60 — Language-specific docs code-block validation — bash continuation join (2026-08-24)
- §61 — Bundler plugins doc — namespaces + runtime claims probed (2026-08-24)
- §62 — docs:api — validate every Bun.<token> in docs against the runtime (2026-08-24)
- §63 — docs:integrity — internal links + import resolution gate (2026-08-24)
- §64 — Output-assertion gate — REJECTED after grounding probe (2026-08-24)
- §65 — Docs vs source alignment — src-ref gate (2026-08-24)
- §66 — Exported-symbol alignment — docs import names vs source exports (2026-08-24)
- §67 — Deeper integration — docs quality surfaced on the dashboard (2026-08-24)
- §68 — Bun.XML doc — probed, 33/33 verified, 11th gate (2026-08-24)
- §69 — Production-grade pipeline doc — grounded, one real gap closed (2026-08-24)
- §70 — Bun.Image doc — probed 20/20, ONE geometry-ordering correction (2026-08-24)
- §71 — Team-logo ingestion doc — rejected (no consumer), ONE error-code correction (2026-08-24)
- §72 — On-the-fly resize doc — pattern rejected (no consumer), resize signature CORRECTED (2026-08-24)
- §73 — Unified teams registry — the pattern, and how branding/API fits (2026-08-24)
- §74 — Dashboard action buttons — dead-button gap found + fixed (2026-08-24)
- §75 — Remaining-touchpoints doc — table WRONG (all already integrated) + /status endpoint (2026-08-24)
- §76 — Infrastructure machinery probe — rate limiter + memoryPressure (2026-08-24)
- §77 — CSRF machinery probe — session binding verified, 14th gate (2026-08-24)
- §78 — Cookie APIs — native usage verified + a native-API limitation found (2026-08-24)
- §79 — Bun cookie docs — full property surface probed, 15th gate (2026-08-24)
- §80 — HTTP-cookies doc — delete behavior verified, extends §79 (2026-08-24)
- §81 — API defaults cross-reference — hostname doc correction + explicit binds (2026-08-24)
- §82 — More API defaults — transpiler jsx default, inspect depth, write/hash/hasher (2026-08-24)
- §83 — Port env vars — BUN_PORT/PORT/NODE_PORT precedence pinned + serve.ts enhanced (2026-08-24)
- §84 — BUN_* env vars — transpiler cache, verbose fetch, NODE_ENV default (2026-08-24)
- §85 — .env load order — .env.local SKIPPED in test (config.ts comment corrected) (2026-08-24)
- §86 — New-claims doc (markdown/cron/terminal/ffi/dev-tooling) — BUN_CPU_PROFILE contradiction RESOLVED (2026-08-24)
- §87 — Serve-files/folders + Range/conditional + fetch compress doc — verified (2026-08-24)
- §88 — Bun v1.4 release doc — Temporal default verified, rest already probed (2026-08-24)
- §89 — Temporal adopted — parseTennisDataDate real-date validation (2026-08-24)
- §90 — Official breaking-changes list (issue #28792) — 2 audit checks added (2026-08-24)
- §91 — Package-manager doc — every command already adopted + verified (2026-08-24)
- §92 — licenses:gate — pm-licenses output promoted to a contract gate (2026-08-24)
- §93 — licenses:gate v2 — config-driven policy, scoped exemptions, SBOM logbook (2026-08-24)
- §94 — licenses:gate v2.1 — remediation hints + offline audit overlay (2026-08-24)
- §95 — Operator's manual — probed, corrected, folded (2026-08-24)
- §96 — SPDX expressions + expiry warning window + --config (2026-08-24)
- §97 — Licenses on the live surface — /status + ops dashboard (2026-08-24)
- §98 — The SBOM-diff misconception resurfaced (2026-08-24)
- §99 — Weekly overlay refresh — follow the cron-main idiom, not ad-hoc scripts (2026-08-24)
- §100 — Fail-closed bun pm resolution + --overlay flag (2026-08-24)
- §101 — Review pass — flag helper, snapshot guard, operator-format e2e, gate pattern codified (2026-08-24)
- §102 — SPDX WITH exceptions + pseudo-license diagnostics (2026-08-24)
- §103 — licenses:report — static compliance artifact for legal/release sign-off (2026-08-24)
- §104 — Compliance channel + CycloneDX XML SBOM (2026-08-24)
- §105 — Content-addressed CycloneDX serial + artifact cross-link (2026-08-24)
- §106 — Proactive compliance alerts — Telegram push from the weekly job (2026-08-24)
- §107 — Combined pipeline report — the founding mtafile ask completed (2026-08-24)
- §108 — Transient url-health flake fixed at the source — probeHttp retries network-level failures once (2026-08-24)
- §109 — Build-system changelog probed — 9/9 verified, 2 doc claims corrected (2026-08-24)
- §144 — maps.toml triple-lock landed (2026-08-25)
- §145 — Channel + route registries (2026-08-25)
- §110 — Trap-removal protocol — prevention, not accumulation (2026-08-24)
- §146 — Live GitHub budget channel + release-driven docs drift (2026-08-25)
- §147 — Bun.semver is inconsistent on ragged versions (2026-08-25)
- §148 — Bun.semver docs review — verified + 2 undocumented behaviors (2026-08-25)
- §149 — Bun.semver deep matrix + shared SSOT (2026-08-25)
- §150 — Global-attribution code search — 14x cheaper inspect (2026-08-25)
- §111 — bun:sqlite surface probed — 9/9 verified, bigint option CORRECTED (2026-08-24)
- §112 — Bun.serve streaming probed — SSE push pattern grounded (2026-08-24)
- §151 — Global-attribution code search REVERTED — completeness beats cost (2026-08-25)
- §113 — Bun.spawn probed — gate behaviors locked (2026-08-24)
- §114 — Bun.serve WebSocket surface probed — live channel ground truth (2026-08-24)
- §115 — API-table audit — Bun.semver/JSON5 verified, two rows CORRECTED (2026-08-24)
- §116 — ws:probe deep-dive audited — pong payload verified, three claims corrected (2026-08-24)
- §117 — Bun.Image API correction probed — every claim VERIFIED, probe extended (2026-08-24)
- §125 — fetch h2 version history — NOT a 1.4 feature (correction, user-flagged) (2026-08-24)
- §124 — serve-h2 correction triple-confirmed — docs + blog + runtime (2026-08-24)
- §123 — serve-tls:probe — TLS works, http2 option is a NO-OP (CORRECTED) (2026-08-24)
- §122 — routes:probe — Bun.serve routes API locked, non-working forms pinned (2026-08-24)
- §121 — node:quic listen() pinned non-functional — deep QUIC probe (2026-08-24)
- §120 — Blog anchor 'replay / quic' probed — node:quic + serve http3 verified (2026-08-24)
- §119 — Release-blog mp4s — why NOT to adopt them (probed, §118 follow-up) (2026-08-24)
- §118 — Bun 1.4 blog replayed via claims-audit + mp4/assets review (2026-08-24)
- §126 — Bun.cron granularity + overlap — 5-field only, no self-overlap (2026-08-24)
- §127 — Bun Shell — $ from "bun" (not global), 12-claim surface verified (2026-08-24)
- §128 — Bun.cron missed-fire policy — SKIP (lost, not deferred) (2026-08-24)
- §129 — HTML imports, standalone-HTML builds, HTMLRewriter — 14-claim surface (2026-08-24)
- §130 — Bundler internals — splitting, macros, env inlining, plugins (2026-08-24)
- §131 — Filesystem layer — Bun.file/Bun.write, zlib+zstd, mmap, loaders, Archive (2026-08-24)
- §132 — 100%-coverage goal round 1 — matrix + ANSI + crypto clusters (2026-08-24)
- §133 — Coverage goal round 2 — format + fsx clusters (2026-08-24)
- §134 — Coverage goal final round — net + runtime-misc clusters, matrix COMPLETE (2026-08-24)
- §135 — Fence lang contract — Bun-native tags, @bun-run execution (2026-08-24)
- §136 — Git language stats — .gitattributes (Linguist) vs fence lang (2026-08-24)
- §137 — bun:test runner surface — the gate IS a test file (2026-08-24)
- §138 — bun:test deeper — fake timers, failing/if/concurrent, file snapshots (2026-08-24)
- §139 — fetch/HTTP client semantics — keep-alive, redirects, abort, streams (2026-08-24)
- §140 — node: module behavior on Bun 1.4.0 — compat gate #41 (2026-08-24)
- §141 — Pattern enhancements — Bun.$ in the design pipeline, §128 catch-up visibility (2026-08-24)
- §142 — Bun.Transpiler internals — scan APIs the repo enforcement relies on (2026-08-24)
- §143 — Transpiler grounded in runtime/transpiler.mdx — 8 doc claims verified (2026-08-24)
- §152 — Reference/pointer staleness audit — renumbering + uniqueness gate (2026-08-24)
- §153 — bun:sqlite deep — strict mode, query.as, serialize, transactions (2026-08-24)
- §154 — HTTP/2 fetch multiplexing + serve protocol semantics (2026-08-24)
- §155 — Bun.build metafile schema — the mtafile contract verified (2026-08-24)
- §156 — Reprobe + pointer/contract hardening (2026-08-24)
- §157 — Enhanced-ecosystem-diagram claim audit — gate #46 (2026-08-24)
- §158 — Full-surface gap closed — the honest completeness picture (2026-08-24)
- §159 — Systematic-risk gates — version pin + type drift (2026-08-24)
- §160 — Server-backed client shapes — RedisClient/S3/postgres/FSR depth (2026-08-24)
- §161 — bun test --coverage semantics — gate #51 (2026-08-24)
- §162 — Fullstack combo + permessage-deflate — gate #52 (2026-08-24)
- §163 — Matrix generator promoted to committed tooling (2026-08-24)
- §165 — Hardcoded values made auto — counts sync (2026-08-24)
- §164 — Realignment executed — hq-app chunking + two real bugs found (2026-08-24)
- §166 — Allowlist/keep-list staleness auto-detected (2026-08-24)
- §167 — Gate count derived structurally — heuristic regexes gone (2026-08-24)
- §168 — Full Bun shape generated structurally — tools/bun-shape.json (2026-08-24)
- §169 — shape:probe gate — full-shape runtime agreement + exhaustive matrix (2026-08-24)
- §170 — Per-module shape report — docs/BUN_MODULE_SHAPE.md (2026-08-24)
- §171 — Full-shape probe coverage closed — 0 GAPs + a broken-API pin (2026-08-24)
- §172 — Test-suite isolation flake fixed — bun test --isolate (2026-08-24)
- §173 — Module report pulls REAL code examples (2026-08-24)
- §174 — Repo API grounded in the shape — docs/REPO_API_BUN.md (2026-08-24)
- §175 — bun:* reference module plane — grounded on bun.com/reference (2026-08-24)
- §176 — Automatic ETag/304 behavior probed — one docs claim corrected (2026-08-24)
- §177 — BuildArtifact gotchas probed — two docs corrections (2026-08-24)
- §178 — Reference cross-check — official bun-types docs vs observed evidence (2026-08-25)
- §179 — Markdown probe artifacts — three false no-ops + one bogus discrepancy found by a third-party test (2026-08-26)
- §180 — react() override props: capture timing — function overrides only render under React (2026-08-26)
- §181 — scratch-docs automation — index freshness gate + import-guard pitfall (2026-08-26)
- §182 — Utility surfaces grounded — Glob / CryptoHasher / password / escapeHTML / deepEquals (2026-08-26)
- §183 — Blog-assets mirror — public/blog/ + /blog/* serve route + gate #58 (2026-08-26)
- §184 — Blog-map v2 — full-tree registry (13 sections, h3+h4, context fields) (2026-08-26)
- §185 — Strict typing migration — tsconfig + 661 errors fixed, behavior preserved (2026-08-26)
- §186 — Blog benchmark + code-block verification — numbers and examples grounded (2026-08-26)
- §191 — Code mode — the bash execution-tier gate (docs/CODE_MODE.md) (2026-08-26)
- §192 — Bun.XML grounded + async-IIFE evidence bug (2026-08-26)
- §193 — Heap-based odds clustering — min-heap Prim MST + HDBSCAN-lite + z-score pitfall (2026-08-26)
- §194 — Artifact interface — uniform contract for bundles/tiles/manifests/XML + two proposal corrections (2026-08-26)
- §195 — Bun 1.4 perf mapping — most proposal items ALREADY active here + 2 new grounded facts (2026-08-26)
- §196 — Consensus tracker — steam-move shifts wired + k-default bug (2026-08-26)
- §197 — Styled integration — alpha:cluster --styled via markdown.ansi + Bun.Terminal PTY pin (2026-08-26)
- §198 — Bun.YAML grounded — YAML 1.2 semantics confirmed (159 claims) (2026-08-26)
- §200 — Bun.mmap grounded — live-updating Uint8Array + MAP_SHARED write-through (2026-08-26)
- §201 — Live consensus stream — ConsensusTracker wired into a repeated-snapshot consumer (2026-08-26)
- §202 — Bun.inspect + inspect.table — table options (properties filter + colors) grounded (2026-08-26)
- §203 — Managed agent CLI — schedule register/remove/preview + offline daily ground/report cron (2026-08-26)
- §204 — Bun.which — absolute path/null, PATH override, cwd anchors relative commands + PATH entries (2026-08-26)
- §205 — CLI polish audited — fictional desk.ts shell, color caller-gate truth, --format via Bun.YAML (2026-08-26)
- §206 — alpha:cluster deeper — --help, --glob via Bun.Glob, --verbose membership table (2026-08-26)
- §207 — CLI parsing audited — official guide mandates util.parseArgs; alpha:cluster migrated (2026-08-26)
- §208 — Hand-rolled CLI parsing sweep — all tools/* migrated to util.parseArgs (2026-08-26)
- §209 — Sweep extended — src/calibration + scripts/* all on util.parseArgs (2026-08-26)
- §210 — bun -p/-e one-liners audited — inspect-style output (not JSON), {hsl} invalid (2026-08-26)
- §211 — Advanced bun -p diagnostics audited — isTerminal/getColorDepth/Bun.File undefined, deepMatch not wildcard (2026-08-26)
- §212 — Proper definitions — resolveColorMode + isBunFile + shapeMatch wired into production (2026-08-26)
- §213 — bun -p/-e evaluation engine audited — TS + top-level await verified; getters/customInspect ignored (2026-08-26)
- §214 — Odds Heat metadata audited — ETag auto-set false (S194), cron job.active absent, cluster metadata wired (2026-08-26)
- §215 — Other metadata controls audited — Bun.secrets exists but {service,name}; Bun.env writable + snapshotted; Env augmentation works (2026-08-26)
- §216 — Deeper 1.4 analysis audited — fs.rmdir({recursive}) removed (audit check #15), ML-KEM undefined, TOML v1.1 strict (2026-08-26)
- §217 — Complete deep-dive audited — 'Zig to Rust rewrite' false; static-route If-Match/If-Unmodified-Since 412 verified (2026-08-26)
- §218 — Why security wasn't secret+defined — SECRET_REGISTRY + argv-leak gate wired (2026-08-26)
- §219 — Secret-leak audit gate — repo-wide plaintext-argv scan wired into pre-commit (2026-08-26)
- §220 — Crypto/quantum truth — ML-DSA works (persistent registered key), ML-KEM keygen-only (2026-08-26)
- §221 — ML-KEM 'not callable' — SUPERSEDED by §223 (our probe read wrong property/arg order; the function works) (2026-08-26)
- §223 — ML-KEM WORKS — encapsulateBits/decapsulateBits verified + wired (ml-kem.ts + registry) (2026-08-26)
- §224 — CONFIRMATION PROTOCOL — surface first, semantics second, test-locked positive (2026-08-26)
- §225 — Probe/surface refactor — Bun.file + Bun.Glob consistency; symlink counter-lesson (2026-08-26)
- §199 — ui:regen CLI — regenerate UI artifacts from meta/variant sources + the Bun.$ template failure class (2026-08-26)
- §187 — Extended color formats — kernel-only (lch/oklab/oklch/hsv) + inverse parsers (2026-08-26)
- §188 — Watermark pipeline — ML-DSA key naming + WebView/Blob verified facts (2026-08-26)
- §189 — Color input-parsing correction — lab()/lch() parse natively, oklab/oklch/hsv/device-cmyk null (2026-08-26)
- §190 — Canonical-asset generator — fit set + CryptoHasher.hash static grounded (2026-08-26)


## 1. run_code program text (the harness lexer)

| Symptom | Cause | Fix |
|---------|-------|-----|
| Parse errors like 'Expected comma' while authoring programs | Backticks or the two-char sequence dollar-open-brace anywhere in the program text (even inside template literals) | Keep program text template-literal-free. Literal backticks and dollar-open-brace ARE safe inside double-quoted JS strings (probed). For file content needing them, build from arrays joined by backslash-n, or fromCharCode(96), or string concatenation of the two pieces. |
| Same parse errors on multi-line 'strings' | Literal newlines inside JS string literals are illegal | Every multi-line payload is a line-array joined by backslash-n, or escaped newlines. |
| Parse errors when embedding TypeScript source | TS source uses double quotes; an inner quote terminates your outer double-quoted string | Use single-quoted JS strings for lines containing double quotes (watch apostrophes), double-quoted for lines containing apostrophes, escape when both appear. |
| SILENT string truncation mid-write (file ends at a dollar sign; rest of the line + following lines vanish, tool still exits 0) | A dollar sign immediately before a quote or bracket in run_code program text: the harness lexes `$'...'` (ANSI-C quoting), `$"..."` (locale quoting) and `$[...]` (arithmetic) bash-style, truncating the double-quoted JS string at that point | Never put `$` adjacent to a quote or `[` inside run_code strings. Build it with String.fromCharCode(36) in the FILE source (e.g. `'$RefreshSig$'` -> `String.fromCharCode(36) + 'RefreshSig' + String.fromCharCode(36)`). Observed twice: `$RefreshSig$'` and `'$['` mangles (2026-08). |

## 2. Calling the tools

- Only run_code is callable directly. bash, read, write, edit, todo_write,
  ask_user_question, web_search ... must be invoked from INSIDE a run_code program
  (await tools.edit(...)), or they fail with 'only run_code is callable directly'.
- tools.edit requires a prior tools.read of that file (bash cat/sed does NOT satisfy
  the policy). tools.write refuses to overwrite an existing file without reading it
  first.
- A run_code program that fails LATE can ROLL BACK edits made earlier in the same
  program (observed). After a failed batch, re-verify the file and re-apply if needed.
- READ/WRITE DISCIPLINE (three truncations observed 2026-08): never build a file
  from a PARTIAL read (read limit too small, or a chunked loop that breaks early)
  and write it back - it silently truncates. Full-read (check totalLines) before
  full-write, or prefer targeted tools.edit for appends. AFTER any full-file
  write, verify: wc -l + the file tail + run the tool (a silent exit-0 run with
  no output = the emit was lost).
- tools.edit replaces literal old_string only; if old_string is not found it
  fails loudly (good). tools.write has NO such guard - a truncated content array
  overwrites silently. Prefer edit for appends to existing files.
- ROOT CAUSE (2026-08-26): the read tool is BYTE-CAPPED (~80KB per call) and
  reports the CAPPED total as totalLines - a full-file read of a large doc
  (AGENT-PITFALLS is 6466 lines / 780KB) silently truncates and a
  write-back destroys the tail. This - not the lexer - was the primary
  cause of the recurring truncations. For large files: read in chunks of
  ~700 lines, EOF = a chunk shorter than the requested limit; NEVER trust
  totalLines for write-back decisions; verify wc -l after any full write.

## 3. bash / git

- Heredocs: the EOF delimiter must be on its own line - a space-joined command array
  silently breaks it. Prefer tools.write for file content.
- git commit with -m and a multi-line or quote-heavy message breaks the JS string:
  write the message to a temp file (tools.write) and commit with git commit -F.
- /tmp scripts resolve relative imports against /tmp, NOT the repo CWD - use absolute
  paths (/Users/nolarose/Projects/Kalshi-bot/src/...) or place probes in the repo.
- This repo is a git SUBMODULE of Projects/; .git/hooks does not exist. Commits run
  the real hook via core.hooksPath .githooks -> tools/pre-commit.ts (guard +
  typecheck + bun test --changed=HEAD). Always commit through it.
- Stage explicit paths; the working tree has unrelated dirty/untracked files that must
  stay untouched. research/outputs/ and research/cache/ are gitignored (artifacts
  and DBs stay local).
- Known flake: the ops/kalshi-rotate-key full-apply POST test intermittently fails
  inside the full suite (passes standalone). If the hook's test gate fails once,
  re-run it.
- FIXED (2026-08-26): convertColorFallback fuzz parity was NOT a flake - it
  caught a real bug: the css format did not implement CSS hex abbreviation
  (#005544 -> #054), so abbreviable colors diverged from Bun.color on ~26/600k
  draws (hence 'flaky'). Fixed with cssHexShorthand() (src/lib/color/kernel.ts);
  the fuzz test now uses a seeded PRNG (deterministic, same 200 colors every
  run) and passes 5/5; kernel test expectation updated to the parity-correct
  #fff -> #fff. bun:ci is now free of both known flakes.

## 4. bun:test

- Hooks are top-level imports: import { beforeAll, afterAll } from 'bun:test' -
  test.beforeAll does not exist. Conditional skips use test.skipIf(cond)(...).
- Test DB fixtures must mirror the REAL schema: odds_ticks needs source, source_url,
  fetched_ts, corpus, ts, side, decimal_odds, implied_prob, limit_context, match_key;
  store queries also JOIN events and event_links - create them in the fixture or the
  query throws 'table has no column'.
- Float-boundary assertions: exact thresholds can land on representational edges
  (0.70 - 0.65 = 4.9999... < 5). Use clear margins above/below the boundary.

## 5. Verification discipline (Bun APIs, docs, claims)

Never adopt a claimed API from a summary or paste without probing the runtime:

- typeof probes / tiny /tmp scripts first, then bun-types .d.ts files, then official
  docs (raw markdown: bun.com/docs/<path>.md or raw.githubusercontent.com/oven-sh/bun
  /main/docs/<path>.mdx).
- Examples where claims were WRONG and the probe settled it:
  - fetch.preconnect IS real (typed in globals.d.ts, not bun.d.ts) but https:// URLs
    throw 'Invalid port' on 1.4.0 - the working shape is http://host:port with
    { dns, tcp }.
  - Plain fetch negotiates http/1.1 by default - h2 requires --experimental-http2-fetch.
  - WebTransport is undefined on 1.4.0.
  - Bun.CSRF.generate(undefined, opts) throws 'Secret is required' - always pass an
    explicit secret; sessionId binding is mandatory per the docs.
  - Client new WebSocket(url, { signal }) constructs but signal honoring is
    undocumented - abort via session.close().
  - Bun.connect requires the socket handler; no signal option.
  - Bun.secrets positional forms work at runtime but bun-types 1.4.0 does not type them.
  - Bun.serve idleTimeout is a u8 - 300 throws 'expects idleTimeout to be 255 or less'.
- Adopt, test, then document the VERIFIED reality (see docs/CONNECTION-MASTERY.md,
  the gap register in docs/BUN_NATIVE.md, and docs/DATA_MODEL.md).
## 6. Tooling sharp edges (beyond the lexer)

- CLI files with a top-level await main() or process.exit KILL the test process when
  imported by a test. Guard the entry point with if (import.meta.main) { ... } so
  tests can import the pure helpers (do this for every tools/ CLI you add).
- Every tools call needs ALL its required args: dropping the bash 'description'
  (easy under Promise.all) throws 'invalid arguments: missing required property'.
- tools.read can TRUNCATE large files (~40KB+) without warning - a read+write
  round-trip on such a file silently corrupts it (observed on docs/BUN_NATIVE.md).
  Use targeted edit() calls or verify the line count after any rewrite.
- ask_user_question can return an EMPTY selection array - treat it as 'no answer':
  proceed with the recommended path or re-ask, never assume a choice.
- Test hygiene: bun:test files share the process env - save/restore any process.env
  you mutate (the rotate-key suite does this). Verify a gated test actually SKIPS
  (test.skipIf, not a stale { skip } option - a misused skip ran a real keychain
  probe once).
- After a git add && ... && commit chain, confirm git status: a parse failure in the
  FIRST command means nothing was ever staged ('no changes added to commit').
- Bun.inspect.table(rows, undefined, { colors }) IGNORES colors - pass options as
  the second argument. formatWithOptions colors apply to object values only.
- bun install in this repo needs TMPDIR=$(pwd)/node_modules/.tmp and
  --cache-dir=$(pwd)/node_modules/.bun-cache (global cache writes are blocked);
  bunfig frozenLockfile requires the temporary-unfreeze dance for mutating installs.

## 7. Repo-domain facts (hard-won)

- massey:sync --sport=volleyball resolves the bucket to its FIRST target only
  (cvol/ncaa-d1). To fetch the whole bucket pass an explicit CSV list:
  --sport=cvol/ncaa-d2,cvol/ncaa-d3,cmvol/ncaa-d1,dlv,dlvw,csand.
- massey_ratings columns are sport + subdivision, NOT target_key - query
  GROUP BY sport, subdivision.
- skin_events carries NO prices. Odds live in odds_ticks (sides 'home'/'away' for the
  live capture, 'winner'/'loser' for tennis history - canonicalize via
  event-identity.ts normalizeSideToHomeAway, backfill via odds-canonicalize.ts).
- FantasyUltraAdapter.connectWebSocket(handlers, options) - the FIRST argument is the
  handlers object (PandoraSocketHandlers), options come second.
- FantasyUltraCredentials requires currency (add 'USD'); the coefficient store is
  in-memory only - nothing persists it unless the adapter's persistence option is set.
- The repo key in .env is PRODUCTION (KALSHI_ENV=prod). Never use it for sandbox
  probes; the kalshi:secrets CLI + --service isolation exists exactly for this.
- Network from this machine: fonbet.com and betting-api.com are geo-blocked/unreachable
  (403 / 000); api.oddscp.com (ODDSCORP WS) IS reachable. Real-network tests must be
  gated by an env opt-in (e.g. KALSHI_TEST_KEYCHAIN_SERVICE) or use --dry-run/fixtures.
- research/cache DBs are the live local state - migrations (open-db) apply on open;
  backfills (db:canonicalize) are idempotent. Check gitignore before committing
  anything under research/.
## 8. Bun utilities that defuse the failure classes (all PROVEN in this session)

### 8a. Base64 round-trip defeats every lexer-escaping failure

Base64 output is only [A-Za-z0-9+/=] - no backticks, no dollar-open-brace, no quotes,
no newlines (single line). It passes through run_code program text untouched and
decodes byte-exact at the destination:

  const b64 = Buffer.from(content, 'utf8').toString('base64');   // in the program
  // variant A (bash-echo):
  echo '<b64>' | base64 -d > target/file.ts
  // variant B (tools.write is lexer-safe for base64 too):
  await tools.write({ file_path: '/tmp/x.b64', content: b64 });
  // then: base64 -d /tmp/x.b64 > target/file.ts
  // variant B, pure Bun (no shell base64 dependency):
  //   bun -e "const b = Buffer.from((await Bun.file('/tmp/x.b64').text()).trim(), 'base64'); await Bun.write('target/file.ts', b);"
  // proven byte-exact (sha256 251998c0ff5314ec) with backticks, ${}, quotes, newlines.

Commands themselves can carry the same hazard: a bash command containing
dollar-open-brace or backticks breaks the program text. Encode the WHOLE command:

  const cmdB64 = Buffer.from('echo "${PWD##*/}" && echo `pwd`', 'utf8').toString('base64');
  // bash: echo '<cmdB64>' | base64 -d | bash   (proven: ${} expanded, backtick literal ran)

Proven: a file containing backticks, ${interpolations}, single+double quotes, and
escaped newlines round-tripped byte-exact and executed. Use this whenever content
needs backticks or dollar-open-brace - it replaces the fragile per-line quote
discipline entirely.

### 8b. Bun.file().text()/json() for full reads (tools.read truncates ~40KB+)

  const full = await Bun.file(path).text();          // no truncation, byte-exact
  await Bun.file(path).size;                          // check bytes first (>~40000)

Proven on docs/BUN_NATIVE.md (82,517 bytes): full text, all 1,138 lines, last line
intact - where tools.read truncates silently. Run via bun -e or a /tmp probe with
ABSOLUTE imports.

### 8c. Automate it: bun run agent:encode [file]

tools/agent-encode.ts reads stdin (or a file path) and prints the single-line
base64 - paste into run_code, decode with `echo <out> | base64 -d > target` or the
pure-Bun variant in 8a. Tested byte-exact (sha256 match) on content with
backticks, ${}, and mixed quotes.

### 8d. Kill the SHELL-quoting class: Bun.spawn with an args-array, not bash -c

A command string run through bash re-parses quotes, backticks (command
substitution), and ${} (expansion) - even when the JS string carried them safely
(the printf test above mangled its own payload exactly this way). Instead:

  const trickyArg = "it's ${x} and `y` and \"q\"";   // double-quoted JS string: lexer-safe
  Bun.spawnSync(["bun", "-e", "console.log(process.argv[1])", trickyArg]);
  // child received the arg VERBATIM - proven: exact match, no expansion/execution

Args-arrays are lexer-safe (values are double-quoted JS strings) AND shell-safe
(no re-parsing). Note: under `bun -e script arg`, the arg is argv[1] (argv[0] is
the bun binary; the -e script is not in argv).

### 8e. The run_code worker is plain Node - SOLVED with `bun run agent:probe`

Bun globals are NOT available inside a run_code program (Bun.spawnSync threw
'Bun is not defined'). SOLVED: `bun run agent:probe -- <code-file>` (or stdin)
writes the code to a repo-local `.probe-tmp.ts` (relative imports resolve), runs
it under bun, forwards stdout/stderr, and deletes the temp (verified). Pair with
agent:encode for tricky code: encode -> write .b64 -> base64 -d -> probe.

### 8f. Exit codes & processes (verified on 1.4.0)

- process.exitCode = n is GRACEFUL (pending timers/trailing code run, exit
  hooks run); process.exit(n) is IMMEDIATE (no stack unwinding, pending
  timers skipped, but 'exit' handlers still run). Verified with a timer +
  exit hook: exitCode mode ran both, exit() mode skipped the timer.
- process.exit() inside a try BYPASSES finally (no unwinding) - the
  agent-probe temp-strand bug. Prefer: capture the code, cleanup in
  finally, process.exit after.
- Uncaught exception and unhandled rejection both exit 1. Usage errors in
  our CLIs use exit 2. Signals exit 128+signum (SIGINT 130, SIGTERM 143,
  SIGKILL 137) unless a handler overrides (process.on('SIGTERM')).
- Children: Bun.spawnSync(...).exitCode (sync) and await Bun.spawn(...)
  .exited (async) propagate the child's code (verified 7 and 9);
  bun run <script> propagates the script's code.
- GROUNDED in the official guides (docs/runtime/child-process.mdx,
  docs/guides/process/{os-signals,ctrl-c}.mdx):
  * proc.exited is a Promise resolving on exit; proc.exitCode is
    null | number; proc.signalCode is null | 'SIGABRT' | ... ;
    proc.kill(15) sends signals by number; onExit(proc, exitCode,
    signalCode, error) callback exists.
  * The parent bun process does NOT terminate until all children exit -
    call proc.unref() to detach a child.
  * 'exit' emits when the loop empties OR process.exit() is called;
    'beforeExit' emits when the loop empties first (verified ordering:
    beforeExit then exit).
- MORE (verified + grounded):
  * process.on('unhandledRejection') and process.on('uncaughtException')
    handlers PREVENT the default exit 1 - the process keeps running and
    exits 0 (verified: 'still alive' then exit 0). Use for long-running
    servers that log-and-continue.
  * process.abort() exits 134 (128+6 SIGABRT).
  * proc.kill() defaults to SIGTERM; after await proc.exited, killed=true,
    signalCode='SIGTERM', exitCode=null (signal deaths have no exit code).
  * spawn API (child-process.mdx): cwd, env, onExit(proc, exitCode,
    signalCode, error); stdin default undefined ("pipe" FileSink,
    "inherit", ReadableStream); stdout default "pipe" (ReadableStream,
    proc.stdout.text()); stderr default "inherit" (proc.stderr undefined
    unless "pipe"); proc.pid, proc.killed, proc.resourceUsage() after
    exit; proc.unref() detaches; cgroup option on Linux.
  * spawnSync stdin: Buffer works (verified 'via-buffer'); a string
    THROWS 'stdio must be an array...'; Node's `input` option is NOT
    supported.
  * Bun.spawn has NO signal (AbortSignal) and NO timeout option (the AI
    paste claiming them was wrong - not in child-process.mdx). Timeouts
    are manual: Promise.race or kill after N ms (serve.ts probeLaunchdLabels
    is the reference pattern: Promise.race stdout vs Bun.sleep(2000),
    proc.kill() on timeout, then await proc.exited).
  * GUI launches MUST unref(): fixed editor.ts default spawn - without
    unref() the editor:open CLI hung until the editor GUI closed.
  * Cleanup-before-exit pattern (protonpass-run): await proc.exited, then
    delete temp files, then process.exit(code) - never process.exit with
    pending cleanup.
  * IPC (guides/process/ipc.mdx): Bun.spawn(['bun','child.ts'],
    { ipc(msg, childProc) {...} }), childProc.send(msg), serialization:
    'json' for Node peers, process.execPath for the bun binary. ALREADY
    native here: research-runner spawns with { ipc(...), serialization:
    'advanced' } and the child's process.send IS Bun's IPC channel
    (research-progress.ts) - an earlier 'unused no-fit' note was wrong.
  * Signal death with NO listener emits NEITHER event - to run cleanup
    on a signal, listen (process.on('SIGINT'/'SIGTERM')) and call
    process.exit() from the listener (the ctrl-c guide makes the
    explicit process.exit() a requirement).
  * process.exitCode/exit() graceful-vs-immediate is Node process
    semantics (Bun references Node's process docs); probes confirm Bun
    matches.

### 8l. Why some Node-isms remain (do NOT 'fix' these)

A full sweep confirmed the codebase is Bun-native everywhere it matters -
10x Bun.nanoseconds, zero hrtime, zero util.inspect, zero createHash
(Bun.CryptoHasher), zero require(), native IPC, Bun.spawn/sleep/glob/
file/json/cron/WebView/markdown/semver/CSRF/secrets/color. Remaining
Node APIs are intentional:

- node:util.parseArgs - Bun has no native equivalent; the right CLI tool.
- formatWithOptions (terminal-utils) - %s/%d/printf semantics Bun.inspect
  does not provide.
- Sync readFileSync in config loaders, DB open, and migration seeding -
  startup-time sync reads are correct (the async-only Bun.file().json()
  rule applies to runtime paths).
- process.memoryUsage/uptime/env - identical semantics in Bun; nothing to
  adopt.
- Browser-side code (hq-view timers) - not the Bun runtime.

### 8m. Release-blog APIs (bun.com/blog/bun-v1.4, verified 1.4.0)

- Bun.stringWidth / Bun.sliceAnsi: REAL - ANSI-aware visible width and
  ANSI-preserving slice. Adopted as src/lib/ansi-width.ts (visibleWidth,
  padAnsi, sliceAnsiSafe) with tests - no repo consumer had the padEnd-
  counts-ANSI-bytes bug, but this is the ready primitive.
- Bun.YAML: REAL (parse/stringify verified); no consumer (config is
  JSON5/TOML) - documented, not force-fit.
- Bun.sql: REAL (tagged-template query API); the repo uses bun:sqlite
  directly - different layer, no conversion.
- Bun.html (declarative streaming) is INVENTED - a long AI writeup
  claims it; four-source verification kills it: runtime (typeof Bun.html
  undefined, no `html` named export from 'bun'), bun-types (no html
  tagged template), docs tree (no page - only html-rewriter and bundler
  HTML pages exist), and the very blog it cites (zero Bun.html code
  mentions). Every code block in the writeup would throw 'html is not
  defined'. Same class as WebTransport and Bun.S.
- Bun.S: also undefined on 1.4.0 (blog code identifier unresolved).
- Bun.Image is REAL (docs runtime/image.mdx + runtime verified: metadata,
  resize, .png().bytes(), .placeholder() ThumbHash, Bun.file().image()
  shorthand, backend 'system') but CANNOT create images from raw pixels
  (statics are clipboard-only - no create/fromPixels on 1.4.0).
- Bun.Image pattern matrix (verified): chaining metadata -> resize ->
  format -> bytes() on ONE instance works; Bun.color accepts [r,g,b] and
  {r,g,b} inputs; Bun.s3 + BunFile.stat() are real; getOptimalQuality +
  metadataGate adopted as src/lib/image-quality.ts (tested). WRONG in the
  writeup: .bytes() returns the ENCODED output (PNG signature confirmed),
  NOT raw RGBA pixels, and there is NO pixel-decode API on 1.4.0
  (decode/pixels/toPixels undefined) - so 'average color from pixels'
  patterns are unimplementable with Bun.Image alone; the placeholder/
  thumbhash part is real.
- Ecosystem diagram claims verified: Bun.markdown is a NAMESPACE (html,
  ansi, render, react - all functions) - the direct `Bun.markdown(md)`
  call form is WRONG (not callable). The repo ALREADY delegates natively:
  markdownToHtml / markdownToAnsi are thin wrappers over Bun.markdown.
  html / .ansi; render/react unused (no consumer). Bun.Image.
  fromClipboard, Bun.s3.file, Bun.password.hash, Bun.sql AND Bun.SQL
  (alias) all exist on 1.4.0. Version numbers ARE checkable per-release:
  the RSS feed lists the release blogs, and bun-v1.3.14 confirms 'Bun.Image
  - a built-in image processing API' while bun-v1.3.8 confirms Bun.markdown
  - those two hold; verify others against their release post, not by
  assuming.
  * The 1.4 blog's ACTUAL code blocks (extracted, not just identifier
    counts): Bun.markdown.render with custom callbacks (heading/paragraph/
    strong) is real (we use .ansi for reports); Bun.sliceAnsi takes a
    THIRD placeholder arg ('unicorn' -> 'uni…') and negative starts -
    sliceAnsiSafe now passes it through (was a real gap); AnsiTheme
    includes hyperlinks + columns; stringWidth handles ZWJ/emoji/hyperlink
    sequences.
  * XML build-time inlining VERIFIED: bun build of a file importing
    'feed.rss' with { type: 'xml' } embeds the parsed object as a JS
    literal in the bundle (226-byte output, zero runtime parsing); the
    single-item-becomes-object shape carries into the bundle. Migration:
    `with { type: 'file' }` returns the path STRING (verified); the
    --loader .rss:file flag was NOT confirmed from bun build --help -
    the type: 'file' attribute suffices.
  * Playbook perf tables (req/s, insert ms, '3-10x faster than Rust') are
    marketing - adopt only what is independently measured (we confirmed
    XML parse 1.9ms/87KB). SQLite-entry-storage for feeds has no consumer
    here (release-watch uses state JSON + report) - documented no-fit.
  * 'channel' writeup FULLY VERIFIED: BroadcastChannel crosses Worker
    threads AND main (worker posts -> main ch2 receives; same-thread via
    two instances; single-instance self-delivery does NOT fire - that is
    spec-correct, use two instances). MessageChannel/MessagePort round-
    trip + node:diagnostics_channel both work. NEAR-MISS: the first
    cross-worker probe reported 'does not bridge' because the worker
    FILE never loaded (./bc-worker.ts resolved against the repo temp,
    not /tmp) - rule out harness artifacts before accepting a NEGATIVE
    probe result. CORRECTED SCOPE: BroadcastChannel is SAME-PROCESS only -
    it bridges worker threads and main, but NOT separate processes (a
    cross-process demo failed even with the sender alive 1s; a controlled
    two-process test confirmed). The fan-out consumer is now REAL and
    in-process: release-watch-worker.ts (Worker) broadcasts, the cron
    master receives via the bus (src/lib/fanout.ts, two-instance internals
    so same-process post() also reaches handlers) - live-verified
    'worker analyzed Bun 1.4 -> main RECEIVED'. Cross-process fan-out
    needs WS/HTTP, not BroadcastChannel.
  * Worker API VERIFIED (runtime + cached workers.mdx): unref()/ref() are
    REAL - unref detaches the worker from process liveness (Node
    worker_threads semantics), ref() restores it (default), ref:false in
    options is equivalent; message listeners ALSO keep a worker alive,
    which the release-watch cron job relies on (it waits for the fan-out
    event, so it deliberately stays ref'd). Worker.exited is genuinely
    ABSENT (runtime + types agree) - wait on messages/events, not exited.
  * Bun reference docs are now CACHED LOCALLY: bun:docs-index DISCOVERS the
    page list from the source (tag/repo GitHub trees, site sitemap) into
    research/cache/bun-docs/ with an INDEX.json manifest - 64 runtime pages,
    13 bundler pages (--scope bundler), 333 under --scope all (bun 1.4.0).
    24h freshness + --refresh/--check; INDEX merges across scopes and the
    docs:refresh weekly cron (docs:refresh:register) keeps it current.
    Verification cites local copies and can detect docs drift.
  * Full-stack feed playbook verified: named imports from 'bun' (cron,
    XML, markdown, write, file) all real - unlike 'html'. Bun.cron jobs
    ARE disposable (Symbol.dispose + unref on the prototype) so `using
    job = Bun.cron(...)` works for SCOPED jobs; the cron master keeps
    registrations alive instead (no using there). Bun.cron is 5-field
    (minute hour day month weekday) - SECONDS NOT SUPPORTED (a 6-field
    expression throws 'too many fields'). Bun.markdown.html tagFilter
    DOES escape raw HTML (<script> -> &lt;script>), verified - but it
    does NOT sanitize markdown link URLs (javascript: links pass) -
    partial sanitization only; our markdown.ts presets already set
    tagFilter.
- REAL BUG FOUND via Bun.Image: Bun.deflateSync emits RAW deflate (first
  bytes 0x63 0x64, no zlib header) but PNG IDAT requires an RFC 1950 zlib
  stream. Our hand-built solid PNG passed metadata-only checks and sips
  but strict decoders (Bun.Image) failed pixel decode. Fixed: wrapZlib
  (0x78 0x9C + Adler-32) in visuals.ts + a decode-level test. Lesson:
  validate binary output with a STRICT decoder, not just structure/
  metadata checks.
- bun audit fix / bun dedupe / bun prune: CLI commands exist; the CI
  workflow already runs bun audit --audit-level=high + bun dedupe --check.

- `bun run agent:encode [file]` + `--decode`: lexer-safe base64 in/out (byte-exact
  round-trip verified).
- `bun run agent:probe [file]`: run Bun code repo-locally (worker-is-Node +
  /tmp-imports solved).
- tests/lib/fixtures/event-store.ts `makeEventStoreDb()`: ONE canonical in-memory
  schema (skin_events/odds_ticks/events/event_links) - the three duplicated
  makeDb() fixtures now import it, killing the fixture-drift failure class.
### 8g. bun test has NO name-filter flag (verified flag list)

--filter is not a bun test flag in 1.4.0 - it is silently IGNORED (ran all
tests). Real flags: --only (tests marked .only), --only-failures, --changed,
--shard, --parallel, --rerun-each, --retry, --timings, --bail, --randomize,
--seed, --coverage, --todo, --path-ignore-patterns, --pass-with-no-tests.
Targeting = path-based (bun test <file>) or --changed. Verified by running
--filter with a matching and a non-matching pattern - both ran the whole file.
Flags with VERIFIED semantics (tested with a deliberately flaky test): --retry N
retries failed tests once per run (transient passed on retry, broken still
failed) - the pre-commit hook now runs --retry 1 to defuse the rotate-key flake
natively; --rerun-each N runs each test N times (flake detection);
--only-failures re-runs the last run's failures (test:failed script added);
--bail stops at the first failure.

### 8h. Console depth semantics (verified)

- bunfig [console] depth (3 here) applies to console.log ONLY.
- Bun.inspect default is FULL depth - it does NOT honor the ambient depth.
- bun --console-depth N overrides the bunfig depth per-run (verified: depth 1
  truncated a 6-level object at 2 levels).
- Fix applied: inspectValue() now defaults depth to 3 (matching console.log)
  instead of silently full; verbose=true stays full. Pass depth explicitly
  when a bound matters.

### 8i. Bun.Glob is deeper than readdir+filter

src/lib/glob.ts wraps it: listFiles(pattern, { cwd, sort, onlyFiles, dot }),
listFilesAsync for ** recursion, globMatch(pattern, str) for predicates.
Brace alternation works (*.{json,jsonl}). Replaces readdirSync+endsWith
patterns (harvest-nationalities, fonbet fixture loader converted).

- The harness lexer parses the run_code program text BEFORE Bun runs - no Bun API
  can change that; base64 is the workaround, not a Bun feature.
- Bun.escapeHTML / JSON.stringify are NOT JS-literal-safe: verified that
  JSON.stringify leaves backticks AND dollar-open-brace unescaped in its
  output.
- encodeURIComponent is NOT safe: it escapes backticks and dollar-open-brace
  but LEAVES apostrophes - a single-quoted string breaks. Base64 (only
  [A-Za-z0-9+/=]) is the only reliably safe encoding; all three claims were
  probe-verified.

### 9. Docs sources: tag vs repo vs site (bun:docs-index)

- THREE sources exist for Bun reference docs, verified live:
  * tag: raw.githubusercontent.com/oven-sh/bun/bun-v<Bun.version>/docs/ -
    matches the INSTALLED runtime exactly (default source now).
  * repo: .../main/docs/ - can be AHEAD of the installed runtime.
  * site: bun.com/docs/...md - a rendering of repo .mdx (YAML frontmatter
    stripped, render hints like icon= added); content equivalent, verified
    byte-diff on workers (10635 vs 10662 bytes = frontmatter only).
- The page list is now DISCOVERED, not curated: tag/repo via GitHub trees
  API (git/trees/<ref>?recursive=1, filter docs/<scope>/**.mdx) - 64
  runtime pages at bun-v1.4.0, 333 pages under --scope all; site via
  bun.com/sitemap.xml - 63 runtime pages (one fewer than the repo tree,
  the released surface). Scope filter MUST run on the FULL url/path
  before slicing (a filter on already-sliced paths yields 0 pages -
  real bug, fixed). Name collisions: dedupe must append -1/-2... (docs/
  has typescript.mdx AND runtime/typescript.mdx AND typescript-6.mdx).
- bun.sh is NOT a third source: it is a byte-identical alias of bun.com
  (same content/sitemap/CDN headers, different Cloudflare IPs; verified
  on workers/sql/fetch/server/webview/api + root). Only two real
  surfaces: repo (tag/main .mdx) and the rendered site (bun.com/bun.sh).
- Scope granularity: --scope runtime (64 pages) | --scope bundler (13 pages,
  docs/bundler/** - the bundler/plugins.mdx the /bun/map claims cite) |
  --scope all (333). INDEX.json MERGES additively across scopes: running one
  scope never drops another's cached entries (names unique; dedupe appends
  -1/-2). DISCOVERY.json keeps a per-scope page list (scopes map, migrated
  from the old single-scope shape). docs:refresh (tools/bun-docs-refresh-
  cli.ts) refreshes --scope all then gates with the offline --check; the
  weekly OS cron (docs:refresh:register, "0 6 * * 1") automates it, and
  BUN_DOCS_REFRESH_SKIP_NETWORK=1 turns any run into check-only.
- Bundler plugin namespace probe (tests/bun-plugin-namespaces.test.ts, cached
  bundler-plugins.mdx §Namespaces): namespaces are restricted to [a-zA-Z0-9_-]
  on 1.4.0 - the doc's literal namespace: "yaml:" example THROWS at build time
  ("namespace can only contain ..."); use "yaml". In-memory bundle output text
  is read via await output.arrayBuffer() (the documented .text accessor is a
  native fn returning undefined on 1.4.0).
- maps.toml triple-lock (src/lib/maps-lock.ts): maps.toml + bun-types +
  @types/bun + Bun.version + docs tag ref must agree. docs:refresh runs the
  lock: on mismatch it logs the drifted pins, re-indexes (the indexer's
  discovery freshness also requires the ref match, so a Bun bump forces
  re-discovery), regenerates maps.toml from the indexed surface, and records
  INDEX.json "mapsHash" (Bun.hash hex, 16 chars) + mapsMeta. Idempotent: a
  synced lock is a no-op. Check-only (BUN_DOCS_REFRESH_SKIP_NETWORK=1) never
  writes; a mismatch exits 1. The indexer preserves unknown INDEX.json
  top-level keys so lock metadata survives re-indexes.

### 10. Bun native fetch: DNS, CDNs, and connection reuse (all probe-verified on 1.4.0)

- Bun.dns is REAL and complete: prefetch(host, port?), lookup(),
  getCacheStats() -> {cacheHitsCompleted, cacheHitsInflight, cacheMisses,
  size, errors, totalCount}. prefetch populates the cache (misses+1,
  size+1). Docs (cached runtime/networking/dns.mdx): 256-entry cache,
  30s TTL default, $BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS to change, used
  automatically by fetch/Bun.connect/node:net/node:tls/node:http/bun install.
- Connection FAILURE evicts the DNS entry (verified: localhost:1 refused
  -> size 1->0, errors 0->1) forcing re-resolution - this is how the
  multi-IP CDN case self-heals: a dead Cloudflare IP gets dropped, the
  next connect re-resolves (possibly to the other IP). A TIMEOUT (hanging
  port, e.g. bun.com:99) does NOT evict - it just hangs until your own
  timeout. No Happy Eyeballs documented in tcp docs.
- Connection pooling is REAL and default-on: 20 sequential fetches to a
  keep-alive local server -> 1 TCP connection; keepalive:false per-
  request -> 1 connection each (5/5 new). fetch() to bun.com negotiated
  HTTP/1.1 (verbose:'curl' output shows --http1.1), Cloudflare edge
  served it (x-vercel-cache: HIT, cf-cache-status: DYNAMIC, br encoding).
- Default simultaneous fetch limit is 256; excess QUEUES (docs).
  $BUN_CONFIG_MAX_HTTP_REQUESTS raises it (max 65535). Our --scope all
  run fans out 333 parallel fetches - 77 queue behind the cap, which is
  fine (pooled, same host), but cap is real.

### 11. Bun fetch pooling mechanics (probe-verified on 1.4.0, local servers)

- Pool is per host:port. Sequential fetches reuse ONE connection (20 seq
  -> 1 conn; 5 seq to a second port -> 1 new conn there = separate pool).
- CONCURRENT fetches to the same host do NOT share: each parallel request
  opens its own connection (20 parallel -> 20 conns peak 20; 40 parallel
  -> 40 peak 40). No per-host cap below the global 256. For fan-outs this
  means N parallel fetches = N TCP connections, so warm the pool / bound
  concurrency deliberately (our bun-docs fan-out to raw.githubusercontent
  opens one conn per page in parallel).
- Idle pooled connections do NOT time out within 15s (checked at 5/10/15s,
  zero closes) and are reused after idle. Docs do not specify an idle
  timeout; effectively the connection stays pooled until the process
  exits or the server closes it.
- UNREAD response bodies block reuse: a 1MB Content-Length body that is
  never read -> next fetch opens a new connection (2 conns). A small
  chunked body that fully terminated -> reuse still happens (1 conn).
  Always consume response bodies (or .cancel()) when you want pooling.
- Connection: close header and keepalive:false both force a fresh
  connection per request (verified: 3 requests -> 3 conns).

### 12. Canonical fetch defaults (src/lib/fetch-pool.ts)

- NEW DEFAULT for any fetch fan-out: src/lib/fetch-pool.ts encodes the
  section 10/11 findings as code: warmDns() (Bun.dns.prefetch, best
  effort), fetchText() (body ALWAYS consumed, AbortSignal.timeout per-
  request), fetchPool() (bounded concurrency default 8, per-URL error
  capture, never throws, results aligned with input order).
- fetchPool replaces unbounded Promise.all fan-outs: on HTTP/1.1 (the
  default) each concurrent request is one TCP connection, so the
  concurrency bound IS the peak socket count. With h2 enabled
  (--experimental-http2-fetch / BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_
  CLIENT=1, or per-request protocol:'http2' over https) concurrent
  requests MULTIPLEX on one connection (verified 20 parallel -> 1 conn
  / 20 streams), so the bound then limits stream fan-out, not sockets.
  bun:docs-index uses it (16 concurrent, 30s timeout); test coverage
  in tests/lib/fetch-pool.test.ts (bound honored, failures captured,
  timeout fires, warmDns never throws).
- Migration rule: new multi-URL fetches call fetchPool; single fetches
  call fetchText (never bare fetch without reading the body).
- HTTP/2 client: SUPPORTED (experimental) - this section was WRONG and
  is corrected. fetch() accepts protocol:'http2' (per-request, requires
  https - plaintext h2c is NOT supported, 'HTTP2Unsupported' otherwise)
  and the whole process upgrades via --experimental-http2-fetch /
  BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1 (offers h2 in TLS ALPN,
  falls back to h1.1 if the server doesn't pick it). VERIFIED: h2 over
  TLS to a local node:http2 server -> 200; with the flag, fetch to
  bun.com negotiates HTTP/2 (verbose shows 'HTTP/2 GET', Cloudflare
  accepts); 20 PARALLEL h2 requests -> 1 connection / 20 streams
  (multiplexed) vs 20 connections on h1.1. The earlier negative probe
  was an artifact: it tested plaintext http:// h2c, which is not a
  supported mode. This also means the section-10 'HTTP/1.1 only'
  framing is default-only: h2 is opt-in (flag or protocol option).
- Repo precedent: src/institutions/fonbet/connection.ts already uses
  Bun.dns.prefetch (prefetchDns) + getCacheStats (dnsCacheStats) to warm
  and observe the DNS cache - the pattern to copy for any multi-host
  ingestion.
- bun:docs-index adopted the pattern (warmDns): prefetches the three
  hosts before discovery/fan-out. The DNS cache is PER-PROCESS - stats
  observed from a separate bun process are always empty; only in-process
  observation shows the warm entries (probe: 3 prefetches -> size 3,
  then discovery fetch -> hits 0->1, misses stay 3). --check is fully
  offline (zero fetch calls, local JSON only); discovery failure falls
  back to the curated list.
- As of bun 1.4.0, tag and repo main are BYTE-IDENTICAL on all 16 curated
  pages (md5 check) - no repo-ahead drift right now. The REAL skew is
  docs-vs-runtime and it EXISTS EVEN AT THE TAG: fetch.preconnect exists but
  rejects https URLs ('Invalid port'), while both tag and repo fetch.mdx
  show fetch.preconnect("https://bun.com") as valid. Bun.html is in NEITHER
  docs tree (grep 0) and is undefined at runtime - earlier 'repo-ahead'
  claim was wrong; docs never documented it.
- Consequence: docs (any source) are a REFERENCE, never proof. Probe the
  runtime for every claimed API - docs describe the intended surface, the
  binary is the ground truth.

### 13. Bun v1.4 performance-claims audit (paste vs blog vs docs vs probes)

An AI-pasted 'v1.4 performance summary' was audited claim-by-claim against
the release blog (bun.com/blog/bun-v1.4), cached tag docs, and runtime
probes. Verdict per claim:

- VERIFIED (blog text found): Rust rewrite; idle CPU 5x (hello-world
  server); memory up to 35% (HTTP servers 13-48%: fastify 120->233 -48%,
  Express 92->169 -46%, Elysia 55->91 -40%, Next.js 285->397 -28%);
  Linux startup 50% faster (5.1 vs 10.9 ms); Windows 2.5x (15.5 vs 39.0
  ms); binary up to 17% smaller; unified allocator (JSC now uses
  mimalloc with partial page clearing, scavenger thread, lazy zeroing).
- VERIFIED (CLI --help): --smol, --no-orphans, --parallel (top-level
  script runner, NOT a bun:run flag - 'bun run --parallel' IS real per
  blog), bun test --parallel=<N> (worker processes, default CPU count,
  implies --isolate), bun test --shard=1/3, --cpu-prof/--heap-prof/
  -md variants, --cpu-prof-interval default 1000 us, --metafile-md.
  --metafile-md exists but ONLY on bun build (paste lumped it with
  general profiling flags - misleading placement, real flag).
- VERIFIED (docs): Bun.serve idleTimeout default 10s, max 255, 0
  disables (http-server.mdx; repo serve.ts already sets 255 for SSE and
  comments the real defaults); process.on('memoryPressure') is REAL
  (blog section + runtime registers it in process.eventNames, probe:
  listener accepted, event listed; firing needs actual OS pressure);
  bun audit fix / bun dedupe / bun prune all real commands (blog +
  --help); [install] globalStore real (isolated-installs.mdx: 7x faster
  warm installs, off by default); [run] noOrphans real (bunfig.mdx,
  platform impls: Linux prctl PDEATHSIG, macOS kqueue, Windows job
  objects); test.smol bunfig key real.
- FABRICATED / NOT in the blog: '22% faster median build time' (blog
  has no such number; closest: 14x code-splitting on 20k modules, 1.3-
  1.4x 2-core builds, 12% ESM loading); '2-5% overall' (no such claim);
  the req/s table (509k HTTP/3, 189k HTTPS/1.1, 239k HTTP/1.1) - blog
  only says HTTP/3 is 2.7x faster than HTTPS/1.1 on static routes and
  shows 49,239 req/s node-to-node; 'Bun.serve 36->45 MB' row (real
  table has fastify/Express/Elysia/Next.js, no Bun.serve row); the
  Elysia systemRouter '45.7x AOT degradation' claim - NOT in the blog
  (Elysia appears only in the memory table; SystemRouter in the blog is
  Bun.FileSystemRouter, a different API).
- WRONG (probe-falsified): 'maxRequestBodySize default 8 MB' - actual
  default is 128 MB, binary-search probed: 128 MB POST -> 200, 129 MB
  -> 413. The repo's serve.ts comment ('Bun's defaults are a 128MB
  request body cap') was right all along; the paste's 8MB is wrong.
- MISLEADING bunfig: '[test] parallel = true; shard = true' - NO such
  bunfig keys (test section: root/preload/pathIgnorePatterns/smol/
  coverage; parallel/shard are CLI-only). '[run] noOrphans = true' and
  '[install] globalStore = true' are correct bunfig keys.
- Practice: blog numbers are checkable (this audit took ~10 grep calls);
  fabricated tables/percentages in pasted summaries are common. Verify
  any number you will act on. The repo already acts correctly on the
  two big ones (128MB cap comment, idleTimeout 255).

### 14. Deeper pass: h2 fetch correction + new 1.4 fetch features (all verified)

- CORRECTION to sections 10-12: HTTP/2 client IS supported on 1.4.0
  (experimental). The section-11 'no h2 client' negative was a probe
  artifact: it tested PLAINTEXT http:// against a node:http2 server.
  h2 requires https (TLS ALPN); plaintext h2c is not supported -
  protocol:'http2' on http:// throws HTTP2Unsupported, and default
  fetch to an h2-only plaintext server throws Malformed_HTTP_Response.
  Verified over TLS: protocol:'http2' -> 200; with
  BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1 / --experimental-http2-
  fetch, default fetch offers h2 in ALPN and falls back to h1.1.
  Real-world: with the flag, fetch to bun.com shows 'HTTP/2 GET' in
  verbose output (curl template still prints --http1.1 - the curl
  line is a template, the HTTP/2 GET line is the real negotiation).
- Multiplexing verified: 20 PARALLEL h2 requests -> 1 connection / 20
  streams (h1.1: 20 connections). So fetchPool's concurrency bound
  means sockets on h1.1 but streams on h2 - the pool works under both;
  enabling h2 is per-process (flag) or per-request (protocol option).
- TLS session resumption (new in 1.4, blog): 32-entry LRU of BoringSSL
  client sessions per origin; a reconnect after pool eviction resumes
  at 1 RTT instead of a full handshake + cert walk. Improves the
  eviction/reconnect case from section 10.
- fetch() request compression (new in 1.4, blog + probe-verified): the
  compress option compresses request bodies with auto Content-Encoding;
  gzip/deflate/br/zstd all work (probe: 1200-byte body -> gzip 43b,
  deflate 31b, br 17b, zstd 29b; server saw the right Content-Encoding
  header). Buffered bodies compressed + Content-Length reflects it;
  streaming bodies pass through unchanged.
- memoryPressure level values typed in bun-types: 'warning' | 'critical'
  (overrides.d.ts). Event registered in process.eventNames; firing
  requires actual OS pressure.
- smol effect probe: heapUsed 17.8 MB normal vs 5.0 MB with --smol
  (GC runs more often). Top-level bunfig smol = true and [test] smol
  both documented (bunfig.mdx:53, 204).
- bun test --parallel semantics: files already run in parallel by
  default; --parallel=N controls worker PROCESS count (implies
  --isolate). --shard=1/3 splits files across CI jobs.
- bun run --parallel verified real: runs scripts concurrently with
  Foreman-style 'name | exit |' prefixed output (help text + probe).
- 3x faster bun:ffi confirmed in blog (image alt text).

### 15. Deeper pass: rewrite/event-loop/SIMD/JSC claims audit

Second claims paste audited (blog bun-v1.4 + bun-v1.4.0 tree + runtime
probes + cached debugger.mdx). Verdicts:

- VERIFIED (blog): 'rewrites Bun from Zig to Rust'; Node.js 26.3.0 meta
  description AND process.versions.node = 26.3.0 at runtime with
  process.versions.modules = 147 (NODE_MODULE_VERSION, probe).
  node:http/fs/cluster/timers/zlib/vm/stream pass 97% of Node's own
  tests, node:quic 99%, node:events/trace_events/sqlite 100% (blog
  sentence matches the paste's table exactly). +1,517 Node tests.
- VERIFIED (blog + runtime): breaking changes table is accurate:
  res.writeHeader REMOVED (probe: node:http ServerResponse.writeHeader
  undefined, writeHead is a function - use writeHead); bun.lock v2
  exists (blog: 'bun.lock is now lockfileVersion') while THIS repo's
  lock is still v1 (old format - migration note, not a claim error);
  TLS validation stricter (blog: ERR_TLS_CERT_ALTNAME_INVALID when
  connecting by IP/localhost with a cert issued for another name -
  matches Node); .env NOT auto-loaded under real node (probe:
  /opt/homebrew/bin/node prints undefined, bun prints the value -
  bun's auto-load is a bun feature, not node's); Bun.YAML is YAML 1.2
  (probe: 'yes'/'on'/'no' parse as STRINGS, 1.1 booleans are gone);
  Temporal enabled (probe: typeof Temporal === 'object').
- VERIFIED (repo tree + docs): .classes.ts binding generator is REAL -
  the bun-v1.4.0 tree has src/runtime/api/*.classes.ts (Glob, Archive,
  BunObject, JSBundler...) using define() from codegen/class-
  definitions describing class layout (construct/finalize/JSType/proto
  builtins) - the paste's 'binding generator' claim is accurate;
  WebKit Inspector Protocol confirmed by debugger.mdx ('Bun speaks the
  WebKit Inspector Protocol') with a CDP layer for debug.bun.sh - the
  WIP-not-CDP + translation claim is accurate.
- PARTIALLY TRUE / EMBELLISHED (blog has the optimization but NOT the
  paste's mechanism): setImmediate - blog says 'no longer writes to the
  eventfd on every iteration' (44k writes -> 0); the paste's
  'zero-timeout getTimeout()' mechanism is INVENTED. Event loop Linux
  edge-triggered epoll for eventfd wakeups is real (blog). SIMD is
  real and pervasive (SIMD XML parser, SourceMap 3.1x, String#indexOf
  5.36x, Wasm interpreter SIMD) but the specific paste stories
  (TextEncoder.encode regression saga, highway_index_of_char /
  highway_memmem names, ANSI 4-way unroll with NEON-to-GPR, LTO caveat)
  are NOT in the blog - invented detail on top of a true theme.
- FABRICATED (not in blog): the rewrite statistics - '535,496 lines of
  Zig', '64 Claude agents over 11 days', '$165,000 API credits',
  '6,778 commits', 'strangler-fig pattern', 'Rust passed 100% with
  zero skips' - NONE appear in the blog (grep for each: zero hits).
  The blog only says 'rewrites Bun from Zig to Rust'. The specific bug
  list (node:zlib UAF, http2 hash rehash, UDPSocket valueOf crash,
  Buffer#copy OOB, scrypt leak, CSS double-free, fs.watch refcount) is
  also absent from the blog - plausible-sounding but unverified.
  'uSockets/uWebSockets' event loop layering - zero blog hits; the
  paste's three-layer architecture with uSockets is invented.
- Anthropic production numbers VERIFIED: Claude Code p99 CPU 24% ->
  10%, p50 5.8% -> 2.5% (blog). 'Claude Code has been using Bun's Rust
  port for months' (blog). But this is Anthropic's app on Bun, NOT
  evidence for the migration agent/cost claims.
- Practice: paste #2 mixed ~60% verified facts with invented
  mechanisms and statistics. The verifiable core (versions, breaking
  changes, compat table, classes.ts, inspector protocol) all checked
  out; every invented number was greppable-as-absent. Same rule as
  section 13: verify, then act.

### 16. Repo impact of the v1.4 breaking changes (audited, all green)

Applied the section-15 breaking-changes table to THIS repo. Every item
scanned; no code changes needed:

- res.writeHeader removed: ZERO usage of writeHeader/writeHead in src/
  and tools/ (grep) - we use Response/Bun.serve fetch handlers only.
- bun.lock v2: verified bun 1.4.0 writes 'lockfileVersion': 2 when a
  lock is (re)generated (probe: fresh install with frozenLockfile=false
  -> lockfileVersion 2). THIS repo's committed lock is still v1 and
  stays v1 while frozenLockfile=true (bunfig + all docs/scripts use
  --frozen-lockfile). The 'temporary-unfreeze dance' (pitfalls line
  98) is the ONLY path that would rewrite it to v2; when it happens,
  old Bun (<1.4) can no longer read it - team-wide upgrade needed.
  NOTE: --lockfile-only does NOT bypass frozenLockfile (probe: no lock
  written even with the flag under the global frozen policy); the
  global ~/.bunfig.toml sets frozenLockfile=true too, so the project
  policy is layered.
- .env under node: zero scripts use the node interpreter (package.json
  has no node invocations; everything is bun). No impact. Note: the
  earlier probe where 'node t.js' printed the env value was a PATH
  artifact - /opt/homebrew/bin/node (real node 26.7.0) does NOT load
  .env; bun does. (Also: this machine's node is v26.7.0, newer than
  bun's embedded 26.3.0.)
- Bun.YAML 1.2: ZERO YAML parsing in src/tools (grep). No impact.
- Temporal API: zero Temporal.* usage. No impact. (Runtime probe:
  typeof Temporal === 'object' - enabled.)
- TLS stricter (ERR_TLS_CERT_ALTNAME_INVALID for IP/localhost with a
  cert issued for another name): all repo connections are hostname-
  based (kalshi.com, fonbet hosts, bun.com) - no IP-address TLS
  connections found; no impact.
- Native addons (NODE_MODULE_VERSION 147): zero .node files, zero
  node-gyp/napi deps in package.json. No impact.
- Practice: a breaking-changes table is only actionable AFTER applying
  it to the actual codebase. The audit pattern (grep each API, verify
  each lock/probe) took minutes and found zero required changes - the
  repo was already on the safe side of every v1.4 break.

### 17. Folded tooling: the audit patterns are now runnable

- bun:breaking-audit (tools/bun-breaking-audit.ts) encodes section 16:
  greps src+tools for every v1.4 break (writeHeader, YAML 1.2, Temporal,
  node interpreter, rejectUnauthorized:false, native addons, bun.lock
  version vs frozenLockfile) and exits 0/1. Traps learned: exclude the
  tool's OWN source from rg (self-match), use find -name '*.node'
  instead of rg '\.node' (matches table.nodeId column names), and
  don't flag the openssl CLI '-servername' SNI arg as a TLS override.
  Current run: 12/12 ok (section 31 added the 'Other behavior
  changes' checks).
- bun:claims-audit (tools/bun-claims-audit.ts + src/lib/claims-audit.ts)
  encodes sections 13/15: given claim strings, greps the release blog
  (cached at research/cache/bun-blog.html) and reports FOUND / NOT
  FOUND, exiting 1 if anything is absent (likely fabricated). Core is
  a pure lib (auditClaims: word-boundary by default, --all for
  substring) with 6 tests. Verified against the v1.4 blog: correctly
  flags '535,496 lines of Zig' / '64 Claude agents' as fabricated and
  finds 'rewrites Bun from Zig to Rust' / 'res.writeHeader'.
- Word-boundary subtlety (probe + test): a hyphen is NOT a word
  boundary in the (^|[^a-z0-9])...([^a-z0-9]|$) scheme - 'strangler'
  matches inside 'strangler-fig'. The reliable discriminator is
  prefix-vs-longer-word ('rewrite' vs 'rewrites').
- Use: after any pasted Bun claims, run bun:claims-audit with the
  specific numbers; after any Bun upgrade, run bun:breaking-audit.

### 18. Runtime-surface probe: the guard now checks the BINARY, not just deps

- src/lib/runtime-surface.ts (runRuntimeSurfaceProbe) verifies the
  INSTALLED bun exposes the APIs the repo relies on: Bun.dns.prefetch +
  getCacheStats, fetch protocol option (h2), process.on(memoryPressure),
  Temporal enabled, Bun.YAML 1.2 semantics (yes/on/no strings),
  res.writeHeader removed on node:http. Wired into bun:guard main so a
  downgrade / broken install / canary regression fails the merge gate.
- memoryPressure presence trap (probe): the event appears in
  process.eventNames() ONLY AFTER a listener is registered (bare check
  returns false). The probe registers a no-op listener, checks, removes
  it. Firing still requires real OS pressure - registration is the
  presence signal.
- The guard is now two layers: auditRepository (npm->native dependency
  scan, static) + runRuntimeSurfaceProbe (runtime behavior, dynamic).
  Both run in bun run guard -> check -> pre-commit. Tests in
  tests/lib/runtime-surface.test.ts (assert the same binary they guard).

### 19. Bun.serve dir routes + 'also built in' APIs (probe-verified + adopted)

- Bun.serve routes { dir } verified end-to-end: serves index.html for
  dirs, correct Content-Type, ETag + Last-Modified, 304 on If-None-
  Match, 206 Partial Content with Content-Range on Range, 404 for
  missing, and routes + fallback fetch COEXIST (non-static paths fall
  through). Traps: a dir mount path MUST end in '/*' (else: 'To mount a
  directory, make sure the path ends in /*'), and a ROOT-LEVEL dir
  mount would shadow every API route - keep static files under a
  prefixed path.
- ADOPTED in serve.ts: /registry/* and /partner-dashboard/* now use
  routes { dir } (public/registry, public/partner-dashboard), replacing
  ~60 lines of hand-rolled Bun.file + exists() + content-type switch
  handlers (which lacked ETag/Range). /colors.css stayed in fetch (a
  single root-level file). SERVE_PATTERNS.EXACT.partnerDashboard*
  constants removed (dead). Tests: tests/research/serve-static-dir.
  test.ts (200/etag/304/fallthrough, artifact-guarded). Guard message
  for serve-static updated to point at the dir mount.
- 'Also built in' surface probe: Bun.JSON5 (unquoted keys + comments
  OK), Bun.JSONL parse/parseChunk, Bun.JSONC (QUOTED keys only - JSON
  with comments, NOT JSON5; unquoted keys throw), Bun.TOML parse +
  stringify, Bun.Archive, URLPattern (:id groups work),
  CompressionStream/DecompressionStream, Response.textStream() - all
  present on 1.4.0.
- Post-quantum crypto: ML-DSA-44/65/87 generateKey works (sign/verify).
  ML-KEM is 768/1024 ONLY (512 absent - blog-consistent) via FOUR new
  SubtleCrypto methods (encapsulateBits/encapsulateKey/decapsulateBits/
  decapsulateKey), NOT generateKey+deriveBits (that usage throws
  'Unsupported key usage'). The KEM flow works: keypair ->
  encapsulateKey(publicKey, {name:'AES-GCM',length:256}) ->
  decapsulateKey. bun repl and bun ./README.md verified (markdown
  renders, no VM).
- fetch compress option re-verified here (already section 14):
  gzip/deflate/br/zstd with auto Content-Encoding.

### 20. bun:deps-audit + dependency-killer verification (paste #3)

- tools/bun-deps-audit.ts (bun:deps-audit) = the dependency-killer table
  as a runnable report: scans package.json deps AND source imports for
  every npm package Bun replaces (REPLACEMENTS map, 28 entries), plus a
  positive native-usage count (which Bun APIs actually appear in
  src/tools). --check exits 1 on any replaced package. Import-safe:
  process.exit guarded by import.meta.main (so tests can import the
  table). Tests: tests/lib/deps-audit.test.ts (table completeness vs
  the blog list + replacement sanity).
- This repo: 6 dependencies total (@factorywager/proton-pass, @types/bun,
  bun-types, drizzle-orm, typescript, zod), ZERO replaced packages in
  deps or imports, 26 native Bun APIs in active use (Bun.file 143,
  Bun.write 121, Bun.cron 46, Bun.WebView 46, URLPattern 36...). The
  dependency-killer thesis is already achieved here.
- Guard gaps found and filled: sirv, compression, pako were NOT in the
  guard's BANNED_PACKAGES (the paste's table has them) - added with
  correct replacements (Bun.serve { dir } / CompressionStream).
- PASTE ERROR caught: the paste claims 'you're already using
  CompressionStream' and 'already integrated memoryPressure' - both
  FALSE for this repo. Zero CompressionStream usage in src (the only
  hits were this tool's own text); memoryPressure appears only in the
  runtime-surface PROBE, not a real handler. Actual compression is
  native but via Bun.gunzipSync (coefficients.ts), not
  CompressionStream - fine, but the paste's specific claim was wrong.
- bun:claims-audit improvement: the CLI now strips HTML (htmlToText)
  before matching - claims spanning <code> tags ('files stream with
  sendfile') previously never matched. Paraphrase-vs-literal is still
  surfaced: 'Bun.serve routes can now serve a directory' misses because
  the blog writes 'Bun.serve() routes...' (the parens intervene even in
  substring mode) - a phrasing mismatch, not fabrication, but the tool
  correctly reports it as absent.

### 21. memoryPressure adopted: the paste's 'already integrated' claim is now true

- Section 20 noted the paste claimed 'you've already integrated
  memoryPressure' — false then (only the runtime-surface probe
  mentioned it). NOW TRUE: createResearchServer registers a real
  process.on('memoryPressure') handler that clears the in-process
  bookCache (Map, 5s TTL) + sportsSourceCatalogCache on 'critical'
  (levels typed 'warning' | 'critical'; non-critical is a no-op).
  Tests: tests/research/serve-memory-pressure.test.ts simulates via
  process.emit('memoryPressure', 'critical'|'warning') and asserts the
  handler fires only on critical + the server still serves after.
- Remaining §10 roadmap: Bun.Archive for backups is still unadopted
  (only 88MB event-store.db + DBs in research/cache are the natural
  targets; nothing speculatively built). URLPattern (36 uses, SSOT
  BunURLPattern wrapper in patterns.ts), Bun.JSONL (streaming NDJSON
  endpoints in serve.ts + parseChunk pipelines), Bun.TOML (10), dir
  routes (section 19) are all already adopted - the 'High' roadmap
  items were done before this round.

### 22. Integration map + Bun.Archive adopted (with a real 1.4.0 bug found)

- Integration map (paste #4 'see where we can integrate', per-API usage
  in src+tools): Bun.cron 46, Bun.WebView 46, URLPattern 36, Bun.
  stringWidth 14, Bun.JSONL 14, Bun.TOML 10, Bun.sliceAnsi 7, Bun.wrapAnsi
  6, Bun.XML 5, Bun.JSON5 5, Bun.Terminal 2, Bun.JSONC 2, Bun.gzipSync/
  gunzipSync 1 (snapshot-data-plane). ZERO real usage: Bun.Archive,
  CompressionStream/DecompressionStream (only the deps-audit table text),
  Response.textStream (no large-streaming consumer exists - .text() calls
  are all bounded API/file reads; nothing to convert).
- ADOPTED: bun:backup (tools/bun-backup.ts) uses Bun.Archive.write to tar
  research/cache DBs+json into research/backups/research-<stamp>.tar
  with keep-N pruning + --list. Round-trip verified (extract -> byte-
  identical massey.db). Script: bun run bun:backup.
- REAL BUG FOUND on 1.4.0 (probe + test-locked): Bun.Archive.write with a
  BunFile VALUE archives a 0-byte entry - the 'data streams directly to
  disk' docs are aspirational; string/bytes values work (string 14 bytes,
  bytes 19 bytes archived correctly). WORKAROUND in bun:backup: read
  Bun.file().bytes() first (loads the 88MB event-store into memory -
  acceptable for backups). Not found in a GitHub issue search. Locked in
  tests/lib/archive-roundtrip.test.ts (both the working bytes path and
  the 0-byte BunFile bug).
- NOT adopted (documented rationale): CompressionStream/DecompressionStream
  - real compression is already native via Bun.gzipSync/gunzipSync on
  bounded Buffers (snapshot-data-plane), no streaming consumer exists;
  Response.textStream - no large response .text() reads; Bun.spawn({
  cgroup }) - Linux-only, dev is macOS; ML-DSA/ML-KEM - no crypto
  primitive need in repo (keychain/WebCrypto AES-GCM covers secrets);
  bun repl / bun ./README.md - dev conveniences, not code paths.

### 23. Test runner adoption: --parallel --timings is 5.5x faster (measured)

- The v1.4 release-notes paste was audited; the actionable win was the
  test runner. Measured on THIS suite (1959 tests, 0 fail):
  bun test --isolate = 11.1s vs bun test --parallel=8 --timings = 2.0s
  (5.5x). Same tests, same results - --parallel implies --isolate and
  distributes files across workers; --timings balances by wall time.
- ADOPTED: package.json test = 'bun test --parallel --timings=
  .bun-test-timings.json --timeout 15000' (was --isolate); new
  test:record-timings re-records the committed timings file; pre-commit
  hook test layer (--changed=HEAD AND full fallback) also switched.
  .bun-test-timings.json is committed so the hook/CI benefits without a
  warm-up run. Full run now 3.3s (parallel=8 on 8-core + posttest).
- Package-manager audit (all clean on this repo): bun audit = 'No
  vulnerabilities found (checked 7 packages)'; bun dedupe --check = no
  duplicates; bun pm licenses --prod resolves; bun pm diff zod = no
  differences. None need gate integration yet (6 deps, already clean).
- Security defaults audited vs our surface: the only rejectUnauthorized
  override is src/bot/kalshi-ws.ts's EXPLICIT env-gated opt-in
  (KALSHI_WS_TLS_REJECT_UNAUTHORIZED=0) - legitimate, not an accidental
  disable. No RedisClient usage (its TLS enforcement is moot here).
  No checkServerIdentity pinning in repo.
- Perf claims spot-probed on this machine: new URL ~60ns/op (matches the
  claimed ~75ns scale); gzipSync/hex SIMD fast. Timing resolution was
  coarse (JIT elided loops), so absolute numbers are indicative only.

### 24. bun:perf-audit — the toolchain-wins gate (paste's suggested tool)

- src/lib/perf-audit.ts + tools/bun-perf-audit.ts (bun:perf-audit) checks
  the four toolchain wins from the release-notes summary paste: (1)
  globalStore + linker=isolated in config (machine ~/.bunfig.toml since
  the project bunfig defers install policy), (2) test script uses
  --parallel --timings, (3) Bun.build metafile analysis where builds
  exist (n/a when no Bun.build usage - does NOT fail the gate), (4) CI
  runs bun audit + bun dedupe --check. Wired as the final step of bun
  run check. Tests: tests/lib/perf-audit.test.ts (5 tests, temp
  fixture: all-ok, missing --parallel, missing globalStore, missing CI,
  n/a-does-not-fail).
- All 4 checks currently pass on this repo: global store configured
  (global bunfig), test script parallel+timings (section 23), no
  Bun.build usage (n/a), CI workflows run bun audit --audit-level=high
  + bun dedupe --check (check.yml - the paste asked 'check if you use
  audit fix/dedupe in CI'; the read-only forms are the frozenLockfile-
  safe equivalent, mutating bun audit fix / bun dedupe conflict with
  frozen policy and are run manually).
- Self-match trap (same class as section 17): the rg search for
  'Bun.build' matched the audit's own source text - fixed with
  --glob '!**/*audit*.ts'. Recorded so future audit tools exclude
  themselves structurally, not by growing a list.

### 25. bun:adoption-audit + networking paste verdicts

- tools/bun-adoption-audit.ts + src/lib/adoption-audit.ts = the paste's
  suggested tool: coverage report of the v1.4 networking stack. Three
  checks with ok / gap / n/a: (1) Bun.serve dir routes (ok - serve.ts
  has /registry/* + /partner-dashboard/*), (2) fetch() compress option
  (gap - 7 files POST but bodies are small JSON; compress only matters
  >~100KB, so a SOFT gap), (3) fetch() protocol:http2 (gap - 24 files
  fetch without it; experimental, SOFT gap). Report command only - NOT
  a check-pipeline gate (the gaps are soft/experimental, unlike the
  hard perf/breaking gates). Tests: tests/lib/adoption-audit.test.ts
  (4 tests, temp fixture).
- PASTE's 'already using' table audited: WRONG on '/api/image/:id uses
  Bun.file' (no such route; image work is visual-snapshot-meta.ts with
  Bun.file().image().metadata()); RIGHT on dir routes (serve.ts) and
  'compression is native' (but via Bun.zstdCompressSync in evidence-io,
  not the fetch compress option - which genuinely has zero consumers).
- claims-audit on the paste's suggestions: 5/6 FOUND; 'HTTP/3 is 2.7x
  faster' misses on the word boundary because the blog writes '2.7x'
  with the multiplication sign (U+00D7) which the boundary regex
  splits - a known boundary quirk, the claim is in the blog.
- rg escaping trap (new, recorded): rg treats '{' as a repetition
  operator and ERRORS (exit 2 -> empty results, silently); through
  spawnSync the pattern must carry '\\{' so rg sees '\{'. Shell tests
  of the same pattern masked this (shell strips one level). Also
  'fetch(' as a regex needs 'fetch\\(' (unescaped '(' = open group,
  silent empty). Debug pattern-vs-function mismatches with the exact
  spawnSync args, not shell.

### 26. 'Upgrading to 1.4' claims verified (all three new ones, zero repo impact)

- The release-notes paste's final 'Upgrading to 1.4' section listed five
  likely-need-a-line changes; three were unverified and are now
  probe-confirmed:
  1. Paused-mode readable.read() returns ONE chunk: probe with node:
     stream Readable - read() #1 -> c1, #2 -> c2 (one per call),
     readableLength 0 after 3 reads. VERIFIED. Zero repo impact (no
     stream.read() usage; the .read() grep hits are unrelated health
     adapters).
  2. Bun.TOML strictness: unquoted strings, missing newlines between
     pairs, and integers past Number.MAX_SAFE_INTEGER are all
     SyntaxErrors (probe: all three throw with clear messages; quoted
     string / newline / at-limit int control cases parse). VERIFIED.
     Repo impact ZERO: config.toml, config/partners.example.toml,
     config/vault-map.toml, bunfig.toml ALL parse cleanly (strings
     quoted, newlines present, ints in range) - validated each with
     Bun.TOML.parse. (Bun.TOML is heavily used: config.ts, toml-
     config.ts, tennis-meta.ts, partners.toml - but all conform.)
  3. bun.lock configVersion 1 + monorepo isolated-linker default: our
     lock already records configVersion: 1; machine bunfig sets
     linker = 'isolated' (global store); fresh 1.4 install writes
     lockfileVersion 2 + configVersion 1. VERIFIED, no change needed.
  (The other two - NODE_MODULE_VERSION 147 and res.writeHeader gone -
  were verified in section 15/16.)
- bun:adoption-audit h2 check extended (paste suggestion): now also
  accepts BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT in bunfig/.env
  as h2 adoption, not just per-request protocol:http2. Still a GAP
  here (neither used - experimental, soft).

### 27. Team-audit round: 4 parallel recon agents + applied fixes

- Ran a 4-agent recon team (tooling, fetch-pool, server, docs; read-only)
  then applied the findings myself. Fixes landed:
  * fetch-pool: first-class `compress` option (FetchCompress type,
    forwarded to fetch; test asserts Content-Encoding:gzip + gunzip
    round-trip) - closes the adoption-audit compress gap as a real API.
    Also: `bytes` now reports UTF-8 BYTE length (Buffer.byteLength),
    not UTF-16 code units (was 17 for a 27-byte multibyte string -
    recon finding).
  * state-compliance.ts: `declare module "bun" { interface Request }`
    -> `declare global` - the module-scoped form SHADOWS the global
    Request inside bun-types' Bun.serve signature and was the ROOT
    CAUSE of the intermittent typecheck flake (recon reproduced it:
    adding only that augmentation + a typed fetch(req) yields exactly
    the TS2339/TS2322 errors seen in the gate). Exposed two test
    fixtures with `parsedBody: {}` that were never type-checked;
    fixed with a valid complianceBody(). trading-auth.ts already used
    the correct `declare global` form.
  * claims-audit HIGH: argv slice(1) leaked the script path into the
    claims (every run reported it NOT FOUND + exit 1) - now
    slice(2). Verified: true claim -> FOUND, exit 0.
  * deps-audit MEDIUM: native-usage count self-matched (no --glob
    exclusion) - inflated 26 -> 21 real APIs. Fixed.
  * adoption-audit MEDIUM: h2 env-flag check died on missing files
    (rg exits 2 on a missing path; .env is gitignored) - now filters
    to existing files.
  * serve.ts: memoryPressure now clears FOUR caches (book + source
    catalog + kalshiAuth + tennis board) on critical; listener removed
    on server.stop() (was leaking per createResearchServer - tests
    create many); bookCache bounded at 512 entries (was unbounded -
    MEDIUM recon finding).
  * runtime-surface h2 check was toothless (typeof fetch) - now
    verifies the protocol option presence.
  * docs: BUN_NATIVE.md gap register + serve.ts section updated with
    the 9 missing facts (h2, TLS resumption, compress, Archive bug,
    parallel/timings, audit tools, memoryPressure, dir routes,
    fetch-pool); stale '5 routes' and '--isolate' / 'timings unused'
    statements corrected; BUN_TECH_STACK quick-start updated.
- Team-audit method note: the first workflow attempt (8 agents in one
  foreground call) timed out at 600s; background subagents + applying
  the findings myself worked better. Recon reports were structured and
  specific enough to act on directly; the fetch-pool agent even
  root-caused the flake that had been masked as a 'known transient'.
- Audit-tooling report closeout (all 6 checks green): the remaining two
  LOW findings are fixed - perf-audit now imports spawnSync at top
  level (was inline require; zero-require convention 8l) and
  claims-audit's dead CACHE const (bun-docs/../) removed. Verified all
  five CLIs exit 0 on true state: breaking 0/1, claims 0 on real
  claim, deps/perf/adoption 0. The claims-audit HIGH (argv slice)
  and deps/adoption MEDIUM fixes were part of 39b633a.
- Server-audit closeout (serve.ts): the 3 actionable findings (bookCache
  cap, listener removal, 4-cache clear) landed in 39b633a. Two more
  fixed here: (1) SECURITY - /api/events.jsonl?file= was a path-
  traversal primitive (joinPath on raw input, no '..' normalization);
  now rejects any non-[A-Za-z0-9._-] name with 400 (probe: ..%2F..%2F
  and %2Fetc%2Fpasswd both 400; bare names reach the normal 404
  path). Test-locked in tests/research/serve-events-jsonl-guard.test.ts.
  (2) PROBE CORRECTION of the agent's suggestion: the audit claimed an
  exact-route Response value (BunFile body) would regain ETag/304 for
  /colors.css - WRONG, verified: neither Response-wrapped nor route-
  value BunFiles emit ETag/304 (probe: both NO etag, If-None-Match
  200); ONLY { dir } mounts do (section 19). /colors.css keeps its
  current shape (cache-control: no-cache + Range/206), which is the
  best available for a single hand-rolled file.

### 28. Color API audit (Bun.color / stringWidth / sliceAnsi) — all verified

- Bun.color surface (probe on 1.4.0, matches cached color.mdx exactly):
  formats css/ansi/ansi-16/ansi-256/ansi-16m/number/rgb/rgba/hsl/hex/HEX/
  lab + {rgb}/{rgba}/[rgb]/[rgba] object-array forms; input accepts CSS
  names, #hex, rgb()/hsl()/lab() strings, numbers, {r,g,b} objects,
  arrays. INVALID input returns null (does not throw). KEY: 'ansi' is
  TTY-aware (returns '' when colors are disabled/non-TTY; probe: ''
  with isTTY undefined), while ansi-16/256/16m ALWAYS emit. The repo's
  color kernel (src/lib/color/) is a CORRECT deep consumer: kernel.ts
  validates the palette on load via Bun.color(value,'HEX') (null ->
  throw), uses ansi-16m for deterministic output (never the TTY-gated
  'ansi'), and terminal.ts paint() has auto (NO_COLOR/TTY-respecting)
  vs deterministic modes. pre-commit's paint() (Bun.color('ansi')) is
  the documented TTY-aware pattern. No repo fixes needed.
- stringWidth grapheme handling VERIFIED correct: ZWJ family (11 cp) ->
  2, skin tone -> 2, flag -> 2, keycap -> 2, combining e+accent -> 1,
  color-escapes ignored. sliceAnsi preserves hyperlinks intact and
  keeps ZWJ families whole on slice. The 1.4 blog claim ('ANSI and
  grapheme aware') HOLDS.
- PROBE-ARTIFACT LESSON (third instance, after h2c and the AOT claims):
  an early stringWidth probe reported ZWJ family -> 8 (should be 2);
  the 'negative' was my probe string being double-encoded in the
  heredoc (literal emoji mangled), not a runtime bug. With proper
  strings the runtime is correct. Rule reinforced: before accepting a
  NEGATIVE runtime result, check the probe INPUT itself (encoding of
  the test string), not just the code path.

### 29. Recurrence prevention: the failure classes are now structural

The three recurring failure classes are no longer 'remember to check'
notes - they have structural enforcement:

- SELF-MATCH (hit 4x: breaking, deps, perf, adoption audits each forgot
  the audit-source exclusion): src/lib/rg.ts is the SINGLE rg helper
  (rgFiles: excludeSelf defaults true -> --glob '!**/*audit*.ts'
  structural; escapeForRg for metachars; count mode for summed counts).
  All four audit libs/tools now call it - no local grepFiles/
  spawnSync('rg') remains (grep-verified). New audit tools must import
  rgFiles, not hand-roll rg.
- PROBE ARTIFACTS (hit 3x: h2c plaintext, AOT claims, ZWJ-emoji
  double-encoding): grapheme behavior is now PINNED with escaped
  \u{...} input (tests/lib/ansi-width.test.ts: ZWJ family 2, skin tone
  2, flag 2, keycap 2, combining 1, hyperlink preserved) and UTF-8
  bytes pinned (fetch-pool test: 27 bytes / 17 code units). Future
  probes have correct references and non-ASCII test strings must use
  \u{...} escapes, not literal emoji.
- RG ESCAPING (hit 2x: '{' and '(' as rg metachars): escapeForRg in
  the shared helper; the 'To mount a directory' / 'regex parse error'
  failures now have one documented home.
- NEW TRAP found while building the helper: writing '\\n' through the
  tool layer double-escapes (file gets '\\n' = literal backslash-n,
  split never fires -> single-element arrays). Verify escape-sensitive
  strings in the WRITTEN file (bun -e read + JSON.stringify), not the
  tool argument.

### 30. Docs-grounding pass (Archive/cron/WebView/fetch vs reference)

- Docs cache refreshed to tag (bun-v1.4.0) reference, then the major
  adopted APIs grounded against runtime/*.mdx. Findings:
  * Bun.Archive: the docs-canonical create path is `new Bun.Archive(
    {path: content})` + `Bun.write(path, archive)` - NOT Bun.Archive.
    write() (typed in bun.d.ts:9566 but absent from the .mdx docs).
    Accepted content types per docs: strings, Blobs, ArrayBufferViews,
    ArrayBuffers - BunFile is NOT listed, so the earlier '0-byte BunFile
    bug' is really DOCUMENTED BEHAVIOR for an undocumented input type
    (the types' ArchiveInput is broader than the docs). bun:backup
    REFACTORED to the docs pattern: new Bun.Archive(bytes entries) +
    Bun.write. Verified: 12 files, 99.1MB tar, extract round-trip intact.
  * Bun.cron: the repo's TZ NOTE (in-process Bun.cron uses SYSTEM local
    time; 1.3.x used UTC; { tz } override) is DOC-CORRECT - cron.mdx
    says exactly this, and the massey job pins { tz: 'UTC' }
    (cron-main.ts:611) as documented.
  * Bun.WebView: usage grounded - `await using view = new
    Bun.WebView(...)` (webview.mdx:11/46) matches partner-webview-ws-
    capture.ts:85; `{ backend: 'chrome' }` matches the shared-Chrome
    pattern; the typeof feature-detect is a sensible guard for an
    optional build feature.
  * fetch-pool: every documented claim confirmed in fetch.mdx -
    keepalive:false opt-out, 256 simultaneous limit, pooling default,
    compress option exists.
  * deps-audit native counts are LINE-MENTIONS (comments/docs included),
    not API calls - WebView reports 44 lines but only ~3 real
    constructors. Acceptable for a coverage report; documented so the
    numbers aren't misread as call counts. The escapeForRg fix made
    the pattern matching literal (previously '.' matched any char).
- Audit CLI output consistency (user request: 'proper separation and
  columns defaulted'): all four audit CLIs (breaking/perf/adoption/
  deps) now print through shared src/lib/ansi-width.ts statusLine() -
  defaulted mark column (6 wide, so ok/WARN/FAIL/GAP/n/a all align),
  defaulted indent (2) + separator (2), override-able via opts. deps-
  audit usage table right-aligns count to 5 + left-pads API name to 28.
  Tests: tests/lib/ansi-width.test.ts statusLine describe (alignment,
  detail append, opts override).
- Deepened (user: 'deeper'): statusLine is now the shared formatter for
  5 consumers - the 4 audits + bun:docs-index fetch log (was the same
  misaligned 'cached '/FAILED ' hand-rolled pattern). Colored marks
  work by passing a PRE-PAINTED mark (Bun.color('ansi') for CSS names,
  TTY-aware like pre-commit's local paint); statusLine stays color-
  agnostic (no import into the color kernel - clean separation).
  KEY TEST LESSON: ANSI-colored marks align by VISIBLE width, not
  string index (escape bytes precede the mark, so indexOf differs);
  assert visibleWidth(prefix), never index. Test-locked.
- CONSOLIDATION (user: 'why not just use Bun's utils by default'): the
  answer was that terminal-out.ts ALREADY calls the Bun primitives
  directly (32 sites); the old src/lib/ansi-width.ts wrappers
  (visibleWidth/padAnsi/sliceAnsiSafe) had ZERO production consumers
  (only their own test) - removed, ansi-width.ts is now a re-export
  shim pointing at terminal-out. statusLine moved to terminal-out.ts
  (4 audit/docs-index consumers repointed). tennis-hq's pad()
  hand-rolled char-loop truncation replaced with native Bun.sliceAnsi
  (width-aware, ellipsis) - use Bun's utils by default. Only
  genuinely-additive wrappers remain: padDisplay/statusLine (Bun has
  NO padding/row primitives - probe: padAnsi undefined, Terminal is a
  PTY class, no table/row helpers), the color kernel (domain palette +
  validation), table-schema (Bun.inspect.table field specs).
- COMPOSITION (user pushback: 'combine the bun utils + auto + brand
  colors; check globals + Bun.inspect.custom'): verified Bun DOES
  compose - (1) Bun.inspect.custom is a real symbol (bun.d.ts:4798,
  utils.mdx:661, identical to util.inspect.custom) and objects with it
  RENDER CUSTOM INSIDE Bun.inspect.table cells (probe: [[OK]] in the
  status column); (2) brand palette hex flows through Bun.color with
  'ansi' auto-TTY detection ('' when non-TTY) or ansi-16m (always).
  ADOPTED: brandMark() in terminal-out.ts composes Bun.color(key,
  'ansi') + brand palette (tennis/middleware/trading hex from COLORS
  SSOT, not ad-hoc green/red) for status marks; docs-index uses it.
  Tests lock both claims (brandMark non-TTY plain + custom cell in
  Bun.inspect.table).
- CORRECTION: SourceMap (blog: 'new SourceMap(json) decoding is 3.1x
  faster') is NOT available in the runtime - global undefined,
  Bun.SourceMap undefined, bun:jsc undefined, zero bun-types
  declarations. It's a bundler-internal API, not a user-facing
  runtime class. Section 13 marked the blog claim 'verified' without
  runtime-probing; corrected here - blog-verified != runtime-available.
- Branded-cell factory (paste #5 'production-grade cells') VERIFIED
  claim-by-claim, then adopted corrected as brandCell() in
  src/research/terminal-out.ts:
  * REAL: opts.stylize (custom inspect receives {stylize, depth,
    colors}; stylize(raw,'string') -> green token when colors:true,
    plain when false/undefined - probe-verified); Bun.stdout.write
    (FileSink, buffered); getters:true shows computed props;
    Bun.stripANSI (all-caps; camel 'stripAnsi' is undefined).
  * WRONG in the paste: Bun.term is UNDEFINED (no cursorTo/clearDown);
    Bun.color('bgGreen','ansi') -> null (no named backgrounds);
    Bun.color returns a STRING not a function (paste's colorMap[..](raw)
    would throw); maxStringLength not accepted (BunInspectOptions is
    only {colors, depth, sorted, compact}); opts to the custom handler
    carry ONLY {stylize, depth, colors} (compact NOT forwarded).
  * ADOPTED brandCell(raw, semantic, meta): [Bun.inspect.custom] cell
    that renders brand-colored (COLORS palette pass/fail/warn/info) via
    Bun.color(key,'ansi') with TTY auto-detection (plain in non-TTY -
    verified), meta via inspect() with reduced depth, tables render it
    (probe: cell shows in Bun.inspect.table). Test-locked: colors
    toggle, TTY-plain fallback, table cell with meta.
- WRAPPER ELIMINATION (user: 'remove unneeded wrappers, use Bun APIs
  directly, make a script'): new bun:wrapper-audit (tools/bun-
  wrapper-audit.ts) detects thin Bun passthrough wrappers (function
  whose body is a SINGLE 'return Bun.X(...)' with args = params
  unchanged). Excludes enriched wrappers (defaults/transform) and a
  KEEP list for intentional seams. ELIMINATED: plainDisplay (dead -
  only consumer was the ansi-width shim) -> Bun.stripANSI; tennis-hq
  visibleWidth (only ascii-bars) -> Bun.stringWidth; absPathToFileUrl
  (zero consumers, dead) deleted; the whole src/lib/ansi-width.ts
  shim file deleted (nothing imported it). KEPT as seams: escapeHtml
  (DI callback into gate-miss/discovery-miss + re-exported by
  views.ts - direct calls would break the injection contract),
  stableHash/inspectBrief/etc (real defaults/transform). Script:
  bun run bun:wrapper-audit (exit 0 when clean, 1 on hits).
- API-usage survey (user: 'does it use Bun.Glob, Bun.spawn piped,
  console depth'): all three used DIRECTLY - Bun.Glob class (new
  Bun.Glob(...).scan/scanSync) in 5 files; Bun.spawn with
  {stdout:'pipe',stderr:'pipe'} + new Response(proc.stdout).text() in
  audit-bun-native, {stdout:'inherit'} in cron-main; console depth via
  bunfig [console] depth=3 + per-run bun --console-depth N (verified
  section 8m). Eliminated one more dead wrapper: globMatch (pure
  passthrough, zero consumers) -> direct Bun.Glob.match in the test.
  src/lib/glob.ts keeps only the ENRICHED listFiles/listFilesAsync
  (sort + option defaults - additive).
- Globstar verification (docs paste): Bun's '**' (globstar) matches any
  depth INCLUDING '/' and - KEY DIFFERENCE FROM GIT - '**/*.ts' matches
  ROOT-LEVEL files too ('index.ts' true, not just 'src/index.ts').
  Probe-verified in both match() AND scan() (root index.ts listed).
  Alternation '{ts,js}' + char classes '[ab]' compose with globstar.
  All 9 probe cases pass; pinned in tests/lib/glob.test.ts. Repo
  already relies on it: architecture-blueprint scans
  'src/**/*.{ts,tsx}', others use '**/*'.
- FULLY-TYPED Bun pass (user: 'better bun native fully typed'):
  eliminated ALL 'as never' in src (was 25 cast sites; Bun-API ones
  are now 0). Fixes: serve.ts memoryPressure handler typed
  ('warning'|'critical' per overrides.d.ts) - process.on/removeListener
  casts dropped; runtime-surface Bun.dns typed directly (Bun.dns is a
  typed namespace); fetchKalshiBookSnapshot(ticker as never) ->
  asKalshiMarketTicker(ticker) (the proper assertion helper); brandCell
  opts typed as BunInspectOptions (spread into nested inspect typed);
  test echo server cast removed (BunRequest extends DOM Request -
  headers/arrayBuffer typed). Legit casts kept + documented: kalshi-ws
  WebSocket ctor (lib.dom wins global ctor), serve.ts Bun.Serve.
  Options (bun-types 1.3.x lag), data-shape casts (Record fields).
  bun:wrapper-audit now ALSO flags untyped 'as never' on Bun/process
  APIs (exit 1) - future regressions caught.
- Node: sweep + more cast removal (user: 'yes we do'):
  * node:fs (readFileSync 34/existsSync 29/mkdirSync 14) - ALL legit:
    module-load-time SYNC reads (SQL migrations, config, seeds);
    Bun.file().text() is async-only so no Bun replacement exists for
    the sync-required sites. 48 files already use Bun.file where
    async fits (documented decision since section 22).
  * node:util - parseArgs (6x, no Bun equivalent), formatWithOptions
    (printf-style %s/%d, Bun.inspect does NOT replace printf). Legit.
  * REMOVED 20 'Bun.env as Record<string, string|undefined>' casts:
    Bun.env is typed (Env & NodeJS.ProcessEnv & ImportMetaEnv) and
    IS assignable to Record<string, string|undefined> - the casts
    were unnecessary (type-level probe confirmed assignability).
    wrapper-audit now flags 'Bun.env as Record' regressions too.
  * Remaining Bun casts are legit + documented: kalshi-ws WebSocket
    ctor (lib.dom wins global ctor), serve.ts Bun.Serve.Options
    (bun-types 1.3.x lag), data-shape casts (optional fields).

### 31. Repo impact of the v1.4.0 'Other behavior changes' (audited + probed)

The v1.4.0 'Other behavior changes' release-notes paste was applied to THIS
repo claim-by-claim (grep across src/tools/scripts/tests + runtime probes on
the repo's 1.4.0 binary). Unlike section 16 (the breaking-changes table),
most items here touch APIs the repo DOES use - but every one was verified
safe on the current code. bun:breaking-audit grew 7 -> 12 checks (section
17 updated); editor.ts got one small fix.

TWO items needed action:
- Bun.openInEditor() throws when no editor is found (was: silent return).
  src/lib/editor.ts openTarget fallback path now try/catches and logs
  instead of crashing the editor:open CLI on editor-less hosts.
- Bun.serve({port}) throws RangeError for non-integer/negative/out-of-range
  (was: silent clamp / random port). serve.ts already passes
  `Number(Bun.env.PORT ?? 3456)`, so a garbage PORT now fails fast at
  startup instead of binding a random port - desired, no change. (Probe:
  NaN/65536/-1 -> RangeError; '3456' still serves.)

Verified-safe usage (repo touches the API; on the safe side):
- bun:sqlite close() finalizes every db.query() statement (was: 'database
  is locked'); close(true) also finalizes prepare() statements; columnNames
  throws after finalize; AS "" columns kept. 16 close() call sites in src,
  ALL close-at-scope-end, no retained statement used after close
  (odds-feed/ticker-mapper/admin/migrate/serve/cache/hq-store/...). NO gate
  check added: every site is uniformly safe, so a greppable check would be
  all false positives. Probes: use-after-close throws; columnNames after
  finalize throws; AS "" survives.
- Bun.color: repo uses 'ansi' (returns '' off-TTY, unchanged) and 'ansi-16m'
  (opaque; the 24-bit-number alpha change does not apply - repo passes hex
  strings). The changed formats (ansi-16 real 16-color escapes, ansi-256
  near-black, hsl/lab, 24-bit numbers) appear only in the regulatory
  scripts' fallback `Bun.color(color,"ansi") || Bun.color(color,"ansi-256")`
  (migrate/sweep-violations/admin) with bright green/red/yellow - not
  near-black - so output is unchanged in practice; cosmetic at worst. No
  gate check (it would flag legit code).
- fetch: all 8 redirect: sites use 'follow' - the redirect:'error'
  narrowing (now only 301/302/303/307/308; 304/other 3xx RESOLVE) is a
  no-op. fetch-pool.ts (AbortSignal.timeout 15s + always-consume) is
  STRICTER under the new abort semantics: body reads reject once the signal
  aborts even if the body fully arrived, and a cut-off compressed body
  rejects instead of resolving partial - both make the pool's timeout
  actually bound the body read. Probes: abort-after-body -> text() rejects
  with the abort reason; redirect:'error' on 304 resolves 304; Latin-1
  request header bytes byte-for-byte (café -> 63 61 66 e9 on the wire);
  gzip decode failure -> ZlibError reject.
- Bun.serve: no websocket routes / server.upgrade() (426 / upgrade()-false
  / unmasked-frame-1006 / ws.subscribe-closed changes all N/A); static dir
  routes now honor If-Match/If-Unmodified-Since (412) at runtime - no code;
  Transfer-Encoding validation probed over a raw socket (gzip,chunked AND
  chunked,chunked -> 400); status outside 100-999 -> Response ctor
  RangeError, server answers 500 via error(); HEAD falls back to GET on
  per-method route objects (probed 200).
- Bun.Cookie: csrf.ts uses maxAge (no Expires emitted) - the Expires
  toUTCString fix (correct weekday / padded day / GMT) is a no-op. Probed:
  Expires=Tue, 02 Jan 2024 03:04:05 GMT.
- Bun.spawn: zero timeout/killSignal/argv0/signal options in repo (rg,
  editor, research-runner pass none) - the NaN/0/NUL/already-aborted
  validation is a no-op. Probes: timeout NaN -> RangeError; killSignal 0 ->
  TypeError; argv0 NUL -> TypeError; aborted signal -> AbortError (no
  process created). NOTE: error names differ from the paste's
  ERR_OUT_OF_RANGE / ERR_UNKNOWN_SIGNAL - Bun throws RangeError/TypeError
  with equivalent messages.
- Bun.deepEquals (bun-native wrapper): compares plain JSON snapshots -
  boxed BigInt/Symbol distinction N/A. Probed: Object(1n) vs Object(2n)
  now distinct.
- structuredClone (coefficients.ts): no transferList - transfer-entry
  validation N/A. Probed: transfer [null] -> TypeError.
- Bun.randomUUIDv7 (hq-view.ts): no timestamp arg - RangeError only for
  ts >= 2^48 / NaN / invalid Date. N/A.
- Bun.JSONC.parse: no real calls (only dep-mapping labels in
  bun-deps-audit / audit-bun-native) - '' and invalid input now throw
  SyntaxError. Probed: both throw.
- Bun.YAML.parse (runtime-surface probe only): NUL now SyntaxError - probe
  input has no NUL. Probed: throws.
- fs: appendFile without options (shadow-line) - flag 'w' truncation N/A;
  no fs.rm / fs.open / fs.write / fs.watch / createWriteStream usage in
  src/tools. Probes: appendFile flag w truncates; rmSync explicit-undefined
  options -> TypeError; openSync({}) flags -> TypeError.
- node:http2: only the fetch-pool-h2 test server (respond + end) -
  remoteSettings {} / pushStream / END_STREAM changes do not affect it.
- util.format/inspect: terminal-utils uses Bun.inspect, not
  util.styleText/util.inspect - ISO-date + ArrayBuffer-bracket changes N/A.
  Probes: %s date -> ISO; inspect(ArrayBuffer) shows [byteLength]: 4.
- process.title: zero usage - defaults to argv[0]-as-invoked (probed:
  'bun' for `bun script.ts`; explicit set works). N/A.
- import * as (db/client.ts schema namespace): never iterated - sorted
  enumeration change N/A. Probed: node:path keys sorted.
- Bun.$: repo usage (live-tracker/simplify-loop) has no redirect targets -
  ambiguous-redirect change N/A. Probed: `echo hi > *.txt` with 2 matches
  -> ShellError exit 1.
- ESM lazy builtin exports: startup only; no import-time side effects in
  repo. Probed: Bun.redis with invalid REDIS_URL returns {} - the paste's
  'throws at the binding' is NOT reproduced; no repo impact.
- fetch Connection/TE token lists, HTTP/1.0 keep-alive, idle-timeout as one
  header-block deadline: client-side; fetch-pool's 15s AbortSignal.timeout
  supersedes the 300s idle deadline. No repo code.
- Warnings format (node:PID) [CODE]: cosmetic; nothing asserts it.

NOT REPRODUCED on 1.4.0 (probe) - flag any future paste that repeats it:
- 'odd-length hex passed to Bun.CryptoHasher#update() now throws':
  update('abc') still hashes the TEXT (sha256 = ba7816bf...), no throw;
  there is no updateHex() method on 1.4.0. Repo hashes text anyway
  (hash.ts update(serialized)).

No repo usage at all (paste items with zero code contact): bun feedback;
Bun.password argon2 memoryCost; bun update/init/install/remove CLI
semantics; bunfig-vs-.npmrc precedence (no .npmrc); catalog:/workspace:
ranges/trustedDependencies (no catalogs, no workspace:, no
trustedDependencies, no overrides; lock stays v1 under frozenLockfile);
lockfileVersion-3 nested overrides; wildcard exports/imports extension
retry (deps resolve; vendor proton-pass is file:); every bun build item (no
builds; perf-audit only advises metafile:true); import-binding assignment;
browser-field remap; --minify $; Bun.udpSocket; Bun.Terminal (labels only;
PTY probe unavailable in this harness); Bun.RedisClient; FileSystemRouter;
bun:ffi; S3Client checksumAlgorithm; TextDecoder primitive options (repo
decodes without options); crypto.subtle; createDiffieHellman;
fs.write/readv/writev position; child_process encoding (labels only); N-API
status codes (no addons); Windows libuv errnos; node:test skip (no
node:test); process.execve/reallyExit/getBuiltinModule;
assert.deepStrictEqual (no usage; bun:test expect unchanged);
util.styleText (Node 26 API); Response.redirect; WebSocket proxy scheme
(kalshi-ws proxy is env-driven http/https); Bun.sql PGSSLMODE / infinity
dates / connectionTimeout (no usage); PR_SET_THP_DISABLE (Linux startup
only).

New gate checks (bun:breaking-audit 7 -> 12; all ok on this repo):
- Bun.serve port from raw env (RangeError on garbage port)
- server websocket routes / server.upgrade() (426 + upgrade()-false + 1006)
- fetch redirect:"error" (304/other 3xx now resolve)
- Bun.spawn timeout:NaN / killSignal:0 / argv0 (validation throws)
- Response.error() in handlers (answers 500 via error())

Hygiene: .bun-version was stale at 1.3.14 while the runtime,
packageManager and engines pins were 1.4.0 - aligned to 1.4.0 so bun-v /
mise pick the same version. All minimum-version statements were then
aligned to 1.4.0 too: README prerequisites (>= 1.3.14), the bunfig noOrphans
comment (>= 1.3.14), vendor/proton-pass's bun-types peer range (>=1.3.0),
and BUN_NATIVE.md's Bun.version format note ("1.3.x"). The remaining 1.3.x
mentions are HISTORICAL records and stay: BUN_UPGRADE_CANARY.md phases
(the documented 1.3.14 -> 1.4.0 upgrade), the bun-v1.3.14 release catalog,
@updated/@verified annotations in vendor/proton-pass, bun-types 1.3.x lag
comments, and release-blog test fixtures.
### 31b. Backpressure-section paste (Bun.color / Bun.Glob / Bun.Cookie / color-mix / getColorDepth) — audited + probed

A second paste from the v1.4 'backpressure' section (color/glob/cookie
items) applied claim-by-claim: grep across src + runtime probes on 1.4.0.
Verdicts:

VERIFIED (probe):
- Bun.color ansi-16 emits decimal digits: #27AE60 -> \x1b[32m, #E05E5E ->
  \x1b[91m, #4DA3FF -> \x1b[94m (no raw control byte).
- ansi-256 grey ramp has no underflow: #000000->16, #1b1b1b->234,
  #808080->244, #eeeeee->255, #ffffff->231.
- hsl/lab output is parseable and round-trips: hsl(153.39,47.72%,47.25%)
  -> #3FB27F; lab(...) -> lab(...) (normalized, parseable).
- 24-bit numbers opaque (0xff0000 -> \x1b[38;2;255;0;0m) - already in
  section 31.
- Bun.Cookie.parse records BOTH Expires and Max-Age regardless of order;
  isExpired() applies the RFC 6265 precedence (Max-Age=0 -> expired).
- Bun.Glob: explicit dotfile segment matches WITHOUT dot:true
  ('.hidden/*' -> ['.hidden/f.txt']); literal segments resolve through
  symlinked dirs WITHOUT followSymlinks ('link/*' -> ['link/g.txt']);
  deeply nested braces expand ('{a,{b,c}}/*' -> ['a/1.txt','b/2.txt']).
- color-mix: Bun.color returns null (Bun.color does not parse it); the
  claim's out-of-range rejection lives in Bun's CSS path, not Bun.color.

REPO IMPACT (all safe, no code changes):
- Bun.Glob: hq-data.ts alpha/calibration scans use '*/program.json' and
  '*/manifest.json' (literal segments, no dotfiles/symlinks/braces) - the
  verified dotfile/symlink/brace behaviors do not affect them; the §31
  node:fs -> Bun.Glob swap is correct.
- Bun.color ansi-16/ansi-256: the color kernel deliberately uses ansi-16m
  only (section 28) - the decimal-digits and grey-ramp fixes are
  irrelevant to repo output.
- hsl/lab: repo design docs rule out LAB (COLORS.md); no usage.
- color-mix: repo uses color-mix() in analyze-table.ts generated CSS (8
  sites, all in-range 4-92%) - the out-of-range rejection cannot trip the
  repo; if Bun's CSS path ever validates these, the repo stays in-range.
- getColorDepth: no repo usage - the TMUX/xterm-kitty/CI depth report and
  the empty-NO_COLOR change (per no-color.org) are N/A; the repo relies
  on Bun.color('ansi') TTY auto-detection ('' off-TTY, probe-verified).
- S3Client Content-Length:0 / Connection:close: no usage.
- stringWidth SIMD: perf-only; repo already uses Bun.stringWidth.
- Bun.Cookie parse/isExpired: repo uses the maxAge-only constructor
  (csrf.ts) - no parse()/isExpired() call sites; Expires serialization
  already audited in section 31.

### 32. Serve ops: use `bun --hot`, and the EADDRINUSE restart recipe

The report browser's dev command is `bun run serve` = `bun --hot
src/research/serve.ts`. RUN IT WITH --hot, not plain `bun serve.ts`:
- --hot SOFT-reloads the module graph without restarting the process;
  Bun.serve re-binds the handler in place (verified: edit serve.ts while
  running -> reload logged, port stays 200, NO EADDRINUSE). Plain mode
  + kill/restart is where the port-release race lives.
- The memoryPressure listener is registered per evaluation; under --hot it
  would ACCUMULATE one per reload (old process showed 3 after pre-guard
  reloads). serve.ts now keeps the last handler on globalThis and
  removeListener()s it before re-adding (docs: globalThis survives hot
  reloads). Fresh process + 2 reloads -> listenerCount stays 1.
- Restart recipe when the port IS stuck (EADDRINUSE at serve.ts:1512):
  `pkill -f 'bun --hot src/research/serve.ts'` -> wait 1.5s -> verify
  `curl localhost:3456` refuses -> start ONE `bun --hot` instance.
  lsof is sandbox-blocked in this harness; pkill+curl is the check.
- Do NOT start a second instance on 3456 - pick a PORT env override or
  stop the first. job_kill on the DSH wrapper does not always kill the
  bun child; pkill -f the exact command line is the reliable kill.

### 33. Observability paste (cpu/heap profilers, inspector, memoryPressure) — audited + probed

The v1.4 'Observability' paste was applied claim-by-claim (probes on 1.4.0).
Verdicts:

VERIFIED (probe):
- `--cpu-prof` writes a .cpuprofile (759 B for the probe app); openable in
  DevTools. `--cpu-prof-md` writes CPU.<ts>.md - markdown profile with top
  functions by self time (probe: 1.4 KB report generated).
- `--heap-prof-md` writes Heap.<ts>.md - 407 KB markdown heap report
  (summary: total heap, top types by retained size, gcroot search).
- `BUN_CPU_PROFILE=1` enables the CPU profiler for processes you cannot
  pass flags to (probe: .cpuprofile written).
- node:inspector Session with Profiler.start/stop works in-process
  (probe: profile.nodes returned).
- Async stack traces: a fetch() failure stack points at the `await` line,
  not native frames (probe: 'at async fetchFail (async-stack.ts:2:9)').
- process.on('memoryPressure') platform semantics match the repo's serve.ts
  guard (already adopted): macOS kqueue EVFILT_MEMORYSTATUS (warning|
  critical), Linux PSI /proc/pressure/memory (critical only), Windows
  CreateMemoryResourceNotification (critical only). The handler's
  'if (level !== critical) return' is correct for Linux/Windows.

PASTE DISCREPANCY (probe):
- `--heap-prof` writes Heap.<ts>.heapprofile (132 KB, V8-compatible) - NOT
  '.heapsnapshot' as the paste says, and an explicit `--heap-prof=path` is
  ignored (it writes the timestamped file regardless). Content opens in
  DevTools; only the extension/claim differs.

ADOPTED:
- `--metafile-md=dist/design-system.meta.md` added to design:watch - the
  LLM-friendly bundle report (quick summary: output size + input modules;
  largest modules; entry analysis; dependency chains) alongside the JSON
  meta. design:build (API) keeps metafile:true -> meta.json; the perf-audit
  metafile check matches both forms.

N/A: Datadog dd-trace/@datadog/pprof and @opentelemetry/* - no such deps in
  the repo (the guard bans npm deps where Bun-native exists; nothing here
  needs a tracing agent).
KALSHI SIGNING-PATH BUG (probed + fixed 2026-08-24):
- Kalshi signs the FULL request path (host excluded): /trade-api/v2/
  portfolio/balance - NOT /portfolio/balance. kalshi-client's signedRequest
  passed the ENDPOINT path to kalshiAccessHeaders -> every signed REST call
  401'd 'authentication_error' even with VALID creds (probe: same key,
  same headers; signing /portfolio/balance -> 401, signing
  /trade-api/v2/portfolio/balance -> 200). probeKalshiAuth already used
  new URL(endpoint).pathname (correct); kalshiWsAccessHeaders signs
  KALSHI_WS_PATH = URL.pathname (correct). The REST client was the odd
  one out. Fixed: signedRequest now signs new URL(baseUrl + path).pathname.
  The hq trading section also got defense-in-depth: balance FIRST (the
  authoritative auth probe), enrichment SEQUENTIAL (never a 4-parallel
  signed burst - Kalshi rate limits are token-bucket, most requests cost
  10 tokens, docs.kalshi.com/getting_started/rate_limits), TTL 15s -> 60s.
- Diagnostic note: 'missing KALSHI_API_KEY_ID' from kalshi:live-probe is
  BY DESIGN (keychain-only probe, empty env). And: don't hammer the live
  key with rapid probes while diagnosing - Kalshi 401s under burst look
  like auth failures but are the token bucket.
PROFILE TARGETS + FLAG FORMS (probed):
- `--cpu-prof-md` / `--heap-prof-md` do NOT take a value: they write
  CPU.<ts>.md / Heap.<ts>.md to the CWD (a `=path` form ERRORS: 'does not
  take a value'). Same for --cpu-prof/--heap-prof (no =path). Find the
  latest with `ls -t CPU.*.md`.
- Wired scripts: profile:serve, profile:research (dry-run+offline -> 41ms
  profile; the FULL online run is the meaningful one), heap:serve
  (Ctrl-C; cross-check top retainers against what the memoryPressure
  handler clears: bookCache, sportsSourceCatalog, kalshiAuth, tennisBoard).
- The research pipeline (cli.ts) is the real CPU hot path; the serve is
  mostly idle (4-5ms requests) - profile:research first.

## 9. Bun Shell (`Bun.$`) switch — verified API surface (2026-08-23)

Converted all non-keep-list `Bun.spawn` sites to `Bun.$` — see BUN_SHELL.md
"Repo-wide default" + keep-list). Verified on Bun 1.4.0, in order of surprise:

| Symptom | Cause | Fix |
|---------|-------|-----|
| `TypeError: $`cmd` is not a function` | The callable-options form (`$`cmd`({ stdout: "inherit" })`) does not exist in 1.4.0 | Default `$` streams to the parent (≈ inherit) and still returns captured Buffers; `.quiet()` suppresses |
| `$`cmd`.stdin is not a function` | No `.stdin()` method in 1.4.0 | JS-object redirection: `$`cmd ${args} < ${Buffer.from(value)}`` (verified; empty buffer closes stdin); `printf|` pipe as fallback |
| `$`cmd`.stdout("inherit") is not a function` | No stdio-setter methods | Default streaming is inherit-like; use `.quiet()` for capture |
| `.text()` / `.json()` throw on non-zero exit | Documented throw-path | `.nothrow().quiet()` → `{ exitCode, stdout, stderr }` |
| NUL bytes in output? | They round-trip byte-exact (`printf "a\0b"` probe) | `stdout.toString().split("\0").filter(Boolean)` for `git ls-files -z` |

Rules that still apply: never `$`bash -c "…"` with interpolated input; array
interpolation escapes each element as a separate argv token.
## 10. Grep discipline + Node->Bun spawnSync (2026-08-23)

### 10a. A backslash-b in a JS template literal silently mangles a grep

Writing `grep -E '\bspawn\('` inside a run_code template literal turns the
`\b` into a BACKSPACE byte (JS string escape), so the pattern literally
searches for a backspace followed by "spawn(" - matching NOTHING and
producing a false "zero usage" claim (this bit the child_process audit:
the repo had 3 node:child_process sites all along). Fix: use the repo's
rgFiles / escapeForRg (src/lib/rg.ts) for code greps, or double-escape the
backslash in template literals.

### 10b. Node child_process.spawnSync -> Bun.spawnSync contract

- result.status -> result.exitCode (Node-only status fails typecheck).
- encoding: 'utf8' is NOT a Bun option - Bun returns Buffers; call
  .stdout.toString().
- Node returns status: null on a missing binary; **Bun THROWS on spawn
  failure (ENOENT)** - wrap optional binaries (rg, openssl, find) in
  try/catch and return the same fallback as a non-zero exit.
- **Bun.$ passes stdin through** to the child by default (verified:
  `echo hi | bun -e 'await $`cat`'` -> hi), but it PIPES stdout/stderr -
  the child sees isTTY=false. For CLIs that need the parent's true TTY fds
  (pass-cli agent prompts, drizzle-kit push), keep Bun.spawn with stdio
  inherit and list the file in SPAWN_KEEP_LIST.
- **Bun.dns.resolve* shapes (1.4.0, runtime-probed):** CNAME/NS -> string[],
  TXT -> string[][] (flatMap the chunks), MX -> [{priority, exchange}]. A host
  with NO CNAME REJECTS (ENOTFOUND) - .catch(() => []) mirrors dig empty
  output. bun-types 1.4.0 does NOT declare resolve* (types lag the runtime) -
  use an isolated cast (host-discover DnsResolveSurface) and add a
  runtime-surface guard check.
- **node:tls works on 1.4.0** (probed): tls.connect({ host, servername,
  rejectUnauthorized: false }) + socket.getPeerCertificate().subjectaltname
  returns 'DNS:github.com, DNS:www.github.com' - replaced openssl s_client +
  x509 in host-discover with zero subprocess. Filter to DNS: entries, lowercase,
  sort; wrap with an 8s timeout -> [] (the old openssl path had none).
  rejectUnauthorized:false trips the breaking-audit TLS check - the probe-only
  case is allowlisted via TLS_OVERRIDE_ALLOWLIST (you cannot chain-verify a
  host you are identifying for the first time).

## 11. Docs-grounding: a word across Bun docs pages is NOT a concept (2026-08-23)

"Metadata" appears across unrelated Bun docs pages with no unified topic -
do not treat a shared word as a cross-linkable concept, glossary entry, or
single claim:

| Page | What "metadata" means there |
|------|------------------------------|
| docs/pm/cli/info | package metadata from the npm registry |
| docs/pm/cli/install (npm-registry-metadata) | how Bun caches registry metadata locally (this repo: research/registry *.npm blobs) |
| guides/html-rewriter/extract-social-meta | Open Graph / social meta extraction from HTML |
| docs/runtime/s3 | example file reference named metadata (NOT a metadata API) |
| docs/bundler/bytecode | ESM bytecode embeds module metadata; per-function metadata overhead |
| docs/runtime/image (metadata) | Bun.Image.metadata() -> { width, height, format } without decoding pixels |
| docs/runtime/markdown (callback-signature) | render callbacks receive a meta object (element-specific) |
| docs/test/reporters | JUnit reporter <properties> (CI/commit/hostname) |

Rule: verify a concept exists on its canonical page before merging the word
into the glossary, cross-referencing pages, or claiming it in BUN_NATIVE.md.
A shared word is a coincidence; a concept needs its own API/page. This repo's
glossary (src/institutions/glossary.ts) is Kalshi-domain ONLY - do not add
Bun-docs words like metadata to it.

## 12. Bun.Image 1.4.0 — file-based decode/meta, NO rasterizer (2026-08-24)

VERIFIED (probe):
- `Bun.file(path).image()` decodes an image; `.metadata()` returns
  `{ width, height, format }` (probe: 64x64 png). The instance also has
  transforms (`resize(w,h)`, `rotate(deg)`, `flip()`, `flop()`) and
  re-encoders (`png()`, `jpeg({quality})`, `webp({quality})`, `avif`, `heic`)
  plus `.bytes()/.buffer()/.write(path)`. Ground-truth metadata comes from
  RE-decoding the written file (the in-memory object reports the source's
  dims even after resize — probe: resize(32,32) object still said 64x64,
  on-disk decode said 32x32).
- `Bun.Image.metadata()` does NOT exist; `Bun.Image` statics are clipboard-
  only (`fromClipboard`, `hasClipboardImage`, `backend`). The SVG/HTML
  rasterizer (`Bun.image(svg)`) does NOT exist in 1.4.0 — SVG metadata via
  Bun.Image throws 'unrecognised format'. Brand SVG is served as-is.
- `Bun.file(bytes)` is NOT an in-memory image source (path-only, rejects
  null bytes) — decode requires a real file path. `Bun.file(p).size` is a
  property, not a method.
- ADOPTED: `images:meta` CLI (metadata table + --to/--resize conversion),
  `/brand.svg` + `/brand/swatch/<token>.png` routes, brand-card.svg is an
  enforced design surface, and `src/lib/brand-image.ts` wraps it all.

CORRECTION (2026-08-24, bun-v1.4 blog): the CONSTRUCTOR is the in-memory
decode + the chain is sharp-style — `new Bun.Image(bytes)` decodes bytes
directly (no file path needed), `.resize(w,h,{fit:'inside'|'fill'})`,
`.rotate()`, `.webp({quality})`/`.jpeg({quality})`/`.png()`/`.avif()`
chain, and a transformed Image IS a Response body (`new Response(img)`).
The earlier 'no in-memory decode' claim was wrong — I tested Bun.Image()
and Bun.Image.metadata() but never the constructor. SVG rasterization is
still unavailable in Bun.Image, but Bun.WebView screenshot does it:
`new Bun.WebView({ url: data:… }).screenshot({ format:'png',
encoding:'buffer' })` (settle ~300ms first — immediate screenshots throw
'Completion handler for function call is no longer reachable'; the
document.fonts.ready evaluate from tennis-ws-ground is NOT sufficient for
a small static page — a plain delay is the robust fix).
ADOPTED: brand-image.ts uses the constructor (decodeImage/transformImage/
Response bodies), /brand/card.png serves the WebView-rasterized card
(cached per design version), images:meta supports --fit/--rotate.

## 13. Bun.serve video Range/206 + data-URL inlining pitfall (2026-08-24)

VERIFIED (probe): `routes: { "/videos/*": { dir: public/videos } }` serves
video files with ZERO custom code: full GET -> 200 + `accept-ranges: bytes`
+ content-type from extension (`video/mp4`); `Range: bytes=100-199` -> 206
Partial Content with exact `content-range: bytes 100-199/500000` and 100
bytes; open-ended `bytes=200-` -> 206 with the tail. Seeking works out of
the box (sendfile zero-copy). The `/videos` page (token-built, audited
surface) lists + plays files via the route path.

PITFALL: referencing `<video src="./demo.mp4">` with a RELATIVE path in an
HTML-import page (hq-app/index.html etc.) makes the bundler INLINE the
file as a `data:` URL — fine for tiny assets, catastrophic for video.
Always use the served route path (`/videos/<name>`). Same rule applies to
any large binary referenced from an HTML import.
ADOPTED: /videos/* dir route, /videos page, public/videos/README, video
page is a design:check surface (15 surfaces).

## 14. Bun.serve routing precedence + param-route traversal guard (2026-08-24)

VERIFIED (probe): routes matching order is EXACT > PARAM > WILDCARD/dir.
- `/videos/index.json` (exact) beats `/videos/:id` (param) beats
  `/videos/*` (dir). A param route OWNS all single-segment paths under its
  prefix — multi-segment paths fall to the dir wildcard.
- `req.params.id` on route handlers; Bun.file() bodies from a param route
  still get Range/206 + content-type from extension (probe: bytes=0-99 ->
  206 content-range bytes 0-99/300000).
- Traversal (`/videos/..%2F..%2Fpackage.json`) 404s — but a hand-rolled
  param route must validate its own id (`isSafeVideoId`: no separators,
  no `..`, video ext only, length cap) since the dir route's openat2
  O_RESOLVE_BENEATH protection does NOT apply to param handlers.
ADOPTED: /videos/:id param route + /videos/index.json exact manifest;
the /videos page links the manifest.

## 15. Bun.Networking claims probed (2026-08-24) — what the marketing copy gets wrong

VERIFIED:
- `Bun.listen()` TCP server + `server.reload()` hot-swap + `Bun.connect()`
  (probe: echo on 127.0.0.1, reload/stop are functions).
- `Bun.udpSocket()` + `addMembership` / `setMulticastTTL` / `send` exist.
- `http3: true` requires `tls` (probe: throws 'HTTP/3 requires tls to be
  set' otherwise) — consistent with the docs' example.
- sendfile zero-copy + Range/206 + ETag/304 + openat2 O_RESOLVE_BENEATH:
  already verified in-repo (dir routes, videos).

CORRECTED (marketing copy is wrong for 1.4.0):
- `req.file()` DOES NOT EXIST — the multipart upload example is invalid;
  use `req.formData()` + form.get('file').
- `new Response(Bun.file('./app.html'))` does NOT bundle scripts/styles —
  it serves the raw file (probe: script src unchanged, no bundling). HTML
  bundling happens ONLY via HTML imports (`import html from './app.html'`
  -> routes['/app'] = html), which is what /hq uses.

UNVERIFIABLE/NOT CLAIMED: marketing benchmarks (34k req/s static, 72k
JSON, 12ms cold start), trie O(1) routing, 1,517 Node.js compat tests,
QUIC interop suite. The /bun/networking page marks these as unverified.
ADOPTED: /bun/networking token-built page (audited surface, 16 surfaces)
with per-claim probe badges.

## 16. Streams + terminal primitives probed (2026-08-24) — the observability widgets

VERIFIED in Bun 1.4.0:
- `Bun.stringWidth` (emoji + CJK grapheme-aware: ⬇️ = 3, 下载 = 4),
  `Bun.sliceAnsi` (slice preserves ANSI codes), `Bun.wrapAnsi`.
- Native `CompressionStream`/`DecompressionStream`/`TextEncoderStream`/
  `TextDecoderStream` — gzip round-trip probed (6000 -> 74 -> 6000 B).
- `Response.clone()` — both bodies readable.
- `Bun.markdown` exposes html/ansi/render/react — `Bun.markdown.ansi()`
  exists (the widget claimed it; confirmed).
- The profilers (--cpu-prof-md/--heap-prof-md/--metafile-md/
  BUN_CPU_PROFILE) + process.on('memoryPressure') were already verified in
  earlier probes and are used by the repo's own scripts.

NOT CLAIMED: all throughput/memory/startup benchmarks in the widget copy
are release-note marketing figures; the /bun/performance page labels them
marketing and points at the repo's own profiles instead.
ADOPTED: /bun/streams, /bun/observability, /bun/performance widget pages
(token-built, audited — 19 design surfaces), shared widget-page renderer
(src/lib/widget-page.ts), and `bun run profile:all` (runs every profiler,
Markdown out).

(token-built, audited — 19 design surfaces), shared widget-page renderer
(src/lib/widget-page.ts), and `bun run profile:all` (runs every profiler,
Markdown out).

## 17. Built-in utilities + fetch client probed (2026-08-24) — updated widgets

VERIFIED in Bun 1.4.0:
- `Bun.JSON5.parse` / `Bun.JSONC.parse` / `Bun.JSONL.parse` all work
  (comments, trailing commas, NDJSON arrays).
- `Response.textStream()` returns an async-iterable stream.
- Post-quantum crypto: `crypto.subtle.generateKey({ name: 'ML-DSA-65' })`
  works (keygen probed).
- fetch request compression: `compress: 'gzip'` sends `content-encoding:
  gzip` + compressed body (47 B), `{ encoding: 'br', level: 9 }` -> br
  (27 B) — VERIFIED against a local server.
- bun:ffi `dlopen` present; Bun.Archive exists but its surface is `write`
  (the docs' tar/create example is NOT the 1.4.0 API shape).

NOT CLAIMED: FFI speedups (3x/3.8x), HTTP/3 static-route throughput (2.7x),
1,517 Node.js compat tests, 535k Zig -> 1M+ Rust / 64 agents / 11 days,
~382 MB eliminated (package-size estimates), TLS session resumption /
proxy headers (need real TLS/proxy peers to exercise) — all labeled
marketing/note on the pages.
ADOPTED: /bun/utilities + /bun/overview pages; networking page gained a
fetch-client section; performance page gained FFI + HTTP/3 sections.
design surfaces: 21.

## 18. WebView in the merge gate — final call (2026-08-24)

WebKit screenshots are UNRELIABLE under `bun test --parallel` (worker
processes contend for the window server; captures can return corrupt
buffers that fail decode). The repo's own WebView tests never screenshot
in the merge gate (presence/html-only). DECISION: the brand-card raster
test asserts the CONTRACT (hasWebView true, brandCardPng returns a buffer
or null, never throws); the REAL capture + exact 1200x630 verification is
`bun run brand:card` (CLI, ground-tool pattern) + the serve smoke
(/brand/card.png serves a verified 1200x630 PNG). This is the same split
tennis-ws-ground uses (tests assert; the CLI captures).

## 19. GitHub releases.atom feed folded in (2026-08-24)

bun:release-watch now ALSO fetches https://github.com/oven-sh/bun/releases.atom
(the second verified Bun.XML shape: feed.entry[] with '@'-prefixed link
attrs — same RssEntry shape as the RSS parser, so latestRelease works on
both). It cross-checks the GitHub latest against the blog RSS and warns on
mismatch (GitHub is authoritative). Verified live: RSS 'Bun 1.4' <-> atom
'Bun v1.4' (bun-v1.4.0) match. parseAtomEntries guards malformed XML
(Bun.XML.parse throws -> []).

## 20. Install/test tooling folded in (2026-08-24)

- bunfig [install] now sets `linker = "isolated"` (bun 1.4 global virtual
  store: packages extracted once into Bun's cache, symlinked via
  node_modules/.bun/ — 7x faster warm CI installs on large projects;
  verified `bun install --frozen-lockfile` still passes, .bun store
  created). This repo is 3 deps, so the win is small but the layout is
  the recommended one.
- `deps:diff` (bun pm diff for every npm runtime dep; file:/link:/git:
  specs skipped — no registry diff). Verified: zod/drizzle-orm no
  differences (718/2666 files).
- `deps:prune` / `deps:prune:prod` (bun prune / --production) — verified
  dry-run: nothing to prune.
- `deps:audit-fix:dry` (bun audit fix --dry-run) — verified: no
  vulnerabilities. The actual fix conflicts with frozenLockfile (runs
  manually).
- `test:shard` (bun test --parallel --timings --shard=$TEST_SHARD) for CI
  matrices — the repo already used --parallel/--timings/--changed/--retry.
- `bun dedupe --check` (already in CI) verified green with the isolated
  linker: no duplicates.

## 21. Bun.cron signal channel + dynamic dashboard (2026-08-24)

- Bun.cron verified in 1.4.0 (probe): function form (event loop, no system
  cron), `Bun.cron.parse()` -> next run Date, job.unref()/stop().
- serve.ts registers ONE signal-refresh Bun.cron (*/5 * * * *) per process
  (guard flag — tests create many servers), unref'd so it never blocks
  exit. It re-collects signals into the cache; the pipeline's cron channel
  reports registered/lastOk/runs/last/next.
- /dashboard is now DYNAMIC: each section carries data-channel; the page
  polls /api/signals every 15s and re-renders channel tables in place
  (severity badges + action buttons rebound) — no full reload.
- REMOVED startup card WARMING: the boot-time WebView capture crashed the
  process with an escaped 'WebView closed' (async WebKit error bypassing
  try/catch). /brand/card.png warms on first request instead.

## 22. Bun color stack probed (2026-08-24) — what the marketing copy gets wrong

- `Bun.color(hex, "luminance")` DOES NOT EXIST — TypeError. Luminance and
  contrast are NOT Bun formats: WCAG 2.1 math lives in the kernel
  (`relativeLuminance` / `contrastRatio` / `accessibleForeground` in
  src/lib/color/theme.ts + kernel luminance/contrast for palette keys).
- Output formats are exactly: `[r,g,b,a]` `[rgb]` `[rgba]` `{r,g,b}` `{rgb}`
  `{rgba}` `ansi_16`/`ansi-16` `ansi_256`/`ansi-256` `ansi_16m`/`ansi-16m`/
  `ansi-24bit`/`ansi-truecolor`/`ansi` `ansi256` `css` `hex` `HEX` `hsl`
  `lab` `number` `rgb` `rgba`. The doc's `"object"`/`"array"` formats do
  NOT exist — use `{rgba}` / `[rgba]` etc. `number` = 0xRRGGBB.
- The 2nd argument is an OUTPUT format only. Passing a CSS color-space
  keyword (`"srgb"`, `"display-p3"`) throws TypeError — you cannot force
  interpretation, only conversion.
- Inputs: `color-mix(in srgb, …)` and `hwb(…)` ARE parsed (probe:
  `color-mix(in srgb, red 50%, blue)` -> `#800080`; `hwb(0 0% 0%)` ->
  `#ff0000`). `device-cmyk(...)`, `lab(...)`, `lch(...)`, `oklch(...)`
  inputs return null (silently unparsed) — do NOT rely on them.
- `hex` output DROPS alpha: `#ff0000aa` -> `#ff0000`; `transparent` ->
  `#000000`. No 2nd arg = identity passthrough, NOT a conversion. `css`
  output is 'most compact' (can emit named colors, e.g. `red`).
- `ansi` (auto) honors NO_COLOR / FORCE_COLOR / TTY: piped or NO_COLOR ->
  empty string; FORCE_COLOR=1 -> 16-bit, =2 -> 256, =3 -> 24-bit (verified
  even when piped). Explicit formats (`ansi-256`, `ansi-16m`, `ansi-16`)
  ALWAYS emit — NO_COLOR does not silence them (probe-verified).
- `Bun.markdown.ansi(md, { heading/render/header/... })` options are
  IGNORED in 1.4.0 — output identical for every option shape probed. There
  is NO per-element renderer callback. `Bun.markdown` surface: `html`,
  `ansi`, `render`, `react`; `render` returns plain text (probe: "Hibold"),
  `html` returns real HTML.
- Image generation from raw pixels: `ImageData` is NOT a global in Bun
  1.4.0 (neither is `Image`) — the doc's `new ImageData(...)` +
  `new Image(imageData)` + `.pipeTo(Bun.file().writer())` chain does NOT
  work. The verified zero-dep path is the hand-rolled PNG encoder
  (`encodeSolidColorPng` in src/partner/visuals.ts — zlib-wrapped deflate,
  strict-decoder verified via Bun.Image.metadata). `Bun.file().writer()`
  IS a valid pipeTo destination for encoded streams (probe-verified).
- `util.styleText` (node:util) EXISTS in Bun and is the auto-fallback
  styler: plain text when piped/no TTY, ANSI under FORCE_COLOR (verified:
  `styleText("green", "hi")` -> `\x1b[32mhi\x1b[39m` with FORCE_COLOR=3).
- Perf marketing "~100 ns" is understated marketing: measured here ~360-550
  ns/op (hex 361, ansi-16m 364, color-mix 545) on this machine. Still
  native and allocation-free in JS — just not 100 ns.
- Folded in: src/lib/color/theme.ts (one semantic theme -> ANSI/CSS/PNG),
  /api/color/theme, /bun/color explorer page, `bun run color:theme` CLI
  (terminal preview + artifacts/theme-swatches/*.png + color-theme.json),
  tests/lib/color-theme.test.ts, and the design:check /bun/color surface
  (probe-table example hexes allowlisted as data).

## 23. Integrated architecture probed (2026-08-24) — feed + theme + live channel

- WebSocket in Bun.serve VERIFIED end-to-end: `server.upgrade(req, { data })`
  in fetch, `websocket: { open, message, close }` in serve options,
  `ws.readyState === WebSocket.OPEN` (1), `ws.data` passthrough, two-way
  `ws.send`. Topic broadcast: `ws.subscribe(topic)` + `server.publish(topic,
  msg)` — a subscribed client received the published message (probe). The
  research server now upgrades `/api/live` and broadcasts theme-update +
  feed-update (src/institutions/live-channel.ts).
- The doc's "SQLite (Bun.SQL)" claim is WRONG: `Bun.sql` is a POSTGRES
  tagged-template client (probe: PostgresError, Query object with
  execute/run/raw/values). SQLite in this repo is `bun:sqlite` Database;
  `INSERT OR IGNORE` on a PRIMARY KEY(link) dedups — verified (changes === 1
  only for new rows; lastInsertRowid is NOT a reliable signal).
- `Bun.XML.parse` enclosure shapes VERIFIED: RSS items expose
  `enclosure["@url"]`, `["media:content"]["@url"]`, `["media:thumbnail"]["@url"]`
  (the `@`-attribute convention). release-blog.ts now extracts imageUrl.
- `Bun.Image.modulate({ brightness, saturation })` EXISTS and works;
  `hue`/`lightness` showed no observable effect on solid swatches, and the
  call MUTATES the source image (sharp-style purity NOT preserved — encode
  a copy first). The doc's "tint feed images to match theme" is only
  partially real: brightness/saturation only, and only on copies.
- `Bun.cron("0 * * * *")` string form VERIFIED: `Bun.cron.parse` returns
  the next run Date. Hourly feed cron registered once per process
  (module-state guard — tests create many servers), unref'd.
- Live `change-theme` is EPHEMERAL: hexes are validated (isHex) and
  broadcast to connected clients only. NOT persisted to disk — TOKENS
  remains the audited one-vocabulary source; persisting arbitrary hexes
  would break the design gate. (The doc's persist-to-theme.json is a
  deliberate deviation, documented on the /bun/live page.)
- `Bun.markdown.ansi(md, { heading/strong/… })` options remain IGNORED
  (§22) — the doc's themed-markdown renderer callback pattern still does
  not exist; terminal theming injects ANSI codes manually via theme.ts.
- Folded in: src/institutions/live-channel.ts (FeedStore dedup by link with
  epoch-sorted recent(), theme/feed payloads, WS handlers, hourly cron),
  serve.ts /api/live upgrade + websocket config, /bun/live widget page,
  tests/institutions/live-channel.test.ts (real WS roundtrip + invalid
  change-theme rejection), release-blog.ts imageUrl extraction.

## 24. Content hashing probed (2026-08-24) — Bun.sha, CryptoHasher, ETags

- `Bun.sha` is NOT a general-purpose hash: it is SHA-512/256. Probe:
  `Bun.sha("abc", "hex")` === `sha512-256("abc")` vector
  (53048e2681941ef99b2e29b76b4c7dabe4c2d0c634fc6d46e0e2f13107e7af23),
  and the DEFAULT return is a Uint8Array (not a string). Use it only when
  you want SHA-512/256; for content fingerprints the repo uses
  CryptoHasher("sha256") (src/lib/content-pipeline.ts).
- `Bun.sha(data, "hex"|"base64"|"utf8")` accepted; "arraybuffer" throws
  (unknown encoding).
- `Bun.CryptoHasher` verified against known vectors: sha1/sha256/sha384/
  sha512/blake2b256/md5/blake2b512/sha512-256/sha3-256 ALL match.
  `digest("hex"|"base64")` -> string; `digest()` (no arg) -> Buffer;
  "arraybuffer" throws. update() accepts string or Uint8Array.
- The doc's "pass Uint8Array instead of string for best performance"
  measured NO material difference: 34.7ms vs 33.9ms over 100 x 1MB sha256
  (this machine). Labeled marketing on the /bun/hashing page.
- Bun.file verified: exists()/text()/bytes() (Uint8Array)/stat() with size
  + mtime (Date). ETag/304 pattern already in-repo (notModified helper in
  serve.ts, used by /brand routes) — reused for the content pipeline.
- Folded in: src/lib/content-pipeline.ts (hashContent/etagFor/
  parseFrontmatter zero-dep/ingestContentItem), content/posts/*.md samples,
  /content/posts routes (index + raw .md + rendered page, all ETag/304 via
  notModified), /bun/hashing widget page, tests/lib/content-pipeline.test.ts
  (known vectors + frontmatter + raw-content hashing), design:check surface.

## 25. Content pruning probed (2026-08-24) — archive vs delete, .trash/

- The doc's implied Bun-native rename does NOT exist: `Bun.rename` is
  undefined in 1.4.0 (probe TypeError). Use node:fs `renameSync`.
- `ensureDirectory(...)` in the doc is NOT a Bun or node API — the real
  call is `mkdirSync(path, { recursive: true })` (probe-verified: creates
  parent dirs for the .trash/<date>/<dir> destination).
- `renameSync` on a missing file throws ENOENT — check `existsSync` first
  (applyPrune returns null instead of throwing).
- Metadata sidecar write/read roundtrip verified: Bun.write(
  dest + ".meta.json") + Bun.file().text() + JSON.parse. Sidecar carries
  originalPath/archivedAt/reason/size/hash/action/performedBy.
- Sidecar hashes reuse hashContent (CryptoHasher sha256, §24) — the prune
  metadata is content-addressed with the same kernel as the pipeline.
- Codified decision matrix (src/lib/prune-content.ts planPrune):
  unreferenced+duplicate/stale -> delete; unreferenced+large/significant
  -> archive; referenced+large -> review; referenced -> keep. Pure and
  unit-tested (tests/lib/prune-content.test.ts).
- Folded in: src/lib/prune-content.ts, tools/prune-content-cli.ts
  (bun run content:prune --dry-run/--apply), .data/manifest.json
  (committed — content story), CONTENT_CHANGELOG.md (appended on apply),
  .trash/ gitignored (recovery outside the repo), /bun/pruning page,
  design:check surface.
- INTEGRATION with `bun prune` and the repo gates — two planes, one pattern:
  - `bun prune` (package plane): removes unused DEPENDENCIES from
    node_modules (real output: "Checked 14 packages across 2 folders
    (nothing to prune)"). Wired as deps:check (dedupe --check + prune
    --dry-run) on package.json/bun.lock/bunfig.toml in pre-commit.
  - `content:prune` (content plane): archives/deletes unused CONTENT FILES
    with .trash/ sidecars. Wired as content:check on content/ +
    .data/manifest.json + the prune source in pre-commit (CONDITIONAL_GATES).
  - Gate semantics match: deps:check is a dry-run (never mutates); the
    content gate is manifest INTEGRITY — every manifest reference must
    exist (a broken manifest silently defeats the decision matrix) — and
    the delete/archive candidates in the report are informational, not a
    failure. `content:prune -- --apply` is the explicit maintenance action,
    exactly like `bun prune` needs no flag but content moves only on apply.
  - Both gates fire only on their own paths (lockfile vs content tree), so
    unrelated commits stay fast; both are offline + sub-second.

## 26. Archive + prune-channel + dynamic content verified (2026-08-24)

### Bun.Archive — verified

`Bun.Archive.write(path, { "entry": value }, { compress: "gzip" })` writes a
real extractable tar.gz; `new Bun.Archive(bytes).extract(dir)` round-trips;
`archive.files()` returns a Map of entry -> Bun.File.

**Critical probe catch:** Archive.write with a Bun.file VALUE writes a
structurally valid tar with EMPTY payloads (header blocks present, 0-byte
entries). Only string / Uint8Array / Blob values round-trip — the prune
archive helper reads bytes first (`new Blob([bytes])`). The doc's example
used string literals, which is why it worked there.

### The prune channel

The `prune` CHANNEL (8th signal channel) reports content-plane state:
manifest integrity (missing references = bad — the decision matrix needs
real files) + .trash/ footprint (files/bytes/archives). Mirror of the deps
channel for CONTENT (§25). Dashboard renders it via CHANNEL_LABELS.

### Dynamic content — verified

| Tool | Behavior |
| --- | --- |
| `content:verify` | re-hashes every manifest-referenced file vs .data/content-state.json; mismatch = stale ETags/feeds, exit 1; --update re-baselines (edit -> DRIFT, restore -> ok) |
| `content:watch` | `bun --watch tools/content-verify.ts -- --update` — dynamic rebuild on change |
| `content:prune -- --archive` | bundles removed files into ONE .trash/<date>/prune-<date>.tar.gz (Bun.Archive, gzip) + per-file sidecars |

### FFI — noted, not adopted

`Bun.FFI` (dlopen) is available and would avoid Bun.spawn, but the repo's
gates stay spawn-based (runBunGate keep-list) — FFI adds a native surface
for no gain here.

## 27. Deepen pass: markdown render, FFI, restore (2026-08-24)

- Bun.markdown surface: html / ansi / render / react. `render` is PLAIN
  TEXT (probe: strips all markup — "HelloSome bold…"), `html` is the real
  renderer (probe: <h1>, <ul><li>, <blockquote>, <pre><code
  class="language-ts">). Post pages (/content/posts/<slug>) now render
  bodies via Bun.markdown.html — previously escaped <pre>. Raw body is
  trusted (our own content); escape when rendering untrusted markdown.
- Bun.FFI: the `Bun.ffi` NAMESPACE does not exist (undefined in 1.4.0) —
  the module is `bun:ffi` (dlopen, CString, FFIType, ptr, CFunction,
  JSCallback…). Verified: dlopen("libSystem.B.dylib") getpid/getuid/getgid
  return real values; dlopen("libz.dylib") zlibVersion -> "1.2.12" via
  CString. `bun run ffi:probe` exercises it. NOT adopted in gates: FFI adds
  a native surface (platform .dylib names/ABI) for zero gain over the spawn
  keep-list — it IS the escape hatch if a spawn-free path is ever required.
- content:prune -- --restore=<path>: recovers a pruned file from .trash
  using its sidecar (originalPath match), renames it back, removes the
  sidecar. Manifest is NOT auto-rewritten — re-add the path if it should be
  active again. Verified round-trip in tests.

## 28. Bun 1.4 security hardening probed (2026-08-24) — release-blog security section

- fetch() + tls.checkServerIdentity VERIFIED: the callback receives
  (hostname, cert) and runs before the request is written; returning an
  Error rejects fetch with that error (`Error: pin mismatch` probe) and
  nothing is sent. Returning undefined proceeds. PROBE CATCH: passing
  rejectUnauthorized:false alongside checkServerIdentity means the
  identity callback NEVER runs (identity check disabled) — use
  tls:{ ca, checkServerIdentity } instead, where ca pins the trust and the
  callback still fires.
- ca alone does NOT bypass hostname verification: fetch to 127.0.0.1 with
  a CN=localhost cert and only tls:{ca} -> ERR_TLS_CERT_ALTNAME_INVALID.
- tls.connect({host}) uses host as default servername VERIFIED (matches
  Node + blog): by hostname, servername=host sent; by IP without
  servername, connected but authorized=false; with default verification,
  IP vs CN=localhost -> ERR_TLS_CERT_ALTNAME_INVALID.
- Bun.connect({tls}) default rejectUnauthorized:true VERIFIED: untrusted
  handshake opens with socket.authorized=false, no data delivered; pass
  ca or rejectUnauthorized:false. NODE_TLS_REJECT_UNAUTHORIZED honored
  (not exercised — repo never disables verification; host-discover has the
  documented probe-only exception).
- HTTP framing hardening VERIFIED via raw TCP: Content-Length:abc,
  CL+TE together (smuggling), CL:-1, duplicate CL, and invalid chunk size
  all -> 400 Bad Request. PROBE CATCH: the 400 only fires when the
  handler READS the body (req.text()/json()) — Bun parses framing lazily;
  a handler that ignores the body gets 200 for an invalid chunk.
- Redis rediss:// + tarball extraction hardening: documented (v1.3.14 /
  v1.3.6), NOT probed (no redis server / crafted tarball in-repo) —
  marked note on /bun/security.
- Folded in: /bun/security widget page (verified/note badges), bun run
  security:probe CLI (self-signed cert + local TLS server + framing raw
  TCP — 10 probes, exit 1 on any failure), design:check surface, tests.

## 29. Faster / build / test / install claims probed (2026-08-24)

- new URL() absolute 1.4 measurements: 52 ns/op (absolute),
  73 ns/op (relative), 2 ns/op (href) on THIS machine. The blog's 75/168/5
  ns figures and the 4.6x / 3.1x / 3.2x RATIOS were NOT independently
  string, relative resolve works, punycode works (münchen.de ->
  xn--mnchen-3ya.de).
- reactCompiler: TRUE AND FUNCTIONAL: Bun.build({ reactCompiler: true })
  compiles and injects react/compiler-runtime imports (the memoization
  runtime) — the probe failed ONLY because react isn't installed (missing
  react/compiler-runtime). --react-compiler CLI flag exists. The 19-20x
  speedup-vs-Babel claim is NOT reproducible in-repo (no React codebase) —
  labeled marketing.
- optimizeImports: accepted (typed option + runtime), but on pure-ESM
  barrels the DEFAULT tree-shaker already drops unused exports — no
  observable difference. The optimization targets side-effectful packages
  (no sideEffects:false); not reproducible with pure ESM fixtures (note).
- jsx option must be an OBJECT ({ runtime, factory }) — a bare string
  throws TypeError (probe).
- bun test flags all present: --parallel=<N> (defaults CPU count, implies
  --isolate, --parallel-delay default 5ms), --shard, --timings +
  --update-timings (balances + slowest-first), --changed=<branch> — repo
  already uses most (§20).
- bun install: vendor benchmarks (T3 app) are marketing; the no-op path
  IS real and fast (probe: "Checked 1 package (no changes) [1.00ms]").
- what-s-new builtin list (sharp/puppeteer/marked/node-cron/node-pty/
  concurrently/npm-run-all/serve-static/json5/fast-xml-parser) maps to the
  repo's builtin replacements (Bun.Image/WebView/markdown/cron/spawn/dir
  routes/JSON5/XML) — see /bun/overview.
- Folded in: /bun/speed widget page (verified/marketing/note badges),
  design:check surface, widget tests.

## 30. Full sub-header mapping — every anchor's sub-headers to the repo (2026-08-24)

- The five anchors (#faster #bun-build #bun-test #bun-install #what-s-new)
  contain ~45 sub-headers beyond the top-level claims; the /bun/map page
  maps EACH to a repo file/script + integration layer (channels / branding
  / pipeline / data).
- #faster sub-headers: new URL (probed §29), faster-regexp (design scanner
  hex regexes — probe: 4.84ms over 200k×20), node-zlib-uses-zlib-ng (PNG
  encoder Bun.deflateSync — probe: 0.21ms vs node:zlib 0.25ms per 1MB),
  Buffer.from hex/base64url (no direct consumer — kernel does manual hex),
  source-map decoding (dev-mode sourcemaps, automatic), promises (runtime
  wide, automatic).
- #bun-build sub-headers: react-compiler + barrel (parked, §29),
  compile-time-feature-flags (bun:bundle is NOT a runtime module — the
  real surface is --define; probe: FEATURE_FLAG->enabled), in-memory-files
  (plugin virtual modules VERIFIED), single-file-html (not used),
  metafile-true + metafile-md (YES — the mtafile pipeline: dist/*.meta.json
  + *.meta.md feed design budgets/channels), decorators/asset/bytecode
  (not used), code-splitting-20k (marketing).
- #bun-test sub-headers: all seven (parallel/isolate/shard/timings/changed/
  retry/faketimers) map to package.json scripts + pre-commit (retry 1).
- #bun-install sub-headers: global-virtual-store (bunfig linker=isolated),
  pm-diff/audit-fix/dedupe/prune/licenses (deps:* scripts + deps channel),
  update-transitive (frozen, note), add-filter/catalog/overrides/trustedDeps
  /nativeDeps (not mapped — 3-dep repo), lockfile-integrity (no git/tarball
  deps — file: only).
- #what-s-new sub-headers: bun-image/webview/markdown/cron (brand + content
  + signal channels), bun-terminal (exists, PTY-only — probe: Failed to
  open PTY under capture; repo uses ANSI paint not PTY), bun-run-parallel
  (not used), 3x-faster-ffi (ffi:probe §27), dev-tooling/http3/http2/range/
  sourcemaps/compression/proxy/TLS-resumption/reuse (serve.ts + §15/§17),
  also-built-in (the sharp/puppeteer/marked list -> file-by-file).
- Integration layers recap: channels = design/deps/brand/releases/ops/
  inventory/cron/prune signals; branding = TOKENS + design-system bundle
  (one-vocabulary audit); pipeline = content (hash/frontmatter/ETag) +
  build (metafiles/budgets) + prune (.trash/archive/restore); data =
  massey/event-store/registry + fetch compression/reuse.

## 31. Blog → repo mapping TRACKER (2026-08-24) — automatic, contract-gated

- The mapping is now a TRACKER, not a static page: .data/blog-map.json
  (registry, 55 entries across all 5 anchors) + bun:blog-map CLI + a
  "mapping" signal channel + a daily Bun.cron + a pre-commit contract gate.
- Core (src/lib/blog-map.ts, pure + unit-tested): extractAnchors parses the
  blog HTML into h2/h3 headers; diffBlogMap compares the sub-headers under
  the tracked anchors (#faster #bun-build #bun-test #bun-install
  #what-s-new) against the registry. Output: newUnmapped (blog added a
  sub-header we haven't mapped — CONTRACT VIOLATION), missing (registry
  entry gone from the blog — cleanup), coverage.
- CLI (tools/bun-blog-map.ts -> src/lib/blog-map-run.ts shared with the
  cron): fetches the blog (or --offline from research/cache/bun-blog.html),
  writes .data/blog-map-state.json + research/outputs/blog-map.md, exits 1
  when a sub-header is unmapped. Currently 100% coverage, EXIT 0.
- mapping channel: reads the STATE file (offline — the dashboard never
  fetches the blog per request): coverage %, unmapped/missing counts,
  staleness (> 30 days warn). Added to the channel union + CHANNEL_LABELS
  + the signal-pipeline coverage test.
- Daily cron: registerBlogMapCron('0 3 * * *', ...) — once per process,
  unref'd, re-runs the tracker so the state stays fresh without manual
  runs (serve.ts wires it to runBlogMap).
- Contract gate: pre-commit fires bun:blog-map on .data/blog-map.json +
  tracker source changes. A new blog sub-header without a registry entry
  fails the commit until someone maps it (add a row to .data/blog-map.json).
- To map a new sub-header: add { anchor, subId, title, mappedTo, layer,
  status } to .data/blog-map.json (subId is the blog's id= slug). The map
  page (/bun/map) is still hand-maintained for display; the registry is
  the machine-checked contract.

## 32. Native markdown automation — heading ids, GFM, child tracking (2026-08-24)

- Bun.markdown.html VERIFIED: full GFM — tables (<table><thead>), task
  lists (<li class="task-list-item"><input type="checkbox" checked>),
  strikethrough (<del>), code fences with language classes.
- BUT: Bun.markdown emits NO heading ids/anchors, and NO option enables
  them — headerIds / gfm / headerLinks / slugify are all IGNORED (probe:
  output identical). The blog's id="faster" anchors come from its own
  HTML/MDX, not from Bun.markdown.
- HTMLRewriter is NOT available in this Bun build (undefined — Cloudflare
  surface). So the heading/anchor layer is ours: render with
  Bun.markdown.html, then walk the output (src/lib/markdown-headings.ts).
- markdownHeadings(): renderer-driven heading tree — levels, GitHub-style
  fragment slugs (lowercase, dashes, strip punctuation; duplicates get
  -1/-2 suffixes — probe: "Duplicate Heading" -> duplicate-heading-1),
  and parentIndex (child tracking: h3 under h2 under h1). headingTree()
  builds the nested TOC structure.
- Folded in: content pipeline exposes renderMarkdownToc(); post pages
  (/content/posts/<slug>) now render a Contents section with fragment
  links. Tests: tests/lib/markdown-headings.test.ts.
- Tracker boundary (honest): the BLOG's anchors are hand-written HTML ids
  — extractAnchors regex stays (Bun.markdown can't produce them). For OUR
  OWN markdown (content/posts), the ids are now renderer-derived and
  fragment-unique via markdownHeadings — the mapping slug source for our
  content, vs the blog's ids for the blog.

## 33. Bun.markdown documented API surface — CORRECTION (2026-08-24)

- SUPERSEDES parts of §22 and §32: those probed WRONG option names and the
  WRONG function for callbacks. The documented surface is REAL and verified:
- `Bun.markdown.html(md, { headings: { ids: true } })` emits
  `<h1 id="faster">` — GitHub-style slugs, byte-identical to the hand-rolled
  slugger ("$x^2$" -> "x2", duplicates get -1/-2). `headings: true` also
  works. (My §32 probe passed `headerIds`/`headerLinks`/`slugify` — none are
  real option names; they were silently ignored.)
- GFM on by default: tables, strikethrough, task lists (verified).
  Opt-ins VERIFIED: autolinks (bare URLs -> <a>), wikiLinks, underline
  (__x__ -> <u>), latexMath ($...$), permissiveAtxHeaders (#not-a-heading),
  noIndentedCodeBlocks (indented -> <p>), collapseWhitespace, hardSoftBreaks.
- `Bun.markdown.render(md, callbacks, options?)` — EVERY callback verified:
  heading({level,id}), paragraph, blockquote, code({language}), list,
  listItem({index,ordered,depth,checked} — the task item reported
  checked:true), table/thead/tbody/tr/th/td({align}), html, strong, emphasis,
  link({href,title}), image({src,title}), codespan, strikethrough, text.
  Returning null drops the element; omitting a callback passes children
  through (that's why a bare render(md) call looked like stripped text — it
  is the DEFAULT pass-through, not a bug).
- `Bun.markdown.react(md, overrides?, { reactVersion: 18 })` returns real
  React elements ($$typeof verified).
- Folded in: markdownHeadings now uses NATIVE ids (headings:{ids:true}) —
  same slugs, less code; markdownPlaintext uses the render-callback pattern
  (strip formatting, keep structure); tests updated.

## 34. Bun.markdown FULL API matrix (2026-08-24) — systematic, no more gaps

- Every documented html() option, render() callback + meta, and react()
  behavior was probed in one matrix (15/16 → 9/16 after probe-bug fixes;
  the final matrix below is the authoritative record). /bun/markdown shows
  it; this section is the same data.
- html() VERIFIED: headings:{ids:true} (native <h1 id=…> slugs, dupes
  -1/-2), headings:true, autolinks:true AND {url,www} (both link),
  wikiLinks:true (emits <x-wikilink data-target="…"> — NOT <a>),
  noHtmlSpans (escapes), noHtmlBlocks (blocks -> paragraph text),
  permissiveAtxHeaders, noIndentedCodeBlocks. GFM tables/tasklists/
  strikethrough ON by default.
- html() CORRECTED (docs claim, 1.4.0 runtime NO-OP — accepted silently,
  output unchanged): underline (__x__ stays <strong>), latexMath ($x$
  stays literal), collapseWhitespace, hardSoftBreaks (newline stays
  space), tagFilter (<b> not filtered). Marked corrected on the page.
- render() callbacks ALL verified with meta: heading{level,id}, code
  {language}, list{ordered,start,depth} (ordered start=1, nested depth
  0/1/2), listItem{index,ordered,start,depth,checked} (task item
  checked:true), th/td{align} (undefined w/o alignment), link{href,
  title?}, image{src,title?}, strong/emphasis/codespan/strikethrough/
  text (children only), paragraph/blockquote/hr/table/thead/tbody/tr/
  html (block). null return drops element; omitted callback = pass-through.
- react(md, overrides?, {reactVersion:18}) VERIFIED real elements
  ($$typeof). Tag-override map exists; element shape not rendered without
  React in-repo.
- WRAPPER REMOVAL (the goal): markdownHeadings no longer regexes rendered
  HTML or hand-slugs — it captures the tree through render() heading
  callbacks + native ids (headings:{ids:true}); headingSlug is kept only
  for callers slugging arbitrary strings (e.g. the blog registry).
  markdownPlaintext is render-callback driven (GFM tables/tasks flatten
  natively). renderMarkdownToc builds from the callback tree. All six
  wrapper tests still green — same output, native implementation.

## 35. Bun.markdown — release version + React target (verified, not guessed) (2026-08-24)

- WHEN: Bun.markdown shipped in Bun 1.3.8 — verified from Bun's own release
  blog (bun.com/blog/bun-v1.3.8): "Bun.markdown is a builtin CommonMark-
  compliant Markdown parser written in Zig." The 1.4.0 what's-new label
  ("bun-markdown v 1.3.8 v 1.4.0") means introduced 1.3.8, enhanced 1.4.0
  (options/callbacks added). LANGUAGE: Zig (release blog) — the docs page
  says Rust; release notes are authoritative here.
- REACT TARGET: verified from React's own source (facebook/react
  packages/shared/ReactSymbols.js): REACT_ELEMENT_TYPE = renameElementSymbol
  ? Symbol.for('react.transitional.element') : REACT_LEGACY_ELEMENT_TYPE.
  - Bun.markdown.react() DEFAULT emits Symbol.for('react.transitional.element')
    — the React 19+ element type (renameElementSymbol true; present in
    v19.0.0+ tags, absent in v18.3.1 — checked the tags).
  - { reactVersion: 18 } emits Symbol.for('react.element') — the legacy
    React 18 type. Runtime probe: $$typeof flips exactly between the two.
  - So: React 19+ by default, React 18 via reactVersion: 18. NOT "19.1"
    specifically (that was an unsourced guess — the accurate statement is
    React 19.x; the transitional symbol exists in 19.0+).

## 36. Poor-grounding audit — claims corrected to their real evidence level (2026-08-24)

- autolinks DEFAULT: settled — OFF by default in 1.4.0 (bare URL -> no <a>
  without { autolinks: true } or { url: true }). An earlier probe showing
  autolink:Y for default was WRONG (it matched an existing [link](...) <a>
  in that fixture). GFM tables/tasklists ARE on by default (re-verified).
- Bun.markdown LANGUAGE: RESOLVED in §56 — Bun WAS Zig; 1.4 is the first
  Rust release. bun.com/docs says Rust (current); the 1.3.8 blog said Zig
  (historically true, pre-rewrite). See §56 for the resolution.

- faster-regexp: the blog's isbot/marked numbers (200x/138x) were NOT
  reproduced — only a hex-regex micro-bench (4.84ms/200k×20) was run.
  Registry row corrected to note.
- source-map-decoding / promises: marked "verified/automatic" without any
  probe — corrected to note (runtime-wide, no in-repo measurement).
- react() version: earlier "19.1 specifically" was unsourced — corrected to
  React 19.x (transitional symbol exists in v19.0.0+, absent v18.3.1 —
  checked the tags). See §35.
- Lesson: the map/registry must distinguish VERIFIED (probed here) from
  NOTE (documented claim, not measured here). The /bun/map page + registry
  now carry that distinction; 3 rows downgraded verified -> note.

## 37. Deeper grounding audit — the full claim surface re-checked (2026-08-24)

- Beyond §36's three, the ENTIRE registry + widget pages were re-audited for
  claims marked verified that outrun their evidence:
  - node-zlib-uses-zlib-ng: deflateSync SPEED was measured, but the zlib-ng
    IMPLEMENTATION claim was not — downgraded to note.
  - 3x-faster-bun-ffi: dlopen/getpid/zlibVersion calls verified (ffi:probe),
    the 3x speedup NOT measured — downgraded to note.
  - html-routes-sourcemaps-disabled-in-production: serve.ts has the flag,
    the runtime sourcemap behavior was never probed — downgraded to note.
  - new-url-is-up-to-4-6-faster: the 1.4 ABSOLUTE numbers (52/73/2 ns) are
    measured on this machine; the 1.3 baseline and the 4.6x/3.1x/3.2x RATIOS
    were never reproduced (no 1.3/Node26 same-hardware benchmark) — page +
    §29 reframed from "faster than claimed" to absolute-only.
  - overview-page builtin row: "present in 1.4.0" now qualified (Terminal /
    FFI / HTTP3 verified present, not for every claim).
  - color/hashing pages re-checked: their verified rows ARE probe-backed
    (parity tests, FORCE_COLOR probes, hash vectors) — no change.
- Status discipline now enforced: verified = probed IN THIS REPO;
  note = documented claim not measured here; marketing = vendor claim.
  Registry + /bun/map + /bun/speed + /bun/overview all carry the corrected
  levels; the blog-map contract still passes at 100% coverage (coverage
  counts mapping presence, not verification depth).

## 38. Repo docs managed by Bun.markdown (2026-08-24)

- The repo's OWN docs (docs/*.md, 48 files) are now managed by the same
  native markdown stack as content/posts — not raw heredoc appends:
  - docs:check (tools/docs-check.ts + src/lib/docs-audit.ts) verifies every
    doc renders through Bun.markdown.html AND has unique native heading ids
    (markdownHeadings). Probe: AGENT-PITFALLS.md (2353 lines) renders with
    78 headings, all slugs unique. 48/48 pass.
  - /docs serves the docs through the content pipeline: index table + per-
    doc page with native TOC + content-addressed ETag (sha256 of the raw
    file) + If-None-Match 304 (verified live: conditional -> 304).
  - docs channel (11th): reports render health + staleness from
    .data/docs-state.json (offline — the dashboard never renders docs).
  - pre-commit gate: docs:check fires on docs/*.md + the audit tooling — a
    doc that stops rendering or gains a duplicate heading slug fails the
    commit (same contract shape as bun:blog-map).
- Why this matters: the docs ARE markdown; they were the one place NOT
  running through the verified Bun.markdown path (no render check, no TOC,
  no hash/ETag). Now the renderer we probed owns the docs too.

## 39. Dev tooling / HTTP3 / static / conditional / compression probed (2026-08-24)

- Flags VERIFIED: --cpu-prof/--cpu-prof-md (+name/dir/interval),
  --heap-prof/--heap-prof-md, --no-orphans, --no-env-file (all present in
  --help). bun ./README.md renders markdown to terminal (probe: "Test Doc"
  rendered, exit 0). BUN_CPU_PROFILE documented for flag-less processes.
- http3:true VERIFIED: TLS server with http3:true responds 200 AND
  advertises Alt-Svc: h3=":port"; ma=86400 (probe) — browsers upgrade on
  their own. Docs: zero-RTT resumption disabled, server.upgrade() false
  over H3, unix: sockets skip H3. fetch(protocol:http2) VERIFIED: 200 to
  bun.sh. The 2.7x HTTP/3 benchmark is marketing (not reproduced).
- Static dir routes: sendfile + Content-Type + WEAK ETag (W/"a-…") +
  Last-Modified + 304 + Range/206 all auto (probe; repo /videos/* uses it).
- Conditional requests on dir/Bun.file bodies VERIFIED: If-None-Match ->
  304; If-Match with a weak etag -> 412 (weak tags never strong-match,
  RFC 7232); If-Match: "*" -> 200; If-Unmodified-Since past -> 412.
  PROBE CATCH: a bare Response(Bun.file(...)) does NOT auto-etag — the
  conditional machinery belongs to the DIR-ROUTE/static mechanism, not a
  plain Response body. (The blog's example conflates the two.)
- fetch compress VERIFIED: string form + object form { encoding: "gzip",
  level: 6 } both work — 5000B -> 55B with Content-Encoding: gzip (§17
  resilient-fetch uses the string form).
- Proxy {url,headers} object shape + TLS session resumption (BoringSSL
  32-entry LRU) + HTTPS-proxy reuse: documented, NOT probed (no proxy /
  internal) — note on the map.
- Terminal utils: Bun.stringWidth (ANSI-aware, "hi"=2), sliceAnsi,
  wrapAnsi all present. ML-DSA-44 keygen verified in crypto.subtle
  (post-quantum). Response.textStream() returns a real ReadableStream.
- Registry rows updated: http-3 / http-2-3 / serve-files / range-and-
  conditional / fetch-compression -> verified with probe details;
  html-routes-sourcemaps stays note (flag present, runtime not probed).
- TOOLING DISCIPLINE (§39 addendum): file/dir edits use Bun NATIVE paths only —
  Bun.file().json()/text() + Bun.write for JSON/text edits, Bun.$ tagged-
  template shell for commands, node:fs renameSync/mkdirSync for moves. NO
  python: it crept in as an inline -e quoting workaround and has no place in
  a Bun-native repo (scratch scripts were ephemeral; nothing shipped depends
  on it). When inline quoting fights you, write a proper tools/*.ts script
  (the repo pattern) instead of reaching for a foreign interpreter.

## 40. Automation pass — better Bun usage (2026-08-24)

- PNG crc32 is now NATIVE: hand-rolled JS crc32 replaced with bun:ffi

  libz.crc32 (probe: 1.2ms vs 1295ms per 50x1MB, identical output

  ef0e6054). JS impl kept as guarded fallback. visuals.ts is server/tool-

  only (never in the browser bundle) so dlopen is safe. Strict-decoder

  PNG round-trip re-verified (64x64 png via Bun.Image.metadata).

- security-probe openssl now uses Bun.$ tagged-template shell (was

  node:child_process spawnSync) — all 10 probes still pass.

- verify:contracts (tools/verify-contracts.ts): runs ALL offline contract

  gates in PARALLEL via Bun.spawn (deps:check, docs:check, content:check,

  bun:blog-map --offline, colors:check, design:check) — 6/6 ok. Wired

  into bun run check (was missing docs/content/blog-map/colors from the

  full CI gate; they were pre-commit-conditional only).

- Policy: child_process/execSync stays banned (audit-bun-native keep-

  list); use Bun.$ / Bun.spawn / Bun.spawnSync per context.


## 41. Deeper automation — consolidate + native conversions (2026-08-24)

- Shared runBunCommand (src/lib/run-bun.ts): the Bun.which('bun') +

  Bun.spawn shape was duplicated 8+ times; now one source. runBunGate

  (signal-pipeline) delegates to it; verify:contracts uses it. Returns

  {ok, exitCode, stdout, stderr, lastLine}.

- Recursive readdirSync walks -> native: signal-pipeline trash scan and

  prune-content scanDirectory now use listFiles (src/lib/glob.ts, the

  repo's Bun.Glob wrapper) with onlyFiles — no manual isDirectory()

  recursion, no raw Bun.Glob in new code.

- toml-config JSON.parse(JSON.stringify()) deep clone -> structuredClone

  (native).

- Policy (from §17/§40): node:child_process banned; Bun.$ / Bun.spawn /

  Bun.spawnSync per context; raw Bun.Glob -> listFiles wrapper; deep clone

  -> structuredClone. New code follows all three.


## 42. Bun.which() probed (2026-08-24) — the which-replacement, with PATH semantics

- Bun.which(bin) VERIFIED: returns the path ("ls" -> /bin/ls), null for

  missing. Options object = { PATH?, cwd? } (typed WhichOptions).

- KEY SEMANTIC (probe): { PATH } REPLACES the env PATH entirely, it is NOT

  additive — PATH: "/custom" finds mybin but makes "ls" -> null; you must

  include system dirs yourself (PATH: dir + ":/bin:/usr/bin"). The docs'

  "overrides the PATH env var" wording undersells the replacement.

- cwd resolves RELATIVE PATH entries (PATH: "./sub" against cwd finds the

  bin) but does NOT add cwd to the search by itself (cwd-only -> null).

- Folded in: runBunCommand (src/lib/run-bun.ts) accepts a path option

  (Bun.which with { PATH, cwd } when provided) so sandboxed gates can run

  with a restricted search path. Tests: tests/lib/bun-which.test.ts

  (system resolve, null, PATH-replacement, cwd-relative, runBun path).


## 43. Bun utils probed — deepEquals, escapeHTML, randomUUIDv7, version (2026-08-24)

- Full utils surface probed (docs/runtime/utils): version/revision,
  deepEquals, escapeHTML, randomUUIDv7, nanoseconds, sleep/sleepSync, peek,
  stringWidth/stripANSI/wrapAnsi, inspect, main, readableStreamTo*,
  zstdCompress(Sync)/zstdDecompress(Sync), gzipSync/gunzipSync/inflateSync/
  deflateSync, fileURLToPath/pathToFileURL, resolveSync, openInEditor — all
  present and working in 1.4.0 (29-item probe).
- Bun.deepEquals VERIFIED as lodash-isEqual replacement: typed arrays, Sets,
  Maps, Dates, NaN all compare correctly; key order irrelevant; array order
  matters. Already wrapped (bun-native deepEqual) + used in inspect-utils.
- Bun.escapeHTML VERIFIED: escapes &<>" PLUS ' (-> &#x27;) — strictly safer
  than the hand-rolled esc() copies (which skipped '). 5 server-side
  hand-rolled esc() helpers consolidated to Bun.escapeHTML (signal-pipeline,
  hq-ui, tennis-ws-dashboard, match-liquidity-dashboard, live-tracker-chart).
  The dashboard's injected client JS escH stays hand-rolled — it runs in the
  BROWSER where Bun.escapeHTML doesn't exist (documented, intentional).
- randomUUIDv7 already used (csrf, hq-view idempotency, lib/ids).
  version/revision already gated (assertBunAtLeast + Bun.semver).
- gunzipSync/gunzipSync return Uint8Array (not string) — decode with
  TextDecoder when text is expected (probe nuance).

## 44. Utils page re-probed — the missed items + Options section (2026-08-24)

- First pass (§43) missed nested/sub-utils + the Options section. Full
  inventory now: version, revision, env, main, sleep/sleepSync, which,
  randomUUIDv7, peek, openInEditor, deepEquals, escapeHTML, stringWidth,
  fileURLToPath, pathToFileURL, gzipSync/gunzipSync/deflateSync/inflateSync,
  zstdCompress(+Sync)/zstdDecompress(+Sync), inspect, inspect.custom,
  inspect.table, nanoseconds, readableStreamTo*, resolveSync, stripANSI,
  wrapAnsi, generateHeapSnapshot, plus serialize/deserialize +
  estimateShallowMemoryUsageOf in bun:jsc.
- NEW VERIFIED: Bun.wrapAnsi(input, columns, { hard, wordWrap, trim,
  ambiguousIsNarrow }) — options work (trim:false preserves whitespace,
  probe). Bun.inspect.table(data, [props], { colors: true }) — box-drawing
  string, property filtering, ANSI colors as 2nd-arg options (3rd-arg form
  NOT honored — probe). inspect.custom = Symbol(nodejs.util.inspect.custom)
  (the NODE symbol). peek.status -> "fulfilled"/"pending". generateHeapSnapshot()
  returns a V8-shaped OBJECT ({version:3, type:"Inspector", nodes, edges, ...}),
  not a string/path. fileURLToPath("file:///C:/x") -> "/C:/x" on macOS (no
  Windows drive-letter handling off-Windows). resolveSync takes 2 args
  (moduleId, parent) — the 3rd "esm" option is NOT part of the type.
- Bun.inspect.table is the native alternative to the repo's hand-rolled
  box-drawing renderTable (regulatory/admin.ts) + itf-calendar/summary/
  cross-market padEnd tables — VERIFIED available, but those builders are
  format-specific (colored borders, custom separators, positional rows);
  swapping changes output, so they stay as-is unless output parity is
  wanted. Documented as the native option, not force-rewritten.

## 45. Hand-rolled vs native — the honest test (2026-08-24)

- §44 claimed the hand-rolled box tables "stay because swapping changes
  output" — that was UNTESTED laziness, same class as earlier overreach.
  Re-probed and flipped:
- Bun.inspect.table IS ANSI-aware: colored cells (c.dim("$500")) align by
  VISIBLE width inside the box (probe: stringWidth-aware padding). The
  alignment concern was false.
- regulatory/admin.ts renderTable (internal, not test-asserted, headers +
  string[][] rows) CONVERTED to Bun.inspect.table(objects, { colors: true })
  — rows mapped to objects from headers. 109 regulatory tests pass; CLI
  output verified with real DB rows (box-drawing, bold headers, ANSI cells
  aligned).
- The padEnd plain-text tables (itf-calendar-format, summary,
  cross-market) STAY hand-rolled for a REAL reason, now verified: they emit
  plain aligned text (machine-readable-ish, no box), not box-drawing —
  a different output format, not a capability gap.
- Rule: never default to "keep hand-rolled" on an untested assumption.
  Either convert and verify, or name the concrete format contract that
  differs (as above). §44's "stays as-is" claim corrected here.

## 46. assets:check gate — content-hashed images via Bun.markdown hooks (2026-08-24)

- Extended the docs:check/content:check model to IMAGES referenced from
  markdown. Reference extraction probe-verified: the Bun.markdown.render
  image callback catches image-markdown refs (meta.src/title) but NOT
  embedded HTML <img src> — a regex over the raw text covers that case
  (both combined in src/lib/assets-audit.ts extractImageRefs).
- assets:check (tools/assets-check.ts): for every content/posts + docs
  markdown, resolve local image refs, verify existence, sha256 each, diff
  against .data/assets-state.json. Exit 1 on MISSING or DRIFT. --update
  re-baselines (same model as docs:check/content:verify).
- Verified live: content/posts/assets/brand-card.png referenced from
  hello-world.md -> 1 asset hashed ok; modifying the file -> FAIL DRIFT +
  exit 1; restore + --update -> ok. Remote URLs skipped (not locally
  hashable).
- Wired into verify:contracts (7 gates now: deps, docs, content, assets,
  blog-map, colors, design) + pre-commit (assets:check on content/docs +
  audit source). Tests: tests/lib/assets-audit.test.ts + pre-commit gate.

## 47. Bun.Transpiler probed (2026-08-24) — transform/scan + Import.kind

- Bun.Transpiler VERIFIED: transformSync(code, loader) for ts/js/tsx (jsx
  emits jsxDEV dev runtime), async transform(), scan() -> {exports,
  imports}, scanImports() -> Import[]. Options: define (process.env.NODE_ENV
  -> "production" probe), loader, target, tsconfig (jsx factory), macro,
  exports{eliminate,replace}, trimUnusedImports, jsxOptimizationInline,
  minifyWhitespace, inline.
- Import.kind values from the docs: import-statement, require-call,
  require-resolve, dynamic-import, import-rule, url-token, internal,
  entry-point-build, entry-point-run. PROBED: import-statement /
  require-call / require-resolve / dynamic-import all emitted by scan()
  (require-resolve ONLY in scan().imports, NOT scanImports() — a real
  behavioral difference the docs don't call out). import-rule/url-token are
  BUNDLER-only (CSS) — scanImports(css, "css") throws "Only JavaScript-like
  files"; the standalone transpiler never emits them.
- import type { T } from "x" THROWS only on a BARE transpiler (jsx
  default); with loader:"tsx" they are IGNORED (see §52 correction).
- Folded in: design-deadcode scanDeadImports now sources specifiers from
  Bun.Transpiler.scan().imports (native) and cross-checks the statement
  regex against that set; bindings still manual (Bun doesn't expose them —
  the file header documents this). Tests pass.

## 48. Transpiler deeper — options + parse oracle (2026-08-24)

- Deeper option probes (all VERIFIED): trimUnusedImports (drops unused
  import), minifyWhitespace (const a=1;const b=2;), inline (CONSTANT
  FOLDING: X * 2 -> 10), exports.eliminate/replace (removes + renames
  exports), macro (accepted), tsconfig: { compilerOptions: { jsx:
  "react-jsx" } } WORKS (emits jsx_w77yafs4) — the earlier probe used the
  wrong shape (top-level jsx, not compilerOptions.jsx).
- CORRECTION (revised §59): target:"bun" DOES change transpiler output —
  it emits `var {require}=import.meta;` (the Bun CJS-interop preamble) vs
  node/browser which keep plain import/require. My earlier "no difference"
  was because I only tested node vs browser, never "bun". target:"bun"
  is meaningful in the transpiler; node vs browser still show no diff.
- scan() has NO loader arg (type: scan(code) only) and defaults to jsx —
  it CHOKES on TS type annotations (function f(value: string) -> Parse
  error). transformSync(code, "ts") is the TS-capable parse oracle.
- Folded in: design-browser-safety checkFileBrowserSafety now runs a parse
  oracle first (transformSync(code, "ts") try/catch) — an unparseable file
  is reported as a violation (can't be safely analyzed) before the Bun-ref
  scan. 6 tests pass incl. the new unparseable-file case.

## 49. Transpiler constructor loader (2026-08-24) — the anchor's option

- new Bun.Transpiler({ loader: "tsx" }) VERIFIED: the constructor loader
  makes transformSync work WITHOUT the 2nd arg (all 4 loaders js/jsx/ts/tsx
  verified; explicit arg overrides the ctor).
- KEY FIX: the ctor loader ALSO fixes scan() for TS — new Bun.Transpiler({
  loader: "ts" }).scan("function f(x: string)…") parses, while a BARE
  scan() defaults to jsx and throws Parse error on TS annotations.
- This replaced the §48 workaround (transformSync(code, "ts") as the parse
  oracle) with the lighter loader'd scan() — no emit. Both the
  browser-safety parse oracle and the deadcode specifier scanner now use
  new Bun.Transpiler({ loader: "ts" }).scan().

## 50. Transpiler full options surface — the last unprobed ones (2026-08-24)

- Full TranspilerOptions from bun-types: define, loader, target, tsconfig,
  macro, autoImportJSX, allowBunRuntime, exports{eliminate,replace},
  treeShaking, trimUnusedImports, jsxOptimizationInline, minifyWhitespace,
  deadCodeElimination, inline, logLevel, replMode.
- NEW VERIFIED: treeShaking (drops unused import), replMode (wraps object
  literal in IIFE + {__proto__:null, value:...} — exactly as documented),
  autoImportJSX (auto-imports react/jsx-dev-runtime). deadCodeElimination:
  NO observable difference on a dead-const sample (transpiler DCE is
  conservative; both default and false kept the dead code — noted, not a
  strong signal).
- MACRO FULLY VERIFIED: a real macro file replaced graphql("query…") with
  the macro's return and REMOVED the import. PROBE CATCH: the docs' example
  uses a TEMPLATE LITERAL (graphql`…`) which THROWS "template literal
  macro invocations are not supported" in 1.4.0 — the function-call form
  works.
- tests/lib/transpiler-probe.test.ts locks the loader/scan + new cases.

## 51. Import.kind — separated + highlighted reference + CSS correction (2026-08-24)

- The docs' Import.kind list (import-statement, require-call,
  require-resolve, dynamic-import, import-rule, url-token, internal,
  entry-point-build, entry-point-run) is now a SEPARATED + HIGHLIGHTED
  table on /bun/transpiler (each kind its own row with example + probe
  status), not prose.
- PROBE CORRECTION: import-rule (@import 'foo.css') and url-token
  (url('./foo.png')) are CSS kinds — Bun.Transpiler CANNOT scan CSS in
  1.4.0 (every path throws: "only JavaScript-like loaders" for loader:"css"
  scan/transform, "Expected identifier" for bare scan, "Only JavaScript-
  like files" for scanImports(css,"css")). They are bundler-only kinds;
  listed as corrected on the page.
- require-resolve: only in scan().imports, dropped by scanImports (§47) —
  highlighted as corrected.
- The other 6 JS kinds verified via scan()/scanImports() probes (§47).

## 52. Type-only imports/exports CORRECTION (2026-08-24) — the docs were right

- §47 claimed "import type { T } from 'm' THROWS in scan()" — that is only
  true for a BARE Bun.Transpiler() (jsx default loader, no TS support).
- With the DOCUMENTED usage — new Bun.Transpiler({ loader: "tsx" }) —
  .scan() IGNORES type-only imports AND exports exactly as the docs say:
  probe matched the docs' example byte-for-byte (exports:["name"], imports:
  [import-statement:react, dynamic-import:./loader]; import type {ReactNode}
  and export type Foo both absent). §47's throw finding is corrected here.
- Lesson: probe with the DOCUMENTED loader configuration, not the bare
  default. The bare-transpiler throw is a loader gap, not the API behavior.

## 53. Transpiler deeper — accuracy, options, imports:graph (2026-08-24)

- docs' TSX example reproduces BYTE-FOR-BYTE (jsxDEV_7x81h0kn 6-arg form).
- scan() ACCURACY verified (native parser, not regex): fake imports in
  comments/strings/templates are NOT listed; export * from / export {x}
  from ARE imports; import.meta is NOT; type-mixed (import {type A, B})
  lists the module (only PURE type-only ignored); conditional + semicolon-
  less caught.
- Options verified: exports.replace ALONE renames (pub -> private, other
  untouched); tsconfig as STRINGIFIED JSON works (jsx factory); logLevel
  accepted; jsxOptimizationInline no output change on a simple sample.
- allowBunRuntime: NO observable difference in the transpiler (matters in
  the bundler, like target). transform() async NOT faster for small files
  (3.2ms vs 0.8ms per 200x) — the docs' own "threadpool overhead often
  costs more; use transformSync" guidance is measurement-verified.
- Folded in: imports:graph (tools/imports-graph.ts) — scans all src/*.ts
  via Bun.Transpiler.scan (loader:tsx, type-only ignored): 452 files,
  1273 imports (1152 internal/121 external), 3526 exports, and found 39
  REAL duplicate-specifier files (e.g. content-pipeline -> markdown-
  headings x2). --check exits 1 on duplicates. Tests: tests/lib/imports-
  graph.test.ts.

## 54. bun pm pkg + bun pm version — native package.json editing (2026-08-24)

- bun pm pkg VERIFIED: get (dot + bracket notation, e.g. scripts.build,
  contributors[0], scripts[test:watch]), set (multiple at once, --json for
  complex values), delete (multiple/nested), fix, get-whole.
- bun pm version VERIFIED: patch/minor/major (+pre*/from-git/specific
  versions per help) bumps package.json; --no-git-tag-version skips the
  git commit+tag (probed: 0.2.0 -> 0.2.1 with the flag, no tag; restored
  via bun pm pkg set version=0.2.0).
- POLICY: package.json edits use bun pm pkg set / bun pm version — NOT
  hand-written JSON.stringify/python (the session's early patch-pkg*.py
  scratch was cleaned; no committed tool writes package.json by hand —
  repo tools read it via deps-diff/deps-report/pre-commit).

## 55. Production / Observability / Streams probed (2026-08-24)

### Markdown profiler outputs — verified

| Tool | Output shape (matches docs) |
| --- | --- |
| `--cpu-prof-md` | Summary (Duration/Samples/Interval/Functions) · Top 10 · Hot Functions (self%) · Call Tree (total%) · Function Details (Called-by/Calls) |
| `--heap-prof-md` | header + Quick Search Commands · Summary (Total Heap/Objects/Edges/Unique Types/GC Roots) · Top 50 Types by Retained Size — full edge data makes it large (233 KB, small run) |
| `--metafile-md` | our `dist/*.meta.md` (the mtafile) matches the docs byte-for-byte: TOC, Quick Summary, Largest Modules, Entry Points, Dependency Chains, Full Graph |

### Streams + memory — verified

| Claim | Probe |
| --- | --- |
| CompressionStream/DecompressionStream/TextDecoderStream/TextEncoderStream native | all present; gzip roundtrip 60000 -> 312 -> equal |
| Response.clone() chunk-shared | both bodies read (`a`/`b` clones both return full body) |
| memoryPressure | listener surface verified (on/removeListener + event name); serve.ts handler uses the documented levels |

### Probe catch — BUN_CPU_PROFILE

`BUN_CPU_PROFILE=1` **alone produces NO profile** in 1.4.0 (ran with the
env, no .cpuprofile). It only works when `--cpu-prof` is ALSO passed —
defeating the docs' "process you cannot pass flags to" purpose.
`--cpu-prof-name` requires `--cpu-prof` (errors alone). Use
`--cpu-prof`/`--cpu-prof-md` directly.

### Vendor benchmarks — marketing (not reproduced)

Claude CPU 2x, memory 13-48%, startup 2x, binary -17%, stream throughput,
backpressure OOM repro — all need the exact app/hardware (EPYC 9R14,
`/usr/bin/time -v`, median of 3). Local sanity only: streams work, a
slow-client read keeps the server alive at small scale (the 1 GiB/s
OOM-pause claim needs the #32553 repro).

## 56. "We rewrote Bun in Rust" — verified + resolves the §35 contradiction (2026-08-24)

### The claim

Bun 1.4 is the FIRST release written in Rust. The dedicated post
(`bun.com/blog/bun-in-rust`) meta-description states: *"Why & how we
rewrote Bun from Zig to Rust"*. Claude Code used the port for months;
Prisma Compute launched on it (see §57).

### §35 resolved

The earlier "unresolved contradiction" (docs said Rust, 1.3.8 blog said
Zig) is resolved: **both were true at different times**.

| Claim | Truth |
| --- | --- |
| 1.3.8 "markdown written in Zig" | historically accurate — pre-rewrite |
| docs "written in Rust" | current — post-rewrite |

### Runtime verification

| Evidence | Result |
| --- | --- |
| binary size | 63,558,256 bytes = 61.2 MB macOS arm64 — EXACTLY the blog table value |
| binary format | Mach-O arm64, links libc++ (Rust + JSC C++ ABI) |
| symbols | no Rust markers via nm (release stripping) — size + post meta are the evidence |

### Not runtime-verifiable

- Stats section (64 Claudes, 58 commits/min, 11 days): process
  storytelling, marked note.
- Faster section "8 months of WebKit" + zlib-ng + SIMD: consistent with
  the rewrite but vendor benchmarks (§29/§55 discipline: absolute
  measurements only).

## 57. Context + fetch defaults — two corrections (2026-08-24)

### Missed context — the Prisma URL

The v1.4 Rust section links a second URL I skipped:
`prisma.io/blog/bun-rust-rewrite-prisma-compute`. It is a production
adoption report, not marketing:

| What | Detail |
| --- | --- |
| Bun 1.3 failures | memory leaks; connection pool could not recover after VM pause/resume |
| Rust rewrite | handled both failure modes perfectly |
| Proven fixes | bounded memory · dead-connection reconnection · pause/resume · fail-loud requests |
| Adoption | Prisma Compute beta + Claude Code ran the port for months before 1.4 shipped |

Takeaway: the rewrite's value was **reliability under long-lived load**, not
just speed.

### Missed context — the built-in list

The section's "built into Bun 1.4 ✓" list adds five entries to what's-new:

| New built-in | Replaces | Probed at |
| --- | --- | --- |
| `tar` | npm `tar` | §26 (Bun.Archive) |
| `string-width` | npm `string-width` | §43 |
| `slice-ansi` | npm `slice-ansi` | §43 |
| `cli-truncate` | npm `cli-truncate` | §43 (sliceAnsi) |
| `wrap-ansi` | npm `wrap-ansi` | §43/§44 |

### Fetch defaults — the correction

**Problem:** the probe scripts used bare `fetch()` — no timeout (hangs on a
non-routable host), no retry, no User-Agent.

**Reality:** the repo's `fetchWithRetry` (resilient-fetch.ts) already had good
defaults — `timeoutMs` 30s, `AbortSignal.timeout`, AbortError treated as
retryable, backoff/jitter/breaker. The probes bypassed it.

**Fix:** `src/lib/probe-fetch.ts` wraps `fetchWithRetry` with probe-safe
defaults:

| Default | Value |
| --- | --- |
| timeout | 8s |
| retries | 2 |
| User-Agent | kalshi-bot-research/0.2.0 (probe) |
| redirect | follow |
| failure | null (probe reports unreachable, never throws) |

Verified: non-routable host -> null in 1.6s (previously: hang forever);
bun.sh -> 200. Probes now use `probeFetch`, not bare `fetch`.

## 58. "grep -c bullet count" proposal — probed + rejected for the smart gate (2026-08-24)

- A pasted proposal suggested a bullet-check via Bun.$ + grep -c '^[-*]'
  with glob.scan + import { glob } from "bun". PROBED, three API errors:
  1. import { glob } from "bun" does NOT exist (undefined) — it is
     new Bun.Glob().
  2. glob.scan() is SYNC-iterable (Symbol.iterator), not async —
     for await (const f of glob.scan(...)) fails. scanAsync() does not
     exist in this build.
  3. .nothrow() DOES exist (verified: exit 1 handled without throw).
- More importantly, grep -c '^[-*]' counts EVERY bullet line — a doc with
  100 short list items across 20 sections fails; a 6-bullet prose wall
  passes. That is the "dumb count" the smart gate replaces.
- The smart gate (src/lib/docs-style.ts + docs:check) detects PROSE WALLS:
  >= 6 flat bullets, NO ### subsections, NO tables, AND at least one bullet
  >= 200 chars (a real prose paragraph). This caught + fixed real walls in
  AGENT-PITFALLS §26, DATA_MODEL §4, KIMI §2, SPORTS_SOURCE invariants,
  while PROTONPASS "Security notes" (7 short bullets, max 160, factual
  checklist) passes as list-appropriate.
- docs:check now enforces 48/48 docs render cleanly AND no prose walls.

## 59. Docs code-block validation via Bun.Transpiler (2026-08-24)

- A proposal suggested validating doc code blocks with transpiler options.
  PROBED, three corrections:
- target:"bun" IS meaningful (revised §48): it emits `var {require}=
  import.meta;` (Bun CJS-interop preamble) vs node/browser which keep
  plain import/require. My earlier "no difference" tested node vs
  browser only — wrong. "bun" is the right validation target.
- define does NOT "catch typos": a typo'd env key (API_URLL vs defined
  API_URL) is silently left as-is — exact-match only. define is for
  making env-dependent examples parse, not typo detection.
- trimUnusedImports IS a stale-import detector: compare import sets
  before/after trim — imports removed were unused.
- Built src/lib/docs-validate.ts: extract fenced JS-family blocks (untagged
  blocks skipped — they're diagrams/pseudo, not code), validate via
  transformSync with the language loader + target:"bun" + define, and
  report unused imports.
- Result across 48 docs: 46 tagged JS blocks, 7 reported (all intentional
  pseudo-code: … elision, top-level await snippets, pseudo-classes) — ZERO
  genuine syntax bugs found. Wired into docs:check as REPORTED (playground-
  backlog pattern), never fails the gate.

## 60. Language-specific docs code-block validation — bash continuation join (2026-08-24)

- Extended the §59 validator per-language (validateBlockByLanguage +
  validateDocsCodeLanguage in src/lib/docs-validate.ts):
  - JS-family: Bun.Transpiler (as §59).
  - json/json5/toml/yaml/xml: Bun's native parsers — good parses return,
    bad parses throw (probe-verified: Bun.JSON5/TOML/YAML/XML.parse all
    throw on malformed input, parse valid input).
  - bash/sh: `bash -n -c` (exit 0 good / 2 bad, probe).
- bash -n false-positive hunt: doc blocks are command EXAMPLES, and
  examples use three things real scripts don't:
  1. `\` line continuations — my first cut checked line-by-line and
     flagged the dangling continuation (PROTONPASS-INTEGRATION-SPEC).
  2. multi-line quoted strings — `bun -e "..."` / `bun -e '...'` spanning
     lines (BUN_UPGRADE_CANARY, PROTONPASS): the first line has an
     unbalanced open quote and bash -n rightly rejects it.
  3. angle-bracket placeholder notation — --experiment=<id>, --diff
     <run-id>, --sport=<sport_key> (EXPERIMENT_FACTORIAL, PLAN,
     SPORTS_SOURCE_REGISTRY): bash reads < as a redirection, so these
     are invalid shell BY DESIGN.
- Fix: reassemble logical lines before bash -n — join `\` continuations
  (outside quotes), join while quote depth is open (single/double,
  backslash-escaped inside quotes), and SKIP lines carrying <placeholder>
  notation. Result: 18 reported bash false-positives → 0; only the 7
  intentional JS pseudo-code blocks remain (report-only).
- Bun.YAML (1.2) in the validator is intentional and now allowlisted in
  src/lib/breaking-audit.ts (YAML_ALLOWLIST): doc examples are validated
  with the SAME parser the runtime uses, so a 1.1-style yes/on/no key in
  a doc block is exactly what should surface.
- Tests: tests/lib/docs-validate.test.ts covers continuation join,
  multi-line quotes, placeholder skip, comment-only blocks, and a genuine
  syntax error (bash -n still catches real bugs).

## 61. Bundler plugins doc — namespaces + runtime claims probed (2026-08-24)

- Probed bun.com/docs/bundler/plugins (§namespaces anchor) against Bun
  1.4.0. FIVE corrections, all reproduced in tools/plugins-probe.ts (10/10
  checks, now a verify:contracts gate) + tests/lib/plugins-probe.test.ts.
- VERIFIED:
  - `import { plugin } from "bun"` — the named export EXISTS and IS the
    same function as Bun.plugin (identity === true).
  - default namespace is "file": onResolve({filter, namespace:"file"})
    sees relative imports; a plugin CAN intercept a `file:` specifier
    and redirect it to a real path.
  - the env-plugin pattern (onResolve → namespace + onLoad → contents)
    works in Bun.build — virtual modules build fine.
  - onStart async callbacks are awaited before onLoad; onEnd async
    callbacks are awaited before Bun.build resolves, and onEnd receives
    BuildOutput with success=false + logs when a build fails.
  - defer() is once-only: the second call THROWS.
  - Bun.build THROWS AggregateError ("Bundle failed") on unresolvable
    imports — it does NOT return success:false for a bad entry graph
    (onEnd still fires with success=false).
- CORRECTED (doc claims WRONG on 1.4.0):
  1. Namespace chars are RESTRICTED: `namespace: "yaml:"` THROWS
     `TypeError: namespace can only contain $a-zA-Z0-9_\-`. The doc's
     flagship example (loader with namespace "yaml:" transforming
     ./myfile.yaml into yaml:./myfile.yaml) is invalid — colons are not
     allowed in namespace strings.
  2. `import m from "file:./dep"` does NOT resolve — Bun.build throws
     (doc: "the same as ./dep"). The file: prefix is internal-only; a
     plugin onResolve is required to make a file: specifier resolve.
  3. onStart CAN mutate build.config — the doc Note says it cannot, but
     an outdir mutation in onStart silently redirected the output.
  4. node:/bun: modules do NOT carry "node"/"bun" namespaces — node:fs
     resolves with namespace "file" and onResolve({namespace:"node"})
     never fires. Also, bun:sqlite / bun:test imports THROW under
     Bun.build's default target; bun:sqlite builds with target:"bun"
     (reinforces the §48/§59 "bun" target finding).
  5. Runtime plugins: onResolve/onLoad do NOT fire for runtime imports
     in 1.4.0 — a catch-all runtime onResolve saw FIRED=0 even for a
     relative ./dep import. The runtime virtual-module mechanism is
     `build.module(specifier, cb)` (returns {exports, loader:"object"}),
     which works inline, via bunfig top-level `preload = ["plugin.ts"]`,
     or `bun --preload`. The `[runtime] plugins` bunfig key does NOT
     load in 1.4.0 (correct key is `preload`).
- Artifacts: src/research/plugins-page.ts (/bun/plugins widget),
  tools/plugins-probe.ts (bun run plugins:probe),
  tests/lib/plugins-probe.test.ts, verify:contracts gate.
- Typed registry: src/lib/plugin-namespaces.ts — ONE source of truth for
  the charset rule (PLUGIN_NAMESPACE_CHARSET = [a-zA-Z0-9_$-], the exact
  runtime error text), the branded PluginNamespace type (as/try/parse
  constructors), KNOWN_PLUGIN_NAMESPACES (file/env/yaml/virt/stats — the
  doc's "node"/"bun" deliberately ABSENT, probe proved ns file),
  INVALID_PLUGIN_NAMESPACES (yaml:/file:/empty/spaces — UPPER_CASE is
  VALID, charset includes A-Z). Wired into tools/plugins-probe.ts (P2b:
  registry charset must agree with the runtime, 5/5 rejected + 5/5
  accepted), tests/lib/plugins-probe.test.ts (registry unit tests),
  and the /bun/plugins page (registry section rendered from the module).
- Deepen pass (§61a, 2026-08-24) — closing the loop, probe-grounded:
  - REGISTRY DRIVES THE PROBE (not just checked): tools/plugins-probe.ts P2
    is now a bidirectional lock — every KNOWN namespace must BUILD at
    runtime, every INVALID must THROW (compile-time via branded values +
    runtime via real Bun.build). P2b registry charset agreement; P2c
    empty-string special case. 12/12 checks.
  - NEW CORRECTION the lock caught: namespace:"" is NOT invalid — the
    runtime treats it as NO CONSTRAINT (fires for file-ns modules; same as
    omitting the field). The registry's asPluginNamespace still rejects it
    (a NAMED namespace must be charset-valid) — use undefined/omit, never
    the empty string. Removed "" from INVALID_PLUGIN_NAMESPACES, added
    EMPTY_PLUGIN_NAMESPACE_NOTE + P2c probe.
  - bun-types 1.4.0 declares PluginConstraints.namespace?: string — UNTYPED
    (no charset in the .d.ts), so a "maps-lock 4th lock" extracting valid
    namespaces from bun-types is a NON-STARTER: there is nothing to
    extract. Worse, the bun-types doc comment REPEATS the wrong doc claim
    ("bun:ffi has the namespace bun") — the runtime error is the only
    authority, which the registry encodes.
  - REJECTED plan items (probe discipline): runtime integration into
    production plugin code (ZERO Bun.plugin/onLoad/onResolve call sites in
    src/ — nothing to enforce at; the probe IS the only runtime consumer);
    a regex lint gate over all string literals (false-positive machine on
    "file"/"env"/"node" everywhere; zero plugin call sites to lint — the
    compile-time branded values in the probe are the real lint); --fix
    auto-rewrite (dangerous, no surface). Adopted: example field per known
    namespace, rendered as a third column on /bun/plugins.

## 62. docs:api — validate every Bun.<token> in docs against the runtime (2026-08-24)

- New gate `bun run docs:api` (tools/docs-api-validate.ts, 9th verify:contracts
  gate): scans docs/*.md + src/research/*-page.ts for `Bun.<token>` mentions,
  probes each with `typeof Bun[t]` IN-PROCESS (no spawn loop), caches results
  in .data/api-cache.json keyed by Bun.version, and FAILS only on UNALLOWED
  missing tokens. 91 tokens scanned on 1.4.0.
- IMMEDIATE VALUE — three genuine doc bugs caught and fixed on first run:
  - pruning-page claimed `Bun.watch` re-verify — NO such API (typeof
    undefined); content:watch is `bun --watch tools/content-verify.ts`
    (CLI flag). Page fixed to say exactly that.
  - BUN_UPGRADE_CANARY listed `Bun.zstd` — undefined; the real APIs are
    Bun.zstdCompressSync / Bun.zstdDecompressSync. Fixed.
  - AGENT-PITFALLS §12 heading said `Bun.image` — the API is Bun.Image
    (capital class); lowercase is undefined. Heading fixed.
- Classification (probe-classified, in-tool allowlists):
  - INTENTIONAL — docs document a NON-existent API on purpose (Bun.ffi,
    Bun.html invented claim, Bun.SourceMap, Bun.term, Bun.rename, Bun.S,
    Bun.X).
  - TYPE_ONLY — bun-types type namespaces, not runtime values (Bun.Serve
    .Options, Bun.WebSocketOptions, Bun.File type).
  - PROSE — section titles / fragments (Bun.Networking blog name).
  - WILDCARD — `Bun.readableStreamTo*()` family notation: verified the
    family has 7 real members instead of failing the prefix.
- Probe discipline notes: typeof-in-one-process keeps the gate ~50ms (no
  per-token spawn); the version-keyed cache makes re-runs fully offline;
  UPPER_CASE tokens like Bun.S / Bun.X are real prose placeholders, NOT
  namespaces (don't conflate with the plugin-namespace charset §61).
- Tests: tests/lib/docs-api.test.ts locks the load-bearing runtime facts
  (Bun.Image vs image, zstd family, no Bun.watch, ffi/html intentional).
- STRICT deepen (§62a, 2026-08-24):
  - STRICT=1 mode (now the verify:contracts gate variant) adds CALLABILITY
    checks: a call-site or `new`-site on a MISSING (undefined) API token is a FAIL. Noise-free today: all 10 prose
    call-looking tokens (Bun.JSON5/TOML/XML/YAML/markdown object
    namespaces, intentional X/html/image) classify into existing
    allowlists. Protects against FUTURE docs calling a phantom API.
  - REJECTED: param-count validation. Probed the surface first: 13/41
    call tokens are OVERLOADED in bun-types (file=7, hash=9, write=5,
    color=6) and docs abbreviate args (Bun.file(path), Bun.serve({...})).
    Regex param matching would flag overload mismatch + elided args — a
    false-positive machine. STRICT stops at callability, which is the
    noise-free boundary. Revisit only with a real TS AST parser.
  - .data/api-report.md: always written — existence classification table
    + STRICT callability findings, feed for the docs dashboard channel.
  - Gate wiring: tools/verify-contracts.ts passes STRICT=1 env to the
    docs:api gate via runBunCommand env (probe-verified §42 PATH note).

## 63. docs:integrity — internal links + import resolution gate (2026-08-24)

- New gate `bun run docs:integrity` (tools/docs-integrity.ts, 10th
  verify:contracts gate):
  - LINKS (GATE — objective): every markdown link resolved against the
    filesystem + heading slugs. Same-file anchors, cross-file files,
    cross-file anchors. Headings via src/lib/markdown-headings.ts (the
    SAME Bun.markdown render-callback machinery docs:check uses). Exit 1
    on any broken link.
  - IMPORTS (REPORTED — illustrative-prone): `from "spec"` in code lines
    resolved via Bun.resolve from the doc dir, then repo root, then a
    literal root join. Relative imports are written repo-root-relative
    in this repo's docs (./src/... and ../src/... BOTH mean <root>/src/,
    probe-verified). Metasyntactic placeholders (x, m, ./x.md, file:./dep)
    and illustrative examples are allowlisted, never failed — same class
    as the §59 pseudo-code blocks.
- IMMEDIATE VALUE — ten genuine doc bugs caught and fixed on first run:
  - 3 broken hrefs: links that wrote the href as `docs/NAME.md` while
    href resolved to <docs>/docs/... (files live in docs/ directly);
    fixed to (DATA_MODEL.md).
  - 3 missing src/ segments: `../db/client.ts` → `../src/db/client.ts`
    (BUN_NATIVE code example contradicted its own table which used the
    correct ../src/db/client.ts); same for ../institutions/hq-ui.ts and
    ../institutions/filter-catalog.ts.
  - 4 anchor mismatches: docs used GITHUB-style slugs (em-dash → --) but
    Bun's native ids DROP the em-dash (single hyphen). PLIVE-EZLIVE 3×
    (#quick-reference--action-thresholds → #quick-reference-action-
    thresholds) + BUN_TECH_STACK 1× (#bunmarkdown--native-markdown--
    html--ansi → #bunmarkdown-native-markdown-html-ansi). Clicking the
    old anchors found no element (dead scroll target).
- Anchor convention locked: Bun native ids (markdownHeadings slug) are
  authoritative for intra-doc navigation — NOT GitHub's -- convention.
  Tests lock this (tests/lib/docs-integrity.test.ts).
- Artifacts: tools/docs-integrity.ts, tests/lib/docs-integrity.test.ts,
  10/10 verify:contracts gates.

## 64. Output-assertion gate — REJECTED after grounding probe (2026-08-24)

- Proposal: docs-output-check — extract `// =>` / `// expected:` comments
  from code blocks, run the snippet, compare stdout to the claimed output.
  Strict gate on semantic (not just syntactic/runtime) correctness.
- GROUNDING PROBE (tools/probe-output-assertions.ts):
  - `// =>`, `// expected:`, `// ⇒` in all 48 docs + widget pages: ZERO.
  - console.log in docs: 14 total — inline-comment color examples (// red,
    // "#7dd3fc"), diagnostic probes (PRAGMA integrity_check), redaction
    samples. NONE are output assertions.
- DECISION: REJECT the gate. Zero surface to validate — a strict gate
  scanning nothing fails nothing, adds gate time, and would INCENTIVIZE
  adding // => comments to docs to feed it (wrong direction). The repo's
  existing layers already cover the adjacent risks: syntax (§59
  transpiler), runtime correctness (@run + §62 API existence), structure
  (§63 links).
- KEPT: tools/probe-output-assertions.ts as a REPORT-ONLY canary (bun run
  output:probe) — proves the zero-assertion state and flags the first
  // => if a future doc introduces one. NOT a verify:contracts gate.
- Revisit ONLY if the docs adopt the assertion pattern deliberately
  (e.g. a new API guide with runnable examples) — then build the gate
  on real signal.

## 65. Docs vs source alignment — src-ref gate (2026-08-24)

- Extends docs:integrity (tools/docs-integrity.ts) with a SRC-REFS section
  (gate): every `src/...`-rooted path reference in docs (prose, tables,
  code) must resolve against the source tree. 247 unique paths scanned;
  exit 1 on stale refs.
- Grounding probe classified 13 misses:
  - 2 GENUINE stale refs (fixed):
    - `src/partner/domain.ts` — moved to src/partner/execution/domain.ts
      in commit 89ef6a7 ("hard-cut naming shims"); AUTHORIZED_EXECUTION_
      REMAINING_WORK governance TODO still named the old path.
    - `src/research/meta-audit.ts` — no such file; the meta contract is
      src/research/player-profile-meta.ts (Enrichment Lock metaAudit lives
      in hq-view.ts). CHEBNET_GRAPH_DOMINANCE spec (proposed) named a
      stale filename twice.
  - NOT bugs (classified): src/... / src/tools / src/title / src/index.ts
    (prose artifacts), alpha-relative `cd <pkg> && bun src/run-watch.ts`
    (resolves inside the alpha package — files exist there), and
    src/lib/ansi-width.ts (AGENT-PITFALLS historical narrative: adopted,
    then deleted).
- Design: skips fenced-code lines with `cd <pkg> &&` (package-relative),
  keeps a PROSE_SRC_ARTIFACTS allowlist, gate-fails everything else.
- Artifacts: tools/docs-integrity.ts SRC-REFS section; 10/10 gates still
  green.

## 66. Exported-symbol alignment — docs import names vs source exports (2026-08-24)

- Extended docs:integrity IMPORTS section (report) with exported-symbol
  alignment: named imports `import { X } from "spec"` must exist in the
  resolved module's exports. Barrel re-exports (export { x } from,
  export * from, export * as ns from) are FOLLOWED transitively so a name
  exported through a barrel (src/domain/index.ts etc.) is valid.
- GROUNDING: 61 named imports in docs, 36 resolvable source targets,
  ZERO not-exported on 1.4.0 — the docs' import names match actual
  exports. Positive control verified the scanner catches genuinely-
  missing names (markdown.ts exports: markdownToHtml/markdownToAnsi
  present; a fabricated name WOULD be flagged).
- Classification: the `bun` builtin is skipped (its exports are Bun.*
  runtime properties — randomUUIDv7/peek/$ are real, verified by
  docs:api §62; not a source file to scan).
- REPORTED (not gate): clean today (0 mismatches), but catches FUTURE
  rename drift when a source export is renamed and a doc's import
  example goes stale.
- Artifacts: tools/docs-integrity.ts IMPORTS section; tests lock the
  markdown.ts export surface.

## 67. Deeper integration — docs quality surfaced on the dashboard (2026-08-24)

- The docs channel (signal-pipeline collectDocs) previously read ONLY
  .data/docs-state.json (render health §38). Now it reads the state files
  ALL four docs gates write, via a shared writer (src/lib/docs-state.ts):
  - docs-state.json     → docs:render (48 files render, §38)
  - api-state.json      → docs:api (94 tokens · N drift · STRICT flag, §62)
  - integrity-state.json → docs:integrity (166 links · N stale src, §63/65/66)
  - output-state.json   → output:probe (0 assertions canary, §64)
  Each gate fails → bad; missing state → warn; >30d stale → warn. The
  dashboard's docs section now reflects the FULL docs-quality surface,
  not just render health.
- Mechanics: src/lib/docs-state.ts writeDocsGateState(name, fields) writes
  {lastChecked, ok, fails, bunVersion, ...fields} to .data/. Each tool
  calls it before exit; collectDocs reads all four with one shared gate()
  helper (severity ok/bad by ok field, stale-warn >30d).
- Verified live: collectDocs emits 4 ok signals (render/api/integrity/
  output) from the real state files; `bun run check` stays EXIT=0.
- This closes the loop: the gates guard the docs at commit time
  (verify:contracts) AND surface their health at runtime (dashboard
  docs channel) — the same signal pipeline that powers the cron-refreshed
  /dashboard.

## 68. Bun.XML doc — probed, 33/33 verified, 11th gate (2026-08-24)

- Probed bun.com/docs/runtime/xml against Bun 1.4.0. ALL 33 checks pass
  (tools/xml-probe.ts, `bun run xml:probe`, new verify:contracts gate).
- VERIFIED core:
  - compact shape: one key per root; @attr/#text convention (no
    collision — XML names cannot start with @/#); repeated children ->
    arrays (one-or-many — read defensively [x ?? []].flat()); empty
    element -> empty string; ALL values strings (no number/bool/null
    coercion); #text concatenation drops whitespace-only runs between
    children (Hello <b>world</b>! -> text Hello ! + b: world).
  - tree shape (compact:false): {name, attributes, children} — both
    keys present even when empty; children in document order incl.
    comments {comment} + PIs {target, data}; disambiguate by key.
  - namespace prefixes verbatim (soap:Body); xmlns ordinary attribute;
    comments/PIs/declaration/DOCTYPE absent from compact.
- VERIFIED stringify: escapes & < > + &quot;/&#x9;/&#xA; in attribute
  values + CR anywhere; null -> empty element; undefined/function/symbol
  skipped; Date -> ISO; bad names / control chars / array-at-root /
  circular THROW; no prolog/DOCTYPE (concatenatable); pretty via
  space arg (2nd param reserved); parse(stringify(x)) === x.
- PROBE NUANCE (doc-correct, verified): `--` in a comment and `?>` in a
  PI throw ONLY for TREE-shape children nodes ({comment}/{target,data}).
  A compact-level `{ comment: "x" }` object is just an ELEMENT named
  comment — stringify emits <comment>x</comment> with no constraint.
- VERIFIED module imports: default + named import (root element is
  both), require(), dynamic import, `with { type: "xml" }` for non-.xml
  extensions; bundler inlines XML at build time (zero runtime cost).
- VERIFIED conformance: SyntaxError not-well-formed (XML Parse error:
  Expected closing tag), RangeError deep nesting, billion-laughs
  expansion fails ~3ms, internal DTD entities expanded + attribute
  defaults applied, undeclared entity (no DTD) is an error, NO XXE
  (external DTDs never fetched), string input IGNORES encoding decl
  (checked for syntax), bytes honor BOM/decl (UTF-8/16/ISO-8859-1,
  unknown throws).
- Artifacts: tools/xml-probe.ts, tests/lib/xml-probe.test.ts (10 tests),
  src/research/xml-page.ts (/bun/xml widget), verify:contracts 11/11.

## 69. Production-grade pipeline doc — grounded, one real gap closed (2026-08-24)

- A pasted 'production-grade pipeline' doc proposed CSV streaming parser,
  concurrency limiter, Bun.cron scheduling, circuit breaker, SQLite WAL,
  single-executable compile, logging, auth. GROUNDED against the repo:
  almost ALL of it already exists natively, and the doc's premise was
  factually off:
  - 'MasseyRatings CSV' is WRONG — the repo ingests Massey as HTML
    (extractRatingsTableFromHtml in src/institutions/massey/fetch.ts);
    the real CSV feed is tennis-data.co.uk (parse-tennis-data-csv.ts).
  - circuit breaker: already ships via @factorywager/proton-pass
    CircuitBreaker (src/protonpass/circuit.ts) — the doc's hand-rolled
    one is WORSE (no half-open timeout, resets on every success).
  - Bun.cron: 5+ files already use it (signal-pipeline, live-channel,
    scheduled, match-liquidity-pipeline).
  - WAL + SQLite tuning: massey/store.ts, open-db.ts, hq-store.ts all
    run PRAGMA journal_mode = WAL.
  - concurrency: runBunGate / signal pipeline already parallelize.
  - Bun.CSV: UNDEFINED in 1.4.0 (probe) — no native CSV, so a custom
    parser IS the native answer.
  - bun build --compile: absent, but the repo deploys as cron + serve,
    not a long-lived binary — no consumer.
- ONE REAL GAP CLOSED: the repo's CSV parser split by line FIRST, so a
  quoted field containing an embedded newline broke (probe: '\"x\ny\"'
  split into two lines). Added parseCsvAll (state machine over the whole
  text): quoted fields, escaped "" quotes, commas + embedded newlines
  inside quotes, CRLF, blank-line skip. parseTennisDataCsv now uses it
  (strict superset — real tennis-data shape regression-tested).
- REJECTED (duplicate/worse): the doc's CSVStreamParser class (would
  duplicate parseCsvAll with a chunked-IO API the repo doesn't need —
  the CSV files are read whole via Bun.file), its CircuitBreaker (worse
  than proton-pass), concurrency limiter (signal pipeline exists), and
  worker threads (I/O-dominated, §8 of the doc agrees it's unnecessary).
- Artifacts: parseCsvAll in parse-tennis-data-csv.ts, tests/lib/
  csv-parser.test.ts (7 tests), §69. Gate stays 11/11.

## 70. Bun.Image doc — probed 20/20, ONE geometry-ordering correction (2026-08-24)

- Probed bun.com/docs/runtime/image against Bun 1.4.0 (macOS arm64).
  20/20 checks pass (tools/image-probe.ts, `bun run image:probe`, new
  verify:contracts gate). Extends §12 (which verified metadata/resize/
  placeholder/backend basics).
- VERIFIED:
  - chainable pipeline: Bun.file(p).image().resize().webp().write()
    returns bytes written; terminals bytes/buffer/blob/toBase64/dataurl
    all verified (blob() sets output MIME).
  - fit: inside preserves aspect (2:1 src in 50x100 -> 50x25); fill
    stretches exactly. width/height are -1 before the first terminal,
    output dims after.
  - modulate chains; jpeg/png/webp encode; heic/avif encode work on this
    machine (macOS arm64 — the doc warns platform-dependent).
  - placeholder() returns a ThumbHash data: URL; Bun.Image.backend
    default system, set \"bun\" forces portable Highway; clipboard
    statics fromClipboard/hasClipboardImage/clipboardChangeCount exist.
- CORRECTED (doc claim WRONG on 1.4.0):
  - rotate/flip/flop AFTER resize() are NO-OPS. The doc shows
    img.resize(...).rotate(90) chaining as valid, but the geometry op is
    SILENTLY DROPPED when resize ran first. Verified on an asymmetric
    hand-built 2x1 PNG: resize(20,10).flip() is byte-identical to
    resize(20,10); resize(20,10).rotate(90) gives 20x10 (dims not
    swapped); rotate(90).resize(20,10) == resize(20,10).rotate(90).
    Rule: apply rotate/flip/flop BEFORE resize in the chain.
  - rotate(90) ALONE works (2x1 -> 1x2) — only the ordering after resize
    is broken. flip/flop alone also work (dims unchanged).
- Probe nuance: fit:inside on a 2:1 source in 50x100 gives 50x25 (my
  first expectation 50x100 was wrong — inside must fit BOTH dims).
- Artifacts: tools/image-probe.ts, tests/lib/image-probe.test.ts (8
  tests), src/research/image-page.ts (/bun/image widget), verify:
  contracts 12/12.
- Gotcha set + BuildArtifact.image()-absent pin (177 refactor): the
  Blob#image() pipeline gotchas (lazy terminals, -1 dims, content
  sniffing, maxPixels 2^28 boundary, format reuse, Response(img)) are
  consolidated and evidence-grounded in docs/BUN_BUILD_FINDINGS.md §5;
  BuildArtifact has NO .image() on 1.4.0 (image:probe P23).

## 71. Team-logo ingestion doc — rejected (no consumer), ONE error-code correction (2026-08-24)

- A pasted doc proposed extending the CSV pipeline to ingest team logo
  images via Bun.Image: a team_logos table (sport/team/logo_url/width/
  height/format/file_path/thumb_path), fetch -> metadata -> save ->
  thumbnail -> SQLite, plus /logos/:sport/:team HTTP routes.
- GROUNDED — REJECTED, no consumer:
  - The premise is false: 'MasseyRatings CSV includes a LogoUrl column'
    — Massey is ingested as HTML here (§69); the real CSV feed
    (tennis-data.co.uk) has no logo column.
  - No team_logos table, logo_url, or thumb_path anywhere in src/tools.
  - The repo's image work is BRAND ASSETS (brand-image.ts + /brand/
    swatch/ routes) — the same metadata+resize+serve pattern, applied to
    real assets. Building a parallel team_logos pipeline for phantom
    CSV logo URLs would duplicate it without a consumer.
  - The serving pattern (/logos routes returning Bun.file + metadata)
    already exists as /brand.svg + /brand/swatch/<token>.png.
- ONE REAL CORRECTION (probe-verified, added to image:probe P13):
  the doc's ERR_IMAGE_FORMAT_UNSUPPORTED fallback is INCOMPLETE. That
  code is ONLY for platform-unavailable formats (HEIC/AVIF on a machine
  without the codec). Bad INPUT uses different codes:
    - garbage/empty/SVG bytes -> ERR_IMAGE_UNKNOWN_FORMAT
    - truncated/corrupt data   -> ERR_IMAGE_DECODE_FAILED
    - platform-unavailable fmt -> ERR_IMAGE_FORMAT_UNSUPPORTED
  A robust fallback must branch on all three (image:probe now checks
  all three; tests lock them).
- Artifacts: tools/image-probe.ts P13 (3 new checks, 23/23), tests/lib/
  image-probe.test.ts (3 new tests, 11/11). Gate stays 12/12.

## 72. On-the-fly resize doc — pattern rejected (no consumer), resize signature CORRECTED (2026-08-24)

- A pasted doc proposed on-the-fly image resizing in Bun.serve:
  /logos/:sport/:team?w=&h= with a Map-based resize cache + placeholder
  endpoints. Builds on the §71-rejected team_logos premise.
- GROUNDED — pattern rejected (no consumer):
  - No team_logos table/routes (§71); the repo's image serving is
    PRE-GENERATED brand assets (/brand.svg, /brand/swatch/<token>.png)
    with ETag/304 + rate limiting — not dynamic resize.
  - brand-image.ts uses resize(w, h) with explicit dims — no height-only
    pattern exists to fix.
  - The on-the-fly endpoint, Map cache, and placeholder routes would be
    built for phantom logo data.
- CORRECTED (the doc's Sharp-assumption is WRONG on Bun 1.4.0):
  - The doc hedged: 'we'll assume resize(null, height) works (Sharp
    does)'. PROBED: resize(null, 60) THROWS TypeError: resize(width,
    height?, options?) — width is REQUIRED number, height optional.
  - resize(undefined, 60) also THROWS. resize(80, undefined) works
    (height omitted -> auto). resize(80) alone: 40x20 src -> 80x40
    (aspect preserved).
  - bun-types signature: 'resize(width: number, height?: number,
    options?): this — Omit height to keep the source aspect ratio.'
  - Height-only resize requires computing width from metadata:
    resize(Math.round(h * (srcWidth / srcHeight))).
- Artifacts: tools/image-probe.ts P14 (3 checks, 26/26), tests/lib/
  image-probe.test.ts (4 tests, 15/15). Gate stays 12/12.

## 73. Unified teams registry — the pattern, and how branding/API fits (2026-08-24)

- User asked: should team/logo metadata be a GENERATED unified registry
  that data sources map towards (vs the §71 per-source team_logos table)?
  YES — and the repo ALREADY does this for sources: sports:registry:bake
  generates public/registry/sports-sources.json (byte-stable, committed,
  sports:registry:check gates staleness) with sports -> sources ->
  adapters -> integrations; event-identity.ts unifies four event-id
  dialects to one canonical match_key. Team/competitor identity is the
  same family's third member.
- BUILT (schema v1-compatible, optional section):
  - SportsSourceRegistry.teams?: TeamRegistryEntry[] — unified canonical
    key (team:<sport>:<key>), sport, label, per-source id mappings
    (sourceIds: [{source, id}]), optional image metadata (logoUrl/width/
    height/format/placeholder).
  - SportsSourceRegistryArtifact.teams? — serialized by the same builder;
    ABSENT until a source ships teams, so schema stays v1 + fingerprint/
    tests/registry file unchanged (no breakage).
  - When a source provides team data, populate registry.teams, bake,
    commit — the byte-stable check enforces it.
  - Tests: optional-absent + serialize-unified-keys-with-image (2 new).
- HOW BRANDING + API WORK TODAY (the pattern a teams endpoint would
  follow — src/research/serve.ts / src/lib/brand-image.ts):
  - /brand/swatch/<token>.png: rateLimiter wrap -> validate token against
    DESIGN_TOKENS -> size clamp (?size=, max 64) -> brandMetrics counter
    -> ETag (\"swatch-<token>-<size>\") + notModified 304 -> brandSwatchPng
    (Bun.Image pipeline) -> Response with content-type/cache-control/etag/
    CORS. This is the repo template for image routes.
  - /brand.svg + /brand/badge.svg: token-built SVG (no user SVG), ETag by
    design version, param validation (tone allowlist), rate-limited.
  - brand-image.ts: brandSwatchPng (Bun.Image from solid color),
    transformImage (resize/rotate/re-encode chain), readImageMeta,
    convertImageFile — the reusable Bun.Image layer the teams image
    metadata would use when a source ships logos.
  - A future /teams/:sport/:team route would: look up the unified key in
    registry.teams -> serve file_path via Bun.file or on-the-fly resize
    (width REQUIRED per §72 — compute height from aspect) -> same
    rateLimit/ETag/304/CORS pattern. NOT built: no team data source yet.
- Rejected §71 (per-source team_logos SQLite) stays rejected; this is the
  unified alternative the user asked for.

## 74. Dashboard action buttons — dead-button gap found + fixed (2026-08-24)

- DEEPER probe of the signal-pipeline machinery surfaced a real gap: the
  dashboard renders an action BUTTON for every signal carrying an
  action field, but the POST /api/signals/actions/<name> handler only
  implemented purge-brand | deps-check | brand-card | release-check.
  Collectors pushed SIX unimplemented actions -> dead buttons returning
  404: blog-map, content-check, and the FOUR docs actions added in §67
  (docs:check / docs:api / docs:integrity / output:probe) — my own §67
  work created dead UI.
- FIXED: added handlers for all six — each runs the offline gate via
  Bun.spawn (Bun.which('bun'), same path as deps-check), reports
  {ok, action, out: last-2-lines}. Explicit per-name args: blog-map
  gets -- --offline, content-check gets -- --check, docs gates get none.
  Unknown-action 404 message updated to list all ten.
- CONTRACT TEST (tests/lib/dashboard-actions.test.ts): scans
  signal-pipeline.ts for pushed action values and serve.ts for
  implemented name === handlers; FAILS if any pushed action has no
  handler. Prevents future dead buttons (e.g. a new collector pushing
  an action without wiring the endpoint).
- Verified: the docs:integrity action spawn exits 0 and returns the gate
  summary line; serve.ts already in SPAWN_KEEP_LIST (release-check entry).
- Note: inventory's massey signal still pushes action 'deps-check' as a
  generic re-check placeholder (runs deps gates, not massey) — existing
  quirk, not dead (handler exists), left as-is.

## 75. Remaining-touchpoints doc — table WRONG (all already integrated) + /status endpoint (2026-08-24)

- A pasted 'remaining Bun 1.4 touchpoints' doc claimed a status table with
  six 'Not yet' items. GROUNDED — ALL SIX are already integrated (the
  table was written without checking this repo):
  - Bun.cron: signal-pipeline, live-channel, scheduled, match-liquidity-
    pipeline, tennis-lane-constants, live-page (6 files).
  - Bun.markdown: the content pipeline + all 48 docs + posts via
    Bun.markdown.html (§38); map/live/pruning/observability pages.
  - Bun.WebView: massey html/fetch (headless render fallback), §12
    screenshots.
  - --parallel: the test script is bun test --parallel already.
  - bun prune: deps:prune + deps:prune:prod + deps:check gate.
  - HTTP/3: probed + documented — Bun.serve({http3:true, tls}) verified
    to start (bun-v1.3.14-catalog rows 6-7); my probe confirmed TLS is
    required.
- TWO FABRICATED APIs in the doc example code (probe-verified):
  1. Bun.WebView.launch({headless}) DOES NOT EXIST (.launch undefined) —
     the whole puppeteer-style newPage/goto/screenshot block is invented;
     the real API is new Bun.WebView (repo uses it).
  2. Bun.markdown.render('# Hello **world**') returns PLAIN TEXT
     ('Hello world'), NOT HTML — render is the callback API (§38); HTML
     requires Bun.markdown.html. The doc claims render replaces marked/
     remark — wrong.
- Verified doc-correct: process.versions.node = 26.3.0, Bun.JSON5.parse
  unquoted+single-quote sample, bun run --parallel flag, Bun.Terminal/
  mmap/redis/randomUUIDv7 all exist.
- NEW: /status + /healthz liveness/readiness endpoint (user asked 'do we
  have a status api'). Aggregates the existing 30s signal cache: 200 when
  no bad signal, 503 when a gate failed. Body: {ok, status, bunVersion,
  uptimeMs, checkedAt, signals, channels:{ok,warn,bad,info}, failing[]}.
  Rate-limited + CORS like the rest. Tests: tests/lib/status-endpoint.
  test.ts (2 tests). This was the ONE genuinely-missing, consumer-grounded
  piece (external monitors need a boolean 200/5xx).
- LIVE-CHANNEL STATUS BROADCAST (§75 deep, 2026-08-24):
  - Added StatusPayload {type:'status-update', ok, status, signals,
    channels:{ok,warn,bad,info}, failing[]} + LiveChannel.broadcastStatus()
    in src/institutions/live-channel.ts. WS clients now subscribe to a
    'status' topic (open/close handlers subscribe/unsubscribe alongside
    theme/feed).
  - serve.ts: shared buildStatusPayload(signals) helper (used by BOTH
    /status endpoint and the cron broadcast — one shape, no drift);
    refreshSignalsCache now calls liveChannel.broadcastStatus() after
    each Bun.cron refresh, so health CHANGES push live to connected
    clients. Initial state comes from GET /status (the cron fires every
    SIGNAL_CRON_EXPR, so the first broadcast lands on the first refresh).
  - Same verified mechanism as feed-update/theme-update (server.publish/
    ws.subscribe, header-verified). Tests: tests/lib/live-status.test.ts
    (payload shape + degraded failing-list).
  - This closes the loop: /status (pull) + status-update WS (push) +
    dashboard (render) all share the same aggregated health.

## 76. Infrastructure machinery probe — rate limiter + memoryPressure (2026-08-24)

- Probed the remaining untouched machinery (tools/infra-probe.ts, `bun
  run infra:probe`, new verify:contracts gate, 13/13):
- RATE LIMITER (src/regulatory/middleware/rate-limit.ts) — token bucket:
  - burst of max succeeds then 429; X-RateLimit-Limit/Remaining/Reset
    headers on every response.
  - a FULL window fully refills; a PARTIAL window refills proportionally
    (500ms of 1000ms window, max 10 -> floor(0.5*10)=5 tokens back -> 5
    requests succeed then 429).
  - per-key isolation: different X-Forwarded-For / X-Real-IP get
    separate buckets (1.1.1.1 max 1 -> 200,429; 2.2.2.2 -> 200).
  - skipSuccessful semantics CORRECTED (not a code bug — a doc/name
    mismatch): true does NOT let successful requests bypass an exhausted
    bucket. consume() blocks (429) BEFORE next() runs, so the refund
    never executes for blocked requests. The option only prevents
    successes from DEPLETING the bucket (refund-on-success keeps it
    full). Failure-isolating behavior is arguably intended; documented,
    left as-is.
- MEMORYPRESSURE EVENT (serve.ts hot-reload guard):
  - process.on('memoryPressure') — absent from eventNames() until a
    listener is registered; removeListener removes it. The hot-reload
    guard (removeListener before re-adding on globalThis) is sound.
  - Actual OS-level 'critical' firing not reliably reproducible in a
    probe (OS-dependent); the handler is simple cache-clears.
- Artifacts: tools/infra-probe.ts (7 checks), tests/lib/infra-probe.test.
  ts (6 tests), verify:contracts 13/13.

## 77. CSRF machinery probe — session binding verified, 14th gate (2026-08-24)

- Probed src/research/csrf.ts (tools/csrf-probe.ts, `bun run csrf:probe`,
  new verify:contracts gate, 14/14). The security-critical machinery
  guarding the dashboard action POSTs (§74) + trading endpoints:
- VERIFIED (9/9):
  - Bun.CSRF.generate/verify exist; generate(undefined, opts) THROWS
    'Secret is required' — the module's documented claim, probe-confirmed.
  - SESSION BINDING (the critical anti-replay property): a token minted
    for session A FAILS to verify when the request cookie carries session
    B — an attacker cannot replay their own token in a forged request.
    This is exactly the Bun docs requirement the module documents.
  - missing token OR missing cookie -> reject; csrfGuard returns 403 JSON
    before any handler runs.
  - existing kalshi_session cookie preserves the sessionId (no churn on
    every GET /ops).
  - secret pinning: KALSHI_CSRF_SECRET works — a token under secret A
    fails under secret B (tokens survive restarts only with the env pin).
- PROBE NUANCE (Bun error message misleading, NOT a module bug):
  - expiresIn error says 'must be an integer between 0 and 900' but only
    NEGATIVES throw; 0, 1, 86400000 (the module's 24h), and 2^31+ all
    accepted. The 24h value works; the message's upper bound is wrong.
- Artifacts: tools/csrf-probe.ts (9 checks), tests/lib/csrf-probe.test.ts
  (6 tests), verify:contracts 14/14.

## 78. Cookie APIs — native usage verified + a native-API limitation found (2026-08-24)

- User asked: does the CSRF machinery use Bun's native cookie APIs? YES:
  - SET: new Bun.Cookie(name, value, {path, httpOnly, sameSite, secure,
    maxAge}).toString() — verified output: Path=/, HttpOnly (omitted when
    false), Max-Age=0 emitted, Secure only when true, SameSite=Lax default.
  - READ: new Bun.CookieMap(cookieHeader).get(name) — verified on quoted
    values, spaces ('c = spaced' -> 'spaced'), multiple cookies, missing
    -> null. CORRECT use: the request Cookie header has no attributes, so
    every name=value IS a cookie.
- NATIVE-API LIMITATION (probe-verified, the deepen finding):
  - Bun.CookieMap is the WRONG tool for parsing Set-Cookie RESPONSE
    headers: it treats Path=/, Max-Age= etc. as cookie ENTRIES (probe:
    'session=SECRET_TOKEN; Path=/' -> entries session + Path=/) — it
    cannot distinguish attributes. CookieMap parses the Cookie REQUEST
    header only.
  - CookieJar (Fantasy402 session hops) parses Set-Cookie, so its manual
    split(';')[0] logic is CORRECT — I tried refactoring it to CookieMap,
    the test caught the regression, reverted. The reason is now a code
    comment so nobody re-attempts it.
  - CSRF's CookieMap use is correct because it reads the request Cookie
    header (no attributes).
- Artifacts: probe verified via inline bun -e (no new gate — the surface
  is 2 call sites + cookie-jar, all now documented at their source).

## 79. Bun cookie docs — full property surface probed, 15th gate (2026-08-24)

- Probed bun.com/docs/runtime/cookies against Bun 1.4.0 (tools/cookies-
  probe.ts, `bun run cookies:probe`, new verify:contracts gate, 15/15).
  The user asked WHERE and HOW cookie properties are — the answer, all
  probe-verified:
- Bun.Cookie (per-cookie object):
  - 10 properties: name, value, domain (string|null), path (default '/'),
    expires (Date|undefined), secure, sameSite (strict|lax|none, default
    lax), partitioned (CHIPS), maxAge (number|undefined), httpOnly.
  - constructors: (name,value), (name,value,opts), (cookieString),
    (options object); statics Cookie.parse + Cookie.from.
  - isExpired(): past-expires true, maxAge 3600 false, maxAge 0 true,
    session-cookie false. serialize() === toString(). toJSON() shape.
- Bun.CookieMap (map-like collection):
  - get/has/set (name,value | options | Cookie)/delete/size/toJSON/
    toSetCookieHeaders; iteration for...of + entries/keys/values/forEach.
  - constructors: empty, cookie-string, object, array-of-pairs.
  - NOTE (§78): CookieMap parses the Cookie REQUEST header — Set-Cookie
    attributes (Path= etc.) come through as entries; the cookie-jar's
    manual parse is correct for Set-Cookie.
- SERVER (the deepest integration): req.cookies in Bun.serve routes IS a
  CookieMap — get() reads request cookies, and set() AUTO-APPLIES to the
  response Set-Cookie headers (verified: visited=true + theme=dark both
  in the response). The repo's serve.ts uses routes but reads the session
  cookie via csrf.ts's explicit CookieMap(header).get — both correct,
  the csrf route is tested (§77).
- Artifacts: tools/cookies-probe.ts (12 checks), tests/lib/cookies-probe.
  test.ts (7 tests), verify:contracts 15/15.

## 80. HTTP-cookies doc — delete behavior verified, extends §79 (2026-08-24)

- The second cookie doc (http-cookies.mdx — cached at
  research/cache/bun-docs/http-cookies.mdx; fresh URL 404s, doc moved)
  covers the BunRequest.cookies property. Most claims already covered by
  §79's server probe; the ONE new claim is the DELETE behavior:
- VERIFIED (probe, cookies:probe C10):
  - set() with options auto-applies to the response:
    'user_id=12345; Path=/; Max-Age=3600; Secure; HttpOnly; SameSite=Lax'
  - delete(name, {path}) emits a Set-Cookie with EMPTY value + Expires in
    the PAST: 'user_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT;
    SameSite=Lax' — the doc's exact claim, byte-for-byte.
  - Reading via req.cookies.get('user_id') (already §79 C9).
- Artifacts: tools/cookies-probe.ts C10 (13/13), tests/lib/cookies-
  probe.test.ts (8 tests), verify:contracts 15/15.

## 81. API defaults cross-reference — hostname doc correction + explicit binds (2026-08-24)

- Cross-referenced the cookie default-locking pattern (§79/80) across the
  other Bun APIs the repo touches (tools/defaults-probe.ts, `bun run
  defaults:probe`, new verify:contracts gate, 16/16):
- CORRECTION (serve hostname default):
  - Bun 1.4.0 Bun.serve DEFAULTS to hostname "localhost" — the
    http-server doc claims the default is "0.0.0.0" (WRONG on 1.4.0,
    probed: default server reports hostname localhost). Deployment
    implication: the doc's claim would have you expect all-interfaces
    binding; the runtime is loopback-only by default.
  - ENHANCEMENT: serve.ts now sets hostname explicitly —
    Bun.env.SERVE_HOSTNAME ?? "127.0.0.1" (loopback, matches tests);
    set SERVE_HOSTNAME=0.0.0.0 to expose beyond loopback deliberately.
    The default reliance is gone; intent is explicit.
- Cross-ref verified defaults:
  - cookie: path "/", sameSite "lax", httpOnly false, secure false
    (matches §79).
  - CSRF generate without expiresIn works (no required default).
  - serve hardening already explicit in repo: 16MB body (default 128MB),
    idleTimeout 255 (default 10s), development off in prod.
- CROSS-DOC GOTCHA: req.cookies (CookieMap) exists ONLY in routes
  handlers — NOT in fetch handlers (probe: fetch cookies=false, routes
  cookies=true). The http-cookies doc only shows routes; a developer
  using fetch finds no cookies property. Repo uses routes (fine).
- Artifacts: tools/defaults-probe.ts (5 checks), tests/lib/defaults-
  probe.test.ts (5 tests), src/research/serve.ts explicit hostname,
  verify:contracts 16/16.

## 82. More API defaults — transpiler jsx default, inspect depth, write/hash/hasher (2026-08-24)

- Extended defaults:probe (tools/defaults-probe.ts now 10/10) with the
  defaults the repo RELIES on implicitly or pins explicitly:
- VERIFIED (probe):
  - new Bun.Transpiler() DEFAULT loader is jsx — TS annotations fail
    (const x: number = 1 throws under default). Explicit {loader:'ts'}
    needed. Confirms + pins §49's ctor-loader finding: the default is
    jsx, not ts.
  - Bun.inspect() DEFAULT depth is UNBOUNDED — a 6-level nested object
    prints fully (shows e:, f:). The repo's redact.ts pins depth: 32
    explicitly (its DEFAULT_REDACT_DEPTH) — a correct enhancement vs
    Bun's unbounded default (pathological nesting would print forever).
  - Bun.write() returns NUMBER (bytes written): 5 for 'hello'.
  - Bun.hash() returns BIGINT.
  - Bun.CryptoHasher('sha256').digest() returns Buffer (32 bytes).
  - Bun.build default: no sourcemap, output format/target undefined —
    the repo's design build sets target:'browser', minify:true
    explicitly (correct enhancements).
- Cross-ref: the repo's explicit settings (transpiler loader ts in
  docs-validate §59, redact depth 32, build target browser, probe-fetch
  timeout 8s/retries 2) are ALL correct enhancements over the probed
  defaults — no implicit-default reliance found needing change.
- Artifacts: tools/defaults-probe.ts D6-D8 (10/10), tests/lib/defaults-
  probe.test.ts (8 tests), verify:contracts 16/16.

## 83. Port env vars — BUN_PORT/PORT/NODE_PORT precedence pinned + serve.ts enhanced (2026-08-24)

- User asked about BUN_PORT / PORT / BUN_OPTIONS. Probed in CLEAN
  subprocesses (in-process Bun.env mutation is unreliable — a stale env
  poisoned the first probe; subprocesses are definitive):
- VERIFIED precedence (Bun.serve auto-reads when port omitted):
  explicit options.port > BUN_PORT > PORT > NODE_PORT > 3000 (Bun
  default). BUN_PORT beats both PORT and NODE_PORT when all set.
  --port CLI flag also documented. config.ts's comment ('honors BUN_PORT
  / --port') is CORRECT — my first in-process probe wrongly suggested
  otherwise; subprocess isolation proved it.
- BUN_OPTIONS: real but NOT a serve port var — prepends CLI args to any
  Bun execution (env doc: BUN_OPTIONS=\"--hot\" behaves like bun --hot run);
  standalone executables read it for runtime flags (--cpu-prof etc.).
  Undefined in this shell (not set).
- ENHANCEMENT (serve.ts): previously read only Bun.env.PORT ?? 3456 —
  ignored BUN_PORT (probe: BUN_PORT=4911 PORT=4912 -> used 4912). Now
  matches Bun's precedence: options.port ?? BUN_PORT ?? PORT ??
  NODE_PORT ?? 3456. Verified: BUN_PORT wins, PORT alone works, no-env
  -> 3456 (repo default preserved, not Bun's 3000).
- Artifacts: tools/defaults-probe.ts D9 (13/13), tests/lib/defaults-
  probe.test.ts (10 tests), src/research/serve.ts precedence fix,
  verify:contracts 16/16.

## 84. BUN_* env vars — transpiler cache, verbose fetch, NODE_ENV default (2026-08-24)

- Extended defaults:probe (now 16/16) with the BUN_* env vars the repo
  declares in src/lib/config.ts (BUN_CONFIG_VERBOSE_FETCH,
  BUN_RUNTIME_TRANSPILER_CACHE_PATH, BUN_CONFIG_MAX_HTTP_REQUESTS):
- VERIFIED (probe, clean subprocesses):
  - BUN_RUNTIME_TRANSPILER_CACHE_PATH: Bun writes transpiled output for
    source files >4KB to the custom dir (probe: 5000-char source -> 1
    cache entry). Matches the doc ('source files larger than 4 KB').
    <4KB sources produce no cache entry (eval-heavy probe: 0 entries).
  - BUN_CONFIG_VERBOSE_FETCH=curl: fetch logs the request URL (and
    headers) to the console — verified example.com appears.
  - BUN_CONFIG_MAX_HTTP_REQUESTS: accepted (default 256 per doc; not
    behaviorally probed — needs many concurrent fetches).
  - NODE_ENV: UNSET by default in Bun. The repo's serve.ts gates dev-
    mode on Bun.env.NODE_ENV === 'production' — relies on the operator
    setting it. NOTE: bun test sets NODE_ENV=test in the runner env (a
    test asserting the default must strip it — the subprocess inherits
    the runner's env otherwise).
  - BUN_OPTIONS (§83): prepends CLI args to any Bun execution;
    executables read it for runtime flags. Not a port var.
- Cross-ref: config.ts declares the BUN_* vars as typed env — all three
  are real runtime vars (probed); no dead declarations.
- Artifacts: tools/defaults-probe.ts D10 (16/16), tests/lib/defaults-
  probe.test.ts (13 tests), verify:contracts 16/16.

## 85. .env load order — .env.local SKIPPED in test (config.ts comment corrected) (2026-08-24)

- Probed the .env auto-load order (config.ts documented '.env → .env.
  {NODE_ENV} → .env.local, .local highest'). Found a real correction:
- VERIFIED (probe, clean subprocesses, single-var methodology):
  - NODE_ENV=test: .env.test BEATS .env.local (X = dotenv-test).
  - NODE_ENV=production/development/unset/staging: .env.local WINS
    (.env.production loses).
  - The Bun docs confirm: '.env.local (not loaded when NODE_ENV=test)'.
    So the repo's config.ts comment was WRONG for test environments —
    fixed to document the special case.
  - Full order: .env → .env.{NODE_ENV} → .env.local (SKIPPED in test) →
    .env.{NODE_ENV}.local.
  - Why: .env.test deliberately overrides .env.local so tests run with
    the committed test env, not a developer's local overrides (Node/CRA
    convention).
- Probe methodology note: the FIRST probe (multi-var A/B/C) gave a wrong
  result (env-test beat .local) that matched the buggy comment; the
  decisive single-var probe + docs check proved it's the test-skip rule.
  Single-var probes are more reliable for precedence testing.
- Artifacts: tools/defaults-probe.ts D11 (18/18), tests/lib/defaults-
  probe.test.ts (15 tests), src/lib/config.ts comment fixed,
  verify:contracts 16/16.

## 86. New-claims doc (markdown/cron/terminal/ffi/dev-tooling) — BUN_CPU_PROFILE contradiction RESOLVED (2026-08-24)

- Probed the pasted v1.4 new-features doc against 1.4.0:
- CONTRADICTION RESOLVED (BUN_CPU_PROFILE):
  - observability-page.ts claimed 'BUN_CPU_PROFILE=1 NO-OP in 1.4.0
    (probe §55)' — WRONG, and it contradicted the §55 it cited. Decisive
    probe: BUN_CPU_PROFILE=1 alone (no --cpu-prof) DOES write
    CPU.*.cpuprofile (759 bytes, valid JSON nodes). §55 (line 1552) was
    right all along; the page's later 'correction' was the error. Page
    fixed back to W_VERIFIED + the correct claim.
- VERIFIED (new claims):
  - Bun.cron.parse('*/15 * * * *') returns a Date (next match, UTC):
    '2026-08-25T03:00:00.000Z'. The repo's signal-pipeline already uses
    it (SIGNAL_CRON_EXPR).
  - Bun.markdown.html is NOT sanitized: raw <script>, javascript: hrefs,
    and onerror attributes pass through verbatim (probe). REPO NOTE: the
    repo renders only REPO-OWNED markdown (docs/*.md + content/posts —
    committed files, content-hashed for ETag), NOT user input — no
    exposure today, but any future user-markdown render needs sanitization
    awareness.
  - bun:ffi returns:'cstring' gives a plain string ('1.2.12' via
    libz.dylib zlibVersion) — the new API shape verified.
- NOT VERIFIABLE in sandbox (environment, not doc errors):
  - Bun.Terminal PTY spawn option: 'Failed to open PTY' (sandbox denies
    PTY device access).
  - Bun.cron FILE-form (Bun.cron('./worker.ts', expr, title)): 'Failed
    to create plist file' (launchd registration blocked in sandbox).
    The repo uses the FUNCTION form (verified working §69).
  - BUN_CPU_PROFILE with eval-only scripts (bun -e) vs bun run file.ts:
    the file form profiles; keep using bun run for profile probes.
- Artifacts: src/research/observability-page.ts corrected; §86 records
  the resolution. Gate stays 16/16.

## 87. Serve-files/folders + Range/conditional + fetch compress doc — verified (2026-08-24)

- Probed the v1.4 serve-files + Range/conditional + fetch-compress doc:
- VERIFIED (dir-route behaviors the repo's 3 {dir:} routes rely on —
  /registry/*, /partner-dashboard/*, /videos/*):
  - { dir } route serves index.html for the dir path (200).
  - Range header -> 206 Partial Content + Content-Range (bytes 0-9/100000).
  - If-None-Match matching ETag -> 304; If-Match with wrong ETag -> 412.
  - If-Modified-Since matching Last-Modified -> 304.
  - path traversal (../ via %2F) -> 404 (path normalization + openat2
    O_RESOLVE_BENEATH, verified).
  - The repo's /videos/* dir route already relies on Range/206 seeking —
    behavior confirmed correct.
- VERIFIED (fetch compress, repo uses it in resilient-fetch for UNSIGNED
  bodies): compress:'gzip'/'br'/'zstd' all set Content-Encoding and
  compress the body. NOTE: Bun.serve does NOT auto-decompress request
  bodies — req.text() returns the raw gzip frame (46 bytes for a 23-byte
  body). The DESTINATION must decompress per Content-Encoding (fine for
  outgoing; a Bun.serve receiver needs manual decompression).
- ENV-BLOCKED (not doc errors, sandbox network): fetch protocol:'http3'
  THREW HTTP3HandshakeFailed even with --experimental-http3-fetch;
  protocol:'http2' connection blocked. Consistent with bun-v1.3.14-
  catalog.md (typed + flag confirmed, e2e blocked by sandbox).
- Artifacts: tools/defaults-probe.ts D12 (23/23), tests/lib/defaults-
  probe.test.ts (16 tests), verify:contracts 16/16.

## 88. Bun v1.4 release doc — Temporal default verified, rest already probed (2026-08-24)

- Probed the v1.4 major-release doc. MOST claims were already verified in
  earlier probes (each cited): Rust rewrite §56 (530k LOC, binary 60.6 MB
  on this machine matches), NODE_ENV unset §84, Node 26.3.0 §75, the 8
  APIs (Image §70, WebView §12, markdown §38, cron §69, Terminal, CSRF
  §77, XML §68, secrets), ffi CString plain string §86, bun.lock v2
  default (repo is v1 frozen — safe per breaking-audit). Performance
  claims (5x idle CPU, 35% memory, 50% startup) are vendor marketing —
  not probeable in-repo.
- NEW VERIFIED (Temporal — the one untested claim):
  - Temporal global is ENABLED BY DEFAULT (typeof object; Instant/
    ZonedDateTime/Now all functional).
  - BEHAVIORAL: Bun.TOML.parse turns BARE datetimes into Temporal
    objects (probe: 'when = 2024-01-15T10:30:00' -> PlainDateTime) —
    matches BUN_NATIVE.md §TOML. Code reading TOML datetimes must handle
    Temporal, not string.
  - The repo's breaking-audit already monitors Temporal usage (currently
    zero in repo — gate ok). No adoption needed; awareness recorded.
- Artifacts: tools/defaults-probe.ts D13 (25/25), tests/lib/defaults-
  probe.test.ts (17 tests), verify:contracts 16/16.

## 89. Temporal adopted — parseTennisDataDate real-date validation (2026-08-24)

- The §88 Temporal verification found a real consumer: the repo's manual
  date parsing. parseTennisDataDate (tennis-data.co.uk DD/MM/YYYY feed)
  checked day<1||day>31 only — IMPOSSIBLE dates flowed through:
  '31/02/2024' -> '2024-02-31T12:00:00.000Z', '29/02/2023' (non-leap) ->
  '2023-02-29T12:00:00.000Z'. Those invalid timestamps then entered the
  event store as startTs.
- FIXED: parseTennisDataDate now validates via Temporal.PlainDate.from
  (throws RangeError on non-existent calendar dates — month length + leap
  years). Verified: 31/02, 30/02, 29/02/2023, 31/04 all -> null;
  29/02/2024 (leap) + normal dates unchanged. Exact return shape
  preserved ({iso}T12:00:00.000Z). All 28 existing tests pass.
- WHY Temporal here: it is the native, probe-verified (§88) way to reject
  impossible dates — the manual month-length/leap table would be
  reimplementing Temporal. The breaking-audit now has ONE legit Temporal
  usage site (parse-tennis-data-csv.ts); it was excluded in §88 for the
  probe tool only, so this adoption is audited normally.
- Regression tests: 31/02, 30/02, 29/02/2023, 31/04 -> null; 29/02/2024
  -> valid (tests/institutions/event-store.test.ts).
- Artifacts: src/institutions/event-store/parse-tennis-data-csv.ts,
  tests/institutions/event-store.test.ts. Gate stays 16/16.

## 90. Official breaking-changes list (issue #28792) — 2 audit checks added (2026-08-24)

- Cross-referenced the repo's breaking-audit against oven-sh/bun#28792
  (the authoritative 1.4 breaking-changes list, 138 items). The repo's
  12 checks already covered the headline + repo-relevant items (writeHeader,
  lock v2, NODE_ENV, YAML 1.2, Temporal, TLS, addons, port, WS routes,
  redirect, spawn traps, Response.error). Added 2 awareness checks for
  repo usages the audit was missing:
  - #13 WebSocket publish() backpressure return: server.publish() now
    returns 0/-1 on subscriber backpressure (was always payload length).
    Repo: live-channel + live-page publish theme/status/feed — they
    IGNORE the return, so unaffected. Check reports ok-with-detail
    (awareness, not a failure).
  - #14 Bun.randomUUIDv7 timestamp validation: timestamps >= 2^48 or NaN
    throw instead of truncating. Repo: src/lib/ids.ts + hq-view use it
    for RFC 9562 random ids (timestamp well under 2^48) — unaffected.
    Check reports ok-with-detail.
  - Also verified (probe): Bun.Cookie Expires is now IMF-fixdate
    ('Fri, 02 Jan 2026 03:04:05 GMT') — the repo's csrf.ts uses
    Bun.Cookie (correct); Bun.color 'ansi-16' emits real SGR codes
    ('\x1b[91m') — the repo's color kernel delegates to Bun.color
    (auto-correct).
  - Audit design note: these are AWARENESS checks (ok-with-detail) —
    they document repo usage + why it is safe, without failing the gate
    like a real break would. breaking-audit now 14 checks.
- Artifacts: src/lib/breaking-audit.ts (checks 13-14), tests/lib/
  breaking-audit.test.ts (12->14). verify:contracts 16/16.

## 91. Package-manager doc — every command already adopted + verified (2026-08-24)

- Cross-referenced the bun package-manager doc (global store, pm diff,
  audit fix, dedupe, prune, licenses, update, add --filter/--catalog,
  nativeDependencies/ignoreScripts) against the repo's deps tooling:
- ALREADY ADOPTED + VERIFIED on 1.4.0 (probe, defaults:probe D14):
  - bun pm diff: tools/deps-diff.ts uses it (deps:diff) — verified
    (zod --summary: 'No differences', version-pair works).
  - bun dedupe --check: deps:check gate uses it — verified ('No
    duplicates — checked 9 packages').
  - bun pm licenses --prod --json: licenses:check — verified parseable.
  - bun audit fix --dry-run: deps:audit-fix:dry — verified ('No
    vulnerabilities found (checked 7 packages)').
  - bun prune + --production: deps:prune / deps:prune:prod — verified.
  - Global virtual store: bunfig linker = "isolated" + frozenLockfile —
    enabled (the 7x claim is vendor; the repo is 3 deps so the win is
    small, but the layout is the recommended one).
  - bun update: NOT adopted (the repo pins exact versions + frozen lock;
    deliberate — updating transitive deps would churn the v1 lock).
  - add --filter/--catalog: N/A (single package, no workspaces/catalog).
- NOT NEEDED (verified): nativeDependencies / ignoreScripts — the repo's
  deps (zod, drizzle-orm, file: proton-pass) are pure JS, no prebuilt-
  binary optionalDependencies (esbuild etc.), so neither field applies.
- Artifacts: tools/defaults-probe.ts D14 (29/29), verify:contracts 16/16.

## 92. licenses:gate — pm-licenses output promoted to a contract gate (2026-08-24)

- §91 verified `bun pm licenses --prod --json` parses — but it was a
  REPORT-ONLY script: a non-permissive prod dep could land without any
  gate failing. licenses:gate (tools/licenses-gate.ts, wired into
  verify:contracts) closes that gap.
- POLICY: a prod dependency (dependencies + bundled file: vendored
  packages, per `--prod`) must carry a permissive license — MIT,
  Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense,
  CC0-1.0 — or be explicitly allowed. Anything else (proprietary,
  copyleft, Unknown) fails the gate with the exact package + license
  printed. Exit 1 = merge-blocked, same as the other gates.
- CURRENT STATE (1.4.0, probe): 6 prod packages — @types/node,
  bun-types, undici-types, zod, drizzle-orm (MIT), @factorywager/
  proton-pass (Unknown — vendored file: package with NO license field
  in its package.json; deliberate vendor exception, mirror of §91's
  file: note). Gate reports 6 allowed, 0 violations.
- SCOPE NOTES: `--prod` is the correct lens for merge authority — dev
  tooling deps are never shipped. Unknown licenses must be adjudicated
  (vendor exception, or reject) — never auto-allowed; new Unknowns fail
  loudly and force a human decision.
- Trap: parse `bun pm licenses --json` output from its first '{' — the
  command prints a human-readable table header before the JSON payload
  (same pattern as `pm diff`); naive JSON.parse fails.
- Artifacts: tools/licenses-gate.ts, package.json (licenses:gate),
  tools/verify-contracts.ts (gate #17). verify:contracts 17/17.
## 93. licenses:gate v2 — config-driven policy, scoped exemptions, SBOM logbook (2026-08-24)

- §92 hardcoded the allowlist + vendor exception in TS. v2 moves the
  policy to config/licenses-allowlist.json (policy.allowedLicenses,
  policy.licenseAliases, top-level exemptions) so compliance changes are
  config-only — no tool change — and the config is validated at load
  (validatePolicyConfig; malformed shape = exit 1 with the message).
- SPDX normalization (normalizeLicense in src/lib/licenses-policy.ts):
  exact allowed match -> exact alias -> case-insensitive alias ->
  passthrough. Aliases catch loose package definitions ('BSD' ->
  BSD-3-Clause, 'Apache 2.0' -> Apache-2.0, 'mit' -> MIT). Unknowns are
  never silently normalized — 'GPL-3.0' stays 'GPL-3.0' and fails.
- Exemptions are SCOPED, not blanket: name + optional license (applies
  ONLY while the reported license equals it) + optional version (exact
  match on the resolved version). Probe finding: for file: deps bun
  reports the file spec in versions ('vendor/proton-pass'), NOT semver —
  so vendored exceptions are guarded by license-scoping + expiry, not
  version. Auto-catch: if proton-pass v2 ships a real non-permissive
  license, the license-scoped exemption stops matching and the gate
  fails — upgrades cannot ride a grandfathered exception.
- TIME-BOMB: exemptions carry expires (ISO date). An expired exemption
  FAILS the gate ('exemption expired on <date> — re-review') —
  temporary vendor hacks cannot become permanent. Proton-pass exception
  expires 2026-12-01.
- Robustness: stdout JSON is parsed from its first '{'; on parse failure
  stderr is tried (bun may route the payload or the error there); both
  failing exits 1 with the stderr tail. Config JSON parse errors also
  exit 1 with the message.
- Output modes: default human report; --json emits {ok, summary,
  packages, violations, staleExemptions, diff} for piping; --sbom [path]
  writes an SBOM snapshot (.data/licenses-sbom.json by default) with
  per-package fingerprints (sha256 of name|version|license|package.json
  file hash) and prints a diff vs the previous snapshot (added / removed
  / changed) — the gate doubles as a logbook. Stale exemptions (config
  names matching no prod package) warn but do not fail.
- SBOM write trap (test-caught): the snapshot must end with a REAL
  newline — writing a literal backslash-n makes Bun.file().json() throw
  'Unrecognized token'. Also: --sbom with a custom path skips the 'sbom
  written' line (it prints only for the default path) — tests assert on
  the diff lines instead.
- Artifacts: src/lib/licenses-policy.ts (pure, unit-tested), config/
  licenses-allowlist.json, tools/licenses-gate.ts (v2), tests/lib/
  licenses-policy.test.ts + licenses-gate.test.ts (--json/--sbom),
  package.json (licenses:sbom added). verify:contracts stays 17/17.
## 94. licenses:gate v2.1 — remediation hints + offline audit overlay (2026-08-24)

- REMEDIATION HINTS: exemptions can now carry a remediation string
  ("upgrade to v2", "contact legal"). When an exemption EXPIRES, the
  failure reason appends " Action: <remediation>" — a failed gate names
  the next step instead of leaving the dev to reverse-engineer the
  vendor situation. Proton-pass carries a concrete remediation.
- OFFLINE VULNERABILITY OVERLAY: config/audit-overrides.json maps
  pkg@version -> severity (shorthand "high" string or
  { severity, note? }). The gate WARNs on matches in human output and
  includes them in --json (advisories array) but NEVER changes its exit
  code — license policy remains the merge authority. A malformed overlay
  exits 1 (config integrity, same philosophy as the allowlist).
- THE ONE NETWORK CALL lives in `bun run audit:overlay:update`
  (tools/audit-overlay-update.ts): shells `bun audit --json`, parses
  with a shape-tolerant extractor (clean {} / flat pkg@version map /
  nested vulnerabilities key), UPSERTS into the existing overlay
  (manual entries preserved), and writes config/audit-overrides.json.
  Run manually or on a schedule — the license gate itself stays offline
  + sub-second.
- Probe notes: `bun audit --json` on a clean 1.4.0 tree returns {}
  (exit 0). The populated shape is NOT probeable without introducing a
  vulnerable dep — the parser deliberately accepts flat and nested
  forms (documented in the tool header).
- Trap (test-caught, second time): Bun.write lines must carry the TS
  escape "\n" — exactly one backslash level. "\\n" writes a LITERAL
  backslash-n that corrupts the JSON tail (§93 SBOM + this overlay).
- Artifacts: src/lib/licenses-policy.ts (remediation field +
  validateAuditOverrides / normalizeAuditOverlay / advisoryFor),
  config/licenses-allowlist.json (remediation), config/audit-overrides.
  json, tools/audit-overlay-update.ts (+SPAWN_KEEP_LIST), package.json
  (audit:overlay:update), tests/lib/licenses-policy.test.ts (+5),
  tests/lib/licenses-gate.test.ts (advisories key). verify:contracts
  stays 17/17.
## 95. Operator's manual — probed, corrected, folded (2026-08-24)

- A pasted operator's manual for the license gate made six claims; every
  one was probed against the committed tooling. Corrections (verified):
  1. FALSE: "pre-commit executes bun run check (includes gate #17)".
     The hook runs a SUBSET; licenses:gate was missing entirely — a GPL
     dep could land with a green pre-commit. FIXED: added licenses:gate
     as a conditional gate in tools/pre-commit.ts, firing on package.
     json / bun.lock / config/licenses-allowlist.json / config/audit-
     overrides.json / tools/licenses-gate.ts / tools/audit-overlay-
     update.ts / src/lib/licenses-policy.ts (~10ms, offline). Tests in
     tests/pre-commit.test.ts updated (exact-array assertions).
  2. FALSE: exemption schema uses "pkg". The field is "name" —
     validatePolicyConfig rejects a missing name, so the manual's own
     example would fail the gate.
  3. FALSE: aliases live in a top-level "aliases" map. They are at
     policy.licenseAliases. An identity alias ("Unlicense": "Unlicense")
     is a no-op — Unlicense is already allowed.
  4. FALSE: --json exposes ".status" ("pass"/"fail"). Probed keys:
     ok (boolean), summary, packages, violations, advisories, stale-
     Exemptions, diff. `jq '.status'` returns null; `jq '.ok'` is the
     switch.
  5. FALSE: the SBOM FILE contains added/removed/changed arrays. The
     diff is computed against the previous snapshot and printed to
     STDOUT; the file holds only format/version/generatedAt/bunVersion/
     summary/packages. Also: generatedAt churns every run, so git diff
     on the committed snapshot always shows that one line.
  6. PARTLY WRONG: "update the version field" to re-approve a vendored
     dep — for file: deps bun reports the file spec in versions, not
     semver, so version-scoping cannot work; the license-scoped
     exemption auto-drops when a real license appears (probed in §93).
     Correct guidance is extend expires + refresh remediation.
- Folded the corrected manual into docs/LICENSE-GATE-OPS.md (commands,
  failure formats, schema reference, cheat sheet) — the repo now carries
  one accurate operator's doc instead of an ad-hoc chat artifact.
- Lesson: externalized policy still needs an accurate operator's doc; a
  plausible-but-wrong manual is worse than none (it teaches the wrong
  config schema and promises a gate that does not run). Probe the
  claimed behavior, then fold the correction in.
- Artifacts: tools/pre-commit.ts (+licenses:gate conditional), tests/
  pre-commit.test.ts (3 updated + 5 new assertions), docs/LICENSE-GATE-
  OPS.md (new). verify:contracts stays 17/17.
## 96. SPDX expressions + expiry warning window + --config (2026-08-24)

- SPDX EXPRESSIONS: a compound license like '(MIT OR Apache-2.0)'
  previously FAILED the gate even though the licensee may comply with
  MIT (probe-confirmed false positive). evaluateLicenseExpression now
  evaluates OR/AND/parens recursively: OR -> allowed if ANY alternative
  is allowed; AND -> allowed only if ALL are. matchedBy becomes
  "expression". Trap (test-caught): bare operands must be leaf-
  normalized via expressionAllows — routing them back through
  evaluateLicenseExpression returns allowed:false by design (it signals
  'not an expression') and broke every OR/AND branch.
- OPERATOR BOUNDARIES: lowercase 'or' in 'GPL-2.0-or-later' is NOT an
  operator — splitTopLevel is case-sensitive with word-boundary checks,
  so the SPDX '-or-later' suffix survives (test: isExpression false).
- EXPIRY WARNING WINDOW: policy.expiryWarningDays (default 30) — an
  exemption allowed today but expiring within the window prints 'warn
  exemption <name> expires in N day(s)' in human output and appears in
  the --json expiringSoon array (name/version/expires/expiresInDays/
  reason). Exit code unchanged — the time-bomb now gives lead time to
  re-review instead of detonating with zero notice.
- --config <path>: override config/licenses-allowlist.json (ops +
  tests). Unlocked the first END-TO-END failure-path test: a strict
  fixture (allowedLicenses ['MIT']) makes the gate exit 1 with
  'FAIL drizzle-orm@0.45.2' — proving the gate actually blocks, not
  just reports. A wide-window fixture (expiryWarningDays 365) asserts
  expiringSoon surfaces proton-pass.
- Artifacts: src/lib/licenses-policy.ts (evaluateLicenseExpression /
  expressionAllows / wholeDaysBetween, +expires+expiresInDays on
  EvaluatedPackage), tools/licenses-gate.ts (--config, expiringSoon,
  warnDays), tests/lib/licenses-policy.test.ts (+6), tests/lib/
  licenses-gate.test.ts (+2 e2e). verify:contracts stays 17/17.
## 97. Licenses on the live surface — /status + ops dashboard (2026-08-24)

- The license gate was invisible to the live dashboard (unlike the 4 docs
  gates, which seed .data/*-state.json). Now licenses:gate writes
  .data/licenses-state.json via the shared writeDocsGateState (src/lib/
  docs-state.ts) — ok/fails/packages/exemptions/advisories/expiringSoon —
  ONLY when run with the default config path; --config fixtures skip the
  write so tests never pollute the live state.
- signal-pipeline collectDocs reads it as the 5th docs-channel signal
  (licenses-health): 'N prod packages · M violations' + ' · K expiring
  soon'. Identical semantics to the other gates: failing = bad, missing
  state = warn ('run bun run licenses:gate'), stale > 30d = warn.
- /ops dashboard gained a licenses:gate action (POST runs the offline
  gate via runBunCommand, reports ok + last lines) — same path as the
  docs:check/docs:api/... actions (§74).
- Trap: the state file is TRACKED and the gate rewrites it on every
  default-config run (lastChecked churn) — same class as api-state.json
  etc.; commit the initial snapshot so fresh clones have it (missing
  state = warn until the first gate run).
- Artifacts: tools/licenses-gate.ts (+state write), src/institutions/
  signal-pipeline.ts (5th gate() call), src/research/serve.ts (action +
  allowed list + error message), tests/lib/signal-docs.test.ts
  (licenses-health, all-five ok, title match), .data/licenses-state.json
  (initial snapshot). verify:contracts stays 17/17.
## 98. The SBOM-diff misconception resurfaced (2026-08-24)

- A condensed operator's rhythm again claimed "review the diff in
  .data/licenses-sbom.json" — the SAME error §95 item 5 corrected.
  Re-probed: the file has ZERO added/removed/changed keys; the diff is
  printed to STDOUT by `bun run licenses:sbom`; `git diff` on the
  snapshot shows only generatedAt churn.
- WHY IT KEEPS RESURFACING: the command name (licenses:sbom) + a file
  existing invites 'the diff is in the file'. The fix that sticks is the
  corrected wording living in the OPS doc's operating-rhythm section —
  the answer is one file away instead of a chat artifact.
- ALSO CAUGHT: the committed .data/licenses-sbom.json predated v2.2's
  expires/expiresInDays verdict fields — regenerated + committed so the
  snapshot matches the current schema.
- Artifacts: docs/LICENSE-GATE-OPS.md (operating rhythm section),
  .data/licenses-sbom.json (schema-fresh snapshot). verify:contracts
  stays 17/17.
## 99. Weekly overlay refresh — follow the cron-main idiom, not ad-hoc scripts (2026-08-24)

- A proposed plan: standalone Bun.cron script + wire into serve.ts.
  Rejected — the repo ALREADY has two Bun.cron idioms: scripts/cron-
  main.ts (the in-process 'cron master' consolidating all periodic
  jobs; network jobs are opt-in via env, tz pinned UTC) and the
  OS-level schedule-cli register/remove/preview pattern (research,
  docs-refresh). A new ad-hoc script would be the third, parallel shape.
- FOLLOWED THE IDIOM: tools/audit-overlay-update.ts refactored to export
  refreshAuditOverlay() behind an import.meta.main guard (the
  blog-map-run.ts precedent: 'shared by the CLI and the cron'). The
  refactor also changed failure handling: it now THROWS instead of
  process.exit(1) — an in-process cron caller must never kill the cron
  process. cron-main gains INTERVAL_AUDIT_OVERLAY '0 0 * * 0' (Sunday
  00:00, { tz: 'UTC' }), opt-in AUDIT_OVERLAY_UPDATE=1 (consistent with
  BUN_RELEASE_WATCH/MASSEY_SYNC), a jobAuditOverlay() with the standard
  guard + try/catch + [cron:audit-overlay] log, a registration log
  line, and a --once slot.
- CORRECTED PLAN CLAIM: 'audit:overlay:update is tested' — FALSE before
  (network tool, deliberately untested). Now covered WITHOUT network:
  tests/scripts/audit-overlay-cron.test.ts asserts the schedule parses
  + fires on Sunday (Bun.cron.parse, UTC) and that the module imports
  without executing (the import.meta.main guard is load-bearing — a
  broken guard would hit the network at import time).
- NO AUTO-COMMIT: the overlay file is updated in place; a long-running
  process must not do git operations (AGENTS.md hygiene) — the weekly
  diff is reviewed + committed deliberately.
- Artifacts: tools/audit-overlay-update.ts (exported fn + import.meta.
  main guard + throw-on-failure), scripts/cron-main.ts (job + constant
  + registration), tests/scripts/audit-overlay-cron.test.ts (new),
  docs/LICENSE-GATE-OPS.md (automated weekly section). verify:contracts
  stays 17/17.
## 100. Fail-closed bun pm resolution + --overlay flag (2026-08-24)

- The gate previously parsed `bun pm licenses` output without checking
  the subprocess EXIT CODE — a lockfile/toolchain failure producing
  non-JSON output would mislead with 'could not parse' instead of
  naming the real cause. Now resolveLicensesData fails CLOSED:
  non-zero exit -> 'bun pm licenses exited N (lockfile/toolchain
  failure?)'; exit 0 with non-JSON -> parse hint. Both exit 1 with the
  stderr tail.
- --overlay <path>: test an alternate config/audit-overrides.json
  (mirrors --config). The licenses-state.json write now requires the
  DEFAULT overlay path too — fixture runs never pollute the live state
  (asserted by a test that runs --overlay then reads the state file).
- IMPORT GUARD: tools/licenses-gate.ts now ends with `if (import.meta.
  main) await main();` (the audit-overlay-update pattern, §99) — the
  exported resolveLicensesData is unit-testable WITHOUT executing the
  gate (which would spawn bun pm on import).
- Tests: resolveLicensesData 3 unit (exit-1 closed, non-JSON, valid),
  --overlay 2 e2e (advisory surfaced with exit 0; state not polluted).
- Artifacts: tools/licenses-gate.ts (resolveLicensesData, --overlay,
  import guard), tests/lib/licenses-gate.test.ts (+5), docs/LICENSE-
  GATE-OPS.md (--overlay row). verify:contracts stays 17/17.
## 101. Review pass — flag helper, snapshot guard, operator-format e2e, gate pattern codified (2026-08-24)

- REVIEWED the assembled gate (6 edit rounds had left drift):
  1. Flag parsing was a triplicated indexOf block (--sbom/--config/
     --overlay) — extracted flagValue() helper.
  2. A fixture config combined with a default --sbom path would have
     silently overwritten the COMMITTED snapshot — now fails closed
     ('use an explicit --sbom path with --config').
  3. The ops manual's --json key list was stale (missing expiringSoon
     from §96) — probe-compared against live output and fixed.
  4. The time-bomb's OPERATOR-VISIBLE message (expiry date + Action
     hint in human output) had no e2e — added. Human advisory warn
     line also now asserted.
- PATTERN CODIFIED: docs/GATE-PATTERN.md — the six-part checklist
  (config-not-code, fail-closed-named, importable+guarded main, full
  chain wiring, unit+e2e-fixture tests, documents) distilled from
  §92-§100 so the NEXT gate lands with the same guarantees.
- Test trap (again): runGateArgs captured stdout only — the guard's
  human-mode message goes to stderr (consistent with other error
  paths); the helper now returns stderr too.
- Artifacts: tools/licenses-gate.ts (flagValue, snapshot guard), tests/
  lib/licenses-gate.test.ts (15 tests, +3 e2e), docs/LICENSE-GATE-OPS.md
  (key list), docs/GATE-PATTERN.md (new), this section. verify:contracts
  stays 17/17.
## 102. SPDX WITH exceptions + pseudo-license diagnostics (2026-08-24)

- WITH EXCEPTION MODIFIERS: 'X WITH exception' (e.g. 'GPL-2.0 WITH
  Classpath-exception-2.0') now evaluates the BASE license only — an
  exception never makes a non-permissive base permissive for the
  allowlist's purposes. 'MIT WITH LLVM-exception' passes; 'GPL-2.0 WITH
  Classpath-exception-2.0' still fails with 'no permissive alternative'.
  Detection regex extended with \bWITH\b (case-sensitive, so the
  lowercase '-or-later' suffix is untouched); splitTopLevel's
  word-boundary split is reused. Parenthesized OR + WITH composes
  ('(MIT OR GPL-2.0) WITH LLVM-exception' passes).
- PSEUDO-LICENSE DIAGNOSTICS: 'UNLICENSED' and 'SEE LICENSE IN <file>'
  previously failed with the GENERIC 'no allowlist entry' — an operator
  could not tell the string was meaningful. Now they get actionable
  reasons: UNLICENSED -> 'not open source; remove the dep or get an
  explicit vendor/legal exemption'; SEE LICENSE IN -> 'deferred to a
  file; resolve manually and add an exemption'. Both still FAIL (exit 1)
  — the diagnostics improve the message, never the verdict.
- Tests: +5 (WITH allowed base, WITH blocked base, WITH+parens, both
  pseudo-license diagnostics). tests/lib/licenses-policy.test.ts now
  29.
- Artifacts: src/lib/licenses-policy.ts (WITH branch + detection +
  diagnostics), tests/lib/licenses-policy.test.ts (+5), docs/LICENSE-
  GATE-OPS.md (diagnostics note). verify:contracts stays 17/17.
## 103. licenses:report — static compliance artifact for legal/release sign-off (2026-08-24)

- `bun run licenses:report` renders a markdown compliance report to
  research/outputs/licenses-report.md (research/outputs is gitignored —
  regenerate + attach at release time, no churn). Sections: header with
  generatedAt/bunVersion + CONFIG FINGERPRINT (sha256 of both policy
  files — proves which policy version produced the artifact), summary
  table, per-package table (license + status + fingerprint), exemptions
  (with expiry + days remaining), advisories, expiring-soon, drift vs
  the previous snapshot, violations, stale exemptions.
- RENDERING is a pure lib (src/lib/licenses-report.ts — no Bun APIs,
  unit-tested); the CLI (tools/licenses-report.ts) spawns the gate with
  --json --sbom (offline), fingerprints the configs, renders, writes.
  Args are forwarded to the gate (--config/--overlay/--sbom <path> for
  fixture runs); the CLI owns the default snapshot path.
- FAILING GATES STILL WRITE: a violation run produces a report with the
  FAIL status + violations listed and exits 1 — the FAIL state IS the
  sign-off artifact (legal sees exactly what blocked the release).
- CRON: the weekly jobAuditOverlay (§99) now regenerates the report
  after the overlay refresh (Bun Shell $ spawn, massey idiom) — the
  same weekly cadence covers overlay + report.
- Trap (test-caught): Bun Shell needs REAL backticks — `$"..."` is
  invalid TS. The run_code lexer breaks on backticks in strings, so the
  cron line was built with String.fromCharCode(96) concatenation.
- Tests: renderer 2 unit (PASS + FAIL renders), CLI 2 e2e (fail writes
  + exit 1; pass writes + exit 0). SPAWN_KEEP_LIST +2.
- Artifacts: src/lib/licenses-report.ts (new), tools/licenses-report.ts
  (new), scripts/cron-main.ts (report in jobAuditOverlay), package.json
  (licenses:report), tests/lib/licenses-report.test.ts (new).
  verify:contracts stays 17/17.
## 104. Compliance channel + CycloneDX XML SBOM (2026-08-24)

- COMPLIANCE CHANNEL: licenses-health moved OFF the docs channel onto
  its OWN 'compliance' channel (CHANNEL_LABELS 'Compliance') — the
  compliance surface deserves a section, not a docs row. The shared
  state-file gate logic was extracted from collectDocs into a module-
  level pushGate(root, signals, channel, file, id, label, source,
  detailOf) helper, used by collectDocs AND the new collectCompliance.
  The dashboard renders the new section automatically; the
  'collectSignals covers every channel' test extended with 'compliance'.
- CYCLONEDX XML SBOM: licenses:report now ALSO writes research/outputs/
  licenses-sbom.xml (CycloneDX 1.5) — the machine-readable twin of the
  markdown report for SBOM-ingesting pipelines. Built with the PROBED
  Bun.XML API (xml:probe §68): XML.stringify is well-formed-or-throws;
  the artifact's validity is asserted by XML.parse round-trip in tests.
  The compact body comes from a PURE builder (buildCycloneDxObject(input,
  serialNumber)) — the serial is a parameter so the lib stays Bun-free
  and tests are deterministic. Components carry bom-ref (pkg:generic/
  name@version), license <id> or <name>, and kalshi-bot:status/allowed
  properties; metadata carries gate-status + config fingerprint.
- TRAP (test-caught): compact-object ARRAY ITEMS are the ELEMENT
  CONTENT, not wrapper objects — an item { component: {...} } under a
  'component:' key stringifies as NESTED <component><component>...
  </component></component>. Map items directly (attributes/children on
  the item itself).
- TS TRAP: Bun.XML.stringify/parse type defs return string|undefined —
  coerce with ?? '' where the value feeds a parse.
- The pasted Bun XML doc's claims were ALREADY fully probed (§68,
  36/36) — no new probes; the API is now USED in production output.
- Artifacts: src/institutions/signal-pipeline.ts (compliance channel +
  pushGate), src/lib/licenses-report.ts (buildCycloneDxObject), tools/
  licenses-report.ts (XML emission), tests/lib/signal-docs.test.ts
  (compliance describe), tests/institutions/signal-pipeline.test.ts
  (+compliance), tests/lib/licenses-report.test.ts (+2 XML).
  verify:contracts stays 17/17.
## 105. Content-addressed CycloneDX serial + artifact cross-link (2026-08-24)

- The XML twin's serial was a fresh random UUID per run — a reviewer
  could not verify the BOM corresponds to a specific policy+deps. Now
  deterministicSerial() (§104 builder + CLI): serial = urn:uuid: over
  sha256(config fingerprint + each package name@version:allowed),
  formatted 8-4-4-4-12. Identical content -> IDENTICAL serial (verified
  by a two-run e2e asserting equality); any policy/dep change -> a new
  serial. generatedAt is excluded by design — the serial identifies
  CONTENT, the timestamp is a metadata field.
- CROSS-LINK: the markdown report now carries an 'XML SBOM serial:'
  header line, and the e2e asserts the markdown serial === the XML
  serialNumber — the two artifacts are verifiably the same snapshot.
- FAIL PATH COVERED: the strict-fixture e2e now also asserts the XML
  twin is written on gate FAIL with kalshi-bot:gate-status=FAIL — the
  FAIL state is the sign-off artifact in BOTH formats.
- GATE-PATTERN.md gained the artifact-twin rule: human + machine-
  readable outputs, cross-linked by a content-addressed identifier.
- Tests: deterministicSerial 2 unit, +2 e2e assertions (cross-link,
  determinism). tests/lib/licenses-report.test.ts now 9.
- Artifacts: src/lib/licenses-report.ts (deterministicSerial, xmlSerial
  header), tools/licenses-report.ts (serial seed + cross-link), tests/
  lib/licenses-report.test.ts (+4), docs/GATE-PATTERN.md. verify:
  contracts stays 17/17.
## 106. Proactive compliance alerts — Telegram push from the weekly job (2026-08-24)

- The platform was REACTIVE: compliance problems surfaced only when
  someone looked (dashboard badge / commit block). The weekly
  jobAuditOverlay now PUSHES a Telegram summary when something needs
  attention: new advisories (bun audit found > 0), gate FAIL (report
  exit != 0), or exemptions entering the expiry warning window
  (licenses-state expiringSoon). Opt-in COMPLIANCE_ALERTS=1 (mirrors the
  INVENTORY_PROMOTE_TELEGRAM precedent); TELEGRAM_* + subscribers are
  required — no subscribers = skipped.
- Pure message builder (buildComplianceAlertMessage): null when clean;
  only non-zero lines included, so a clean week sends nothing.
- DEDUPE: complianceAlertFingerprint (found|reportOk|expiringSoon) is
  stored in .data/compliance-alert-state.json; an unchanged fingerprint
  is 'skipped' BEFORE any subscribers lookup — a stable situation is
  NOT re-sent weekly, any change -> a new fingerprint -> alert. The
  dedupe-first order keeps the send path network-free in tests.
- maybeSendComplianceAlert returns a status for the cron log
  (sent/skipped/nothing-to-report/not-enabled/error).
- Trap (edit-caught): the §103 backtick fix had DROPPED the report
  spawn line's indentation (column 0) — the alert edit anchor missed;
  the job block was re-indented while wiring the alert.
- Tests: 8 (message null + each non-zero line, fingerprint stability,
  disabled/clean/dedupe paths) — no network. tests/lib/compliance-
  alert.test.ts.
- Artifacts: src/lib/compliance-alert.ts (new), scripts/cron-main.ts
  (alert block in jobAuditOverlay), tests/lib/compliance-alert.test.ts
  (new), docs/LICENSE-GATE-OPS.md (alerts section). verify:contracts
  stays 17/17.
## 107. Combined pipeline report — the founding mtafile ask completed (2026-08-24)

- The original request ('review the mtafile.md pipeline, enhance it with
  the frontend modules, plan per module, work through the builds') had
  per-module metafiles + budgets + a gate, but NO combined review
  document. dist/pipeline.meta.md (design:pipeline-report) closes it:
  one markdown report over ALL frontend modules with size vs budget,
  largest contributor, growth, gate status, and a per-module
  enhancement plan.
- ENHANCEMENT PLANS ARE DATA-DRIVEN (moduleEnhancementNotes): over-
  budget, monolith (largest >= 90% of bundle -> chunking note),
  contributor-over-budget, growth over warn threshold — derived from
  the same buildBudgetHealth the gate + /api/design/budgets use, so the
  report, the gate, and the live API cannot drift. Current findings:
  hq-app app.js monolith at 95.8% (chunk hash-routes/surface-edge);
  design-system color kernel 55.8% (expected core).
- WORKED THROUGH THE BUILDS: design:build -> design:pipeline-report ->
  design:check — all green (2 modules, 0 enforced, 20 backlog
  playground-only, 32 surfaces).
- Artifacts: src/lib/pipeline-report.ts (pure, 5 tests), tools/
  pipeline-report.ts (CLI), package.json (design:pipeline-report),
  docs/DESIGN-PIPELINE.md §13-§14, this section. verify:contracts stays
  17/17.
## 108. Transient url-health flake fixed at the source — probeHttp retries network-level failures once (2026-08-24)

- The full-suite flake (1 of 2445 tests, green on re-run) was finally
  pinned: tests/institutions/url-health.test.ts makes LIVE network calls
  (12s timeouts; probeOfficialCatalog asserts failed === 0 across the
  catalog with concurrency 4). Under 10x --parallel load a transient
  DNS/TLS/connection hiccup made a fetch throw -> ok:false -> test
  fail. 5 reproduction runs were clean (transient flakes do not
  reproduce on demand), so the fix targeted the mechanism, not the
  symptom.
- FIX (src/institutions/url-health.ts probeHttp): network-LEVEL failures
  (status 0 = the fetch threw) are retried ONCE — a transient hiccup
  self-heals; a genuinely dead endpoint fails both attempts with
  '(after 1 retry)' appended. HTTP statuses (2xx/4xx/5xx) are REAL
  signals and are never retried (an answered 503 stays a 503). The
  probe is now testable: attemptOnce() extracted + probeHttp takes an
  injectable fetch (defaults to the global).
- Tests: tests/lib/url-health-retry.test.ts (3, offline via injected
  fetch): transient self-heal (2 HEADs), dead endpoint fails with the
  retry noted, HTTP 503 NOT retried (1 HEAD). Count HEAD calls, not all
  fetches — one attempt = HEAD + optional GET fallback.
- Design note: the pre-commit hook's --retry 1 defuses flakes at the
  harness level (belt); fixing the probe removes the flake at the
  source (suspenders) — the check's test step stays retry-free because
  it no longer needs it.
- Artifacts: src/institutions/url-health.ts (attemptOnce + retry),
  tests/lib/url-health-retry.test.ts (new). verify:contracts stays
  17/17.
## 109. Build-system changelog probed — 9/9 verified, 2 doc claims corrected (2026-08-24)

- Pasted Bun build-system changelog probed against 1.4.0 (34cbb9a40) via
  a new gate: bun:build-probe (tools/build-probe.ts, verify:contracts
  gate #18 -> 18/18). VERIFIED 9/9:
  1. feature() from bun:bundle — build-time dead-branch removal via
     --feature=FLAG AND features:[...] (string present only when set).
  2. CORRECTED: feature() has a POSITIONAL GUARD the doc omits — calling
     it outside a direct if/ternary throws 'can only be used directly
     in an if statement or ternary condition'.
  3. In if/ternary position it works under bun run/test, returning
     false when unflagged (the doc's 'works in bun run and bun test' is
     true ONLY in that position).
  4. Bun.build({ files }) — in-memory builds; virtual paths take
     precedence over disk (probe: virtual-won 42).
  5. metafile:true — esbuild-format inputs/outputs (already adopted by
     design:build §107).
  6. TC39 decorators work (experimentalDecorators off).
  7. --compile --target=browser -> ONE html, everything inline.
  8. CORRECTED: --asset embeds files/dirs and node:fs resolves them at
     their ORIGINAL paths (absolute + relative work) — but the
     changelog's /$bunfs/ namespace is ABSENT on this runtime
     (existsSync('/$bunfs') === false). Embedding yes; /$bunfs/ no.
  9. --bytecode --format=esm --compile runs top-level await.
- ALREADY ADOPTED: metafile:true + --metafile-md (the mtafile pipeline,
  §107) — the changelog's metafile section describes what the repo's
  dist/*.meta.json + *.meta.md already produce.
- LABELED MARKETING (not probeable in-repo, never claimed): the 'Faster'
  section (new URL 4.6x, RegExp marked/isbot, zlib-ng, Buffer hex/
  base64url SIMD, SourceMap, Promises) is comparative against Bun 1.3
  (not installed) + third-party deps (marked/isbot absent from the
  zero-dep repo); code-splitting 14x is a vendor benchmark on a
  20,000-module graph; the antd barrel example references an external
  package. Same labeling discipline as §88.
- Probe traps (recorded): scratch files must live in ONE /tmp view —
  tools.write and bash see different sandbox /tmp (probe writes its own
  mkdtemp + cleanup); the run_code lexer mangles escaped quotes — the
  probe was transported via a double-quoted-heredoc (no-expansion
  <<"EOF") inside a single-quoted wrapper, source written with zero
  single quotes.
- Artifacts: tools/build-probe.ts (new, 9 checks), tests/lib/build-
  probe.test.ts (new), package.json (bun:build-probe), tools/verify-
  contracts.ts (gate #18), scripts/audit-bun-native.ts (keep-list +2),
  this section. verify:contracts 18/18.


















## 144. maps.toml triple-lock landed (2026-08-25)

- docs:refresh (tools/bun-docs-refresh-cli.ts) gates the four-surface lock:
  maps.toml (committed) + bun-types/@types/bun pins (package.json) +
  Bun.version (runtime) + the indexed docs tag ref (research/cache/bun-docs/
  INDEX.json "mapsHash"). Offline check-only (BUN_DOCS_REFRESH_SKIP_NETWORK=1)
  exits 1 on drift; the network run self-heals by re-indexing + regenerating
  maps.toml. Wired into verify:contracts as gate #19.

## 145. Channel + route registries (2026-08-25)

- channel-registry.ts is the CHANNEL SSOT: ids/labels/sources/actions/cron +
  telegram flags. The dashboard live-refresh loop now covers ALL channels
  (was hardcoded to 7 — prune/mapping/docs/compliance never refreshed live;
  github added §146 → 12 channels, still zero hardcoded JS).
  The /api/signals/actions dispatcher's unknown-action message derives from
  CHANNEL_ACTIONS.
- route-manifest.ts is the API-surface SSOT (~97 entries: exact + URLPattern +
  dir routes + /bun/* widgets, layer-tagged). routes:check (verify:contracts
  gate #20) scans serve.ts pathname literals + routes-map keys + BUN_WIDGETS
  keys and fails on any unregistered route. /bun/api renders the manifest.
- Bun 1.4.0 regex-lexer quirk (probe): a regex literal containing a bare
  slash inside a group AND quotes — /"(/[^"]+)"/ — throws "Unexpected ^"
  (the parser misreads the / inside the group). Escaping the slash (\/) or
  using new RegExp(String.raw`...`) parses fine. Use the RegExp form in
  tools that scan source for pathname literals.
## 110. Trap-removal protocol — prevention, not accumulation (2026-08-24)

§92-§109 recorded traps after each was hit. This section replaces that
pattern: traps are now PREVENTED by protocol. Future work should hit
fewer of them; when one slips through, fix the rule below, do not add
another note.

### R1 — Scratch lives in scratch/, never /tmp

- tools.write and bash see DIFFERENT sandbox /tmp views (probe evidence,
  §109 build-probe silently lost files). scratch/ at the repo root is
  gitignored and shared by every tool (verified: tools.write -> bash read
  works). All cross-tool scratch files go there. Exception: a SINGLE bash
  call may use /tmp entirely within itself (the build-probe mkdtemp
  pattern).

### R2 — File transport through the run_code lexer (proven-safe only)

- The lexer mangles: backticks, ${} in strings, \' in single-quoted
  strings, \" in double-quoted strings, and any string whose content
  contains BOTH quote types. PROVEN-SAFE transports:
  1. single-quoted JS wrapper + double-quoted content (no escapes)
  2. double-quoted JS wrapper + single-quoted content (no escapes)
  3. content needing BOTH quote types: bash heredoc with a double-quoted
     delimiter (<<"EOF" — no expansion) inside a single-quoted JS
     wrapper, source written in ZERO single quotes.
  Never: backticks, ${}, \' or \" in run_code strings.

### R3 — Test-line quote rule (the recurring 'Expression expected')

- The ENTIRE `describe("...", () => {` / `test("...", () => {` must
  sit inside the string literal — the closing `", () => {` must never
  fall outside the quote. Hit repeatedly (§101, §103, §105, §106, §107,
  §109); now a rule, not a note.

### R4 — Newline discipline

- In JS wrappers: \n = real newline in the file (correct for source
  files); \\n = literal backslash-n (correct when the target needs a
  TS/JSON escape, e.g. the SBOM write §93/§94). Grep the file after
  writing to confirm.

### R5 — Mandatory post-write verification

- After creating/editing ANY file: typecheck + the focused test + docs:
  check (for docs) BEFORE proceeding. Every trap so far was caught by
  this step; it is now unconditional, not optional.

### R6 — TS inference traps

- Annotate empty arrays (`[] as string[]` — never[] inference, §103);
  coerce Bun.file().text() and XML.stringify with ?? '' (their types
  include undefined, §104).

### R7 — Behavior traps are removed at the source, never masked

- Network flake -> retry inside the probe (§108 url-health). Doc claim
  wrong -> probe and record the correction (§109). A behavior trap is
  FIXED in code, then the fix is recorded — not a workaround note.

### Status

- Structurally removed: /tmp cross-tool trap (R1), lexer corruption
  (R2), test-quote bug (R3), newline double-escape (R4), silent
  corruption (R5), TS inference (R6), url-health flake (R7/source).
- Inherent (routed around, not removed): the harness lexer itself (R2
  transports), sandbox /tmp isolation (R1).
- Artifacts: this section. verify:contracts stays 18/18.
## 146. Live GitHub budget channel + release-driven docs drift (2026-08-25)

- github channel (§146): github-budget.ts reads the authenticated /rate_limit
  wire (ONE fetch, 5-min in-process TTL — the endpoint itself counts against
  core, so the TTL is the budget guard) and the channel reports token source
  + core/search/code_search remaining + reset. Degrades to zero-network when
  no token resolves; distinguishes "no token" from "token 401/rejected".
- release-driven docs drift: collectSignals compares the latest Bun release
  (RSS + atom, numeric semver via versionGt — feeds say "1.4" where maps.toml
  pins "1.4.0", so STRING compare false-positives) against maps.toml pins;
  a newer release pushes a docs-channel warn with a docs:refresh action
  (dispatcher runs the network refresh to heal the triple-lock).
- mock.module path gotcha: tests in tests/institutions/ must mock with
  "../../src/..." (two levels up), not "../src/..." — one level up resolves
  to tests/src/... and silently falls through to the REAL module (live
  network in tests). tests/ root files use "../src/...".
- tools/bun-docs-index.ts is import-safe now: main() runs under
  import.meta.main; importing it (for githubApiAuthHeaders tests) no longer
  triggers discovery/network/cache writes. The trees API call authenticates
  via githubApiAuthHeaders() (Bearer when a token resolves, {} otherwise) —
  the unauthenticated bucket is 60 req/hr and an abort kills discovery.

## 147. Bun.semver is inconsistent on ragged versions (2026-08-25)

- Probe: order("1.4","1.4.0") returns 1 (says 1.4 > 1.4.0) while
  satisfies("1.4",">1.4.0") returns false; order("1.4.1","1.4") returns -1
  (1.4.1 < 1.4?!). Missing components are NOT treated as zero in order().
- Rule: normalize BOTH sides to major.minor.patch first (normalizeSemver in
  signal-pipeline.ts pads + strips leading v, null for garbage/prerelease),
  then let Bun.semver.order own the comparison — same SSOT as assertBunAtLeast
  (satisfies). Garbage ("unknown") throws from order() — catch → false.
- Do NOT hand-roll numeric version loops; they drift from Bun's semantics.

## 148. Bun.semver docs review — verified + 2 undocumented behaviors (2026-08-25)

- Verified against the runtime (semver.mdx, bun-v1.4.0): exactly two
  functions (satisfies, order); named import { semver } from "bun" ===
  Bun.semver; all ^ / ~ / x / hyphen-range examples true; order returns
  0/1/-1; prerelease sort order alpha < beta < rc < release; satisfies
  returns false for invalid version/range.
- GAP 1 (dangerous): order() THROWS "Invalid SemVer" on invalid input.
  The bun-types REFERENCE documents it ("Throws an error if either version
  is invalid") but the guide omits it — a guide-vs-reference discrepancy.
  Never feed dirty data to order() as a comparator without try/catch.
- GAP 2: ragged versions are inconsistent across the two functions —
  order("1.4","1.4.0")=1 (1.4 > 1.4.0!) but satisfies("1.4","^1.4.0")
  =false, and even satisfies("1.4","^1.4")=false. Missing components are
  NOT zero-padded. Normalize to major.minor.patch first (normalizeSemver,
  §147) before calling either.
- "20x faster than node-semver" — marketing figure, not verifiable in-repo.

## 149. Bun.semver deep matrix + shared SSOT (2026-08-25)

- OPERATORS verified: > >= < <= = != || (space-AND) ~ ^ x/* hyphen all work
  except "!=" — satisfies("1.0.0","!=1.0.0") is TRUE (should be false) and
  satisfies("1.2.0","!=1.x") is TRUE (should be false): the negation is
  effectively IGNORED on 1.4.0. Pinned in tests; avoid "!=" in ranges
  (express as ">=x <y" or "||"); recheck on upgrade.
- PARTIAL RANGES ok vs RAGGED VERSIONS rejected (asymmetry): ~1.4 / ^1.4 /
  >=1.4 / 1.* satisfy fine with a full version, but a RAGGED VERSION
  ("1.4") fails every range including "^1.4". Always pad the VERSION side.
- order() ragged inflation is systemic: order("1","1.0.0")=1 and
  order("0","0.0.0")=1 — missing components are treated as LARGER, not zero.
- order() details verified: build metadata ignored (1.0.0+a vs +b = 0),
  "v" prefix stripped, leading zeros tolerated ("1.04" vs "1.4" = 0), big
  numbers numeric (1.0.10 > 1.0.9), whitespace trimmed; empty/negative/
  garbage THROW. satisfies accepts StringLike (numbers) per bun-types.
- PRERELEASE matches node-semver: alpha/beta/rc never satisfy non-
  prerelease ranges; explicit prerelease ranges work; rc.1 < rc.2.
- SHARED SSOT: src/lib/semver.ts now owns normalizeSemver (pad),
  semverCore (leading numeric triple), versionGt (Bun.semver.order after
  normalize). Consumers: signal-pipeline docs-drift + scripts/deps-outdated
  (its hand-rolled parseSemver regex is gone). Repo-wide audit of remaining
  Bun.semver sites: assertBunAtLeast (Bun.version — well-formed), massey
  CLIs (same), bun-security-scanner (npm advisory versions) — all feed
  well-formed input; none hit the ragged/invalid hazards.

## 150. Global-attribution code search — 14x cheaper inspect (2026-08-25)

- OLD MODEL (poor design): per-repo scoped queries q="<keyword> repo:A/B"
  for every keyword x every repo — the same literal keywords re-queried
  once per repo: 294 calls for sports-nba (14 repos x 21), ~1029 for
  price-data (49 x 21) against the 10/min code_search platform limit. The
  elaborate preflight / multi-wave / block / stale-fallback machinery
  existed to route around a cost that was keywords x repos.
- NEW MODEL: ONE unscoped query per keyword; hits carry repository.
  full_name (probe-verified wire shape); attributeCodeHits maps them to the
  per-repo { query, totalCount, paths } shape the detectors consume.
  Cost = distinct keywords (~21) PER DIMENSION regardless of repo count.
  sports-nba dry-run: ~21 calls (~3 windows @10/min) vs ~294 (~30 min).
- Equivalence: deriveCodeSignals uses existence + query-marker + hit paths —
  attribution preserves all three. totalCount becomes attributed-hit count
  (capped by MAX_PAGES x 100/keyword; pagination to 4 pages).
- Cache: in-process Map per keyword (cross-dimension reuse in one run);
  per-repo results still persist via the inspect cache.
- Files: src/research/inspect.ts (global fetch
  + attribute), github-rate-limit.ts (estimateCodeSearchCallsPerDimension,
  windows messaging, per-repo chunk guidance removed), cli.ts +
  tools/github-rate-budget.ts messaging, tests (global-code-search, rate-
  limit expectations, inspect.mock attribution, offline-dry-run).
## 111. bun:sqlite surface probed — 9/9 verified, bigint option CORRECTED (2026-08-24)

- The event store + odds + alpha + telegram all ride on bun:sqlite, but
  its compiled-in feature surface was never gated. sqlite:probe
  (tools/sqlite-probe.ts, verify:contracts gate) records what queries
  may safely rely on. VERIFIED 9/9 on 1.4.0 (SQLite 3.51.0):
  1. open/exec/query round-trip
  2. PRAGMA journal_mode=WAL works and PERSISTS across connections
  3. FTS5 virtual tables + MATCH (CREATE VIRTUAL TABLE ... USING fts5)
  4. JSON1 functions (json_extract over a bound JSON string)
  5. prepared statements + NAMED-ONLY binding ({ $x: 1, $y: 2 }) — a
     positional+object mix throws 'Binding expected string, ...'
  6. db.transaction rolls back on throw (0 rows after a failed txn)
  7. CORRECTED: { bigint: true } is NOT honored on this runtime — an
     INTEGER > 2^53 reads back as a LOSSY Number in both modes
     (9007199254740993 -> 9007199254740992). The DatabaseOptions TS
     type does not even declare bigint. Exact large ids must use
     TEXT/BLOB — the repo already does (RFC 9562 uuid strings).
  8. loadExtension present (not exercised — security surface)
  9. sqlite_version() readable
- R2 PROTOCOL PAYOFF: the probe was transported via the safe heredoc
  pattern (double-quoted delimiter, zero single quotes) and ran 9/9 on
  the FIRST try — the first tool written since §110 with no lexer trap.
  The trap-removal protocol works.
- verify:contracts is now 22/22 (parallel work added docs:refresh,
  routes:check, bun:coverage-audit alongside this gate).
- Artifacts: tools/sqlite-probe.ts (new), tests/lib/sqlite-probe.test.ts
  (new), package.json (sqlite:probe), tools/verify-contracts.ts (gate),
  scripts/audit-bun-native.ts (keep-list +1), this section.
  verify:contracts 22/22.
## 112. Bun.serve streaming probed — SSE push pattern grounded (2026-08-24)

- The live dashboard currently POLLS via setInterval; SSE push would
  replace that. serve-stream:probe (tools/serve-stream-probe.ts,
  verify:contracts gate #23 -> 23/23) grounds the pattern. VERIFIED 4/4
  on 1.4.0:

## 151. Global-attribution code search REVERTED — completeness beats cost (2026-08-25)

- §150's global-attribution model (one unscoped query per keyword, hits
  attributed by repository.full_name) was REVERTED after a real-data audit:
  of ~660KB of global hits across all 21 keywords, ZERO referenced any of
  the 14 gated repos. The keywords are common coding tokens (place_order
  335K matches, dry_run 5.1M); GitHub's relevance ranking surfaces huge
  popular repos first, so small trading bots never appear in the top pages
  (search also hard-caps at 1000 results/query). Attributed paths came back
  0 for every repo — code-level signals (fee-aware, risk keywords, v2-in-
  code paths) silently under-reported. The 8.3s run was fast because it was
  finding nothing.
- LESSON: repo-scoped queries (q="<keyword> repo:A/B") are the ONLY way to
  get per-repo content completeness. Cost is 21 x repos — that is the
  honest price of the detector model. Global attribution is sound only for
  keywords whose hit space is small enough that targets rank (none of ours).
- WHAT STAYS (the real wins from the global-attribution code-search work (§150-§151)): the UNIVERSAL code_
  search pacer (github-api.ts paceCodeSearchCall — 9/min token bucket,
  GLOBAL_CODE_SEARCH_NO_PACE=1 for tests), research:resume (run -> wait ->
  rerun; scoped results persist in api_cache so later attempts only fetch
  remaining), the per-repo chunk/waves preflight messaging.
- HYGIENE: the empty-path attributed inspect rows were cached (repo+pushed_
  at) and would have poisoned re-runs for 30 days — cleared manually.
  Reverted files: inspect.ts (scoped searchCode), github-rate-limit.ts
  (estimateCodeSearchCallsPerRepo), cli.ts + tools/github-rate-budget.ts
  messaging, removed global-code-search.ts + global_code_cache + prime CLI.

  1. ReadableStream Response bodies stream INCREMENTALLY — the client
     sees chunks as produced (total time ~= sum of producer sleeps;
     probe: c1c2c3 in 307ms vs 300ms of sleeps).
  2. text/event-stream works over the same mechanism — SSE data lines
     arrive intact (data: one / two / three).
  3. Request bodies iterate with `for await (const chunk of req.body)`
     (POST ab-cd-ef echoed verbatim).
  4. A stream that NEVER closes stays alive across heartbeats — the
     connection is not dropped server-side; the client reads N beats
     then cancels (keep-alive pattern for SSE).
- ADOPTION READY: the live channel could push dashboard updates over
  SSE with a comment-only keep-alive, removing the setInterval poll.
  Note §90: WebSocket publish() backpressure returns 0/-1 — for SSE,
  the equivalent is the writer's backpressure on enqueue (not probed;
  the consumer-side ReadableStream semantics match).
- R2 PROTOCOL: second consecutive tool written protocol-clean (zero
  single quotes, double-quoted heredoc) — 4/4 on the first try.
- Artifacts: tools/serve-stream-probe.ts (new), tests/lib/serve-stream-
  probe.test.ts (new), package.json (serve-stream:probe), tools/verify-
  contracts.ts (gate #23), scripts/audit-bun-native.ts (keep-list +1),
  this section. verify:contracts 23/23.
## 113. Bun.spawn probed — gate behaviors locked (2026-08-24)

- Every gate spawns subprocesses (verify-contracts, pre-commit, run-bun);
  spawn:probe (tools/spawn-probe.ts, verify:contracts gate #24 -> 24/24)
  locks the behaviors. VERIFIED 6/6 on 1.4.0:
  1. proc.stdout is async-iterable — but yields CHUNKS, not lines;
     streaming callers must split on newlines themselves (run-bun uses
     .text() so it is unaffected).
  2. env: overrides merge over the parent environment (inherit + add).
  3. timeout kills the child with SIGTERM (exitCode 143 = 128+SIGTERM;
     probe: 305ms for a 300ms timeout).
  4. a signal-killed child reports exitCode=null + signalCode=SIGTERM —
     the exitCode/signal distinction is real.
  5. cwd is honored.
  6. spawnSync captures stdout and stderr separately with exitCode.
- Gotcha for future streaming gates: chunk != line — use
  line-splitting when consuming proc.stdout incrementally.
- Artifacts: tools/spawn-probe.ts (new), tests/lib/spawn-probe.test.ts
  (new), package.json (spawn:probe), tools/verify-contracts.ts (gate
  #24), scripts/audit-bun-native.ts (keep-list +1), this section.
  verify:contracts 24/24.
## 114. Bun.serve WebSocket surface probed — live channel ground truth (2026-08-24)

- The live channel + live page + tennis orderbook ride on Bun.serve
  WebSockets; ws:probe (tools/ws-probe.ts, verify:contracts gate #25 ->
  25/25) locks the surface. VERIFIED 7/7 on 1.4.0:
  1. upgrade({ data }) -> the open handler receives the data object
     (per-connection context rides the upgrade).
  2. text messages arrive as string; send() echo round-trips.
  3. binary messages arrive as Uint8Array (both directions).
  4. server ws.ping() -> the client AUTO-pongs -> the server pong
     handler fires (no manual pong needed).
  5. ws.close(code) -> the server close handler receives the code.
  6. an upgrade REFUSED by returning a Response (403) leaves the client
     in the CLOSED state — validation-by-response works.
  7. server.publish broadcasts to topic subscribers — INCLUDING the
     publishing socket if it subscribed (self-publish echo: the probe
     first failed P2 because the publish reached the publisher; the fix
     ordered the tests so the echo completes before the broadcast).
     publish returns the subscriber count (publish=9 in the probe).
- TS lag note: upgrade { data } and ws.data are typed undefined in the
  current types — cast as any/unknown-as (the runtime honors them; the
  types lag, like the sqlite bigint option §111).
- Artifacts: tools/ws-probe.ts (new), tests/lib/ws-probe.test.ts (new),
  package.json (ws:probe), tools/verify-contracts.ts (gate #25),
  scripts/audit-bun-native.ts (keep-list +1), this section.
  verify:contracts 25/25.
## 115. API-table audit — Bun.semver/JSON5 verified, two rows CORRECTED (2026-08-24)

- A pasted Bun v1.4 API table was audited row by row. Most rows were
  ALREADY probed/adopted in-repo (WebView, Image, CSRF, secrets, cron,
  XML, Glob, Cookie/CookieMap, inspect — §24-§114). Four needed action:
  two NEW probes and two CORRECTIONS, locked in bun:apis-probe
  (verify:contracts gate #26 -> 26/26), VERIFIED 4/4:
  1. Bun.semver is a GLOBAL { satisfies, order } — the docs link implies
     a module, but import 'bun:semver' FAILS (Cannot find package).
     satisfies('1.2.3', '^1.0.0') === true; order('2.0.0','1.9.0') > 0.
  2. Bun.JSON5 is a GLOBAL: parse handles comments, trailing commas and
     unquoted keys; stringify emits compact unquoted-key JSON5.
  3. CORRECTED: the table's 'Bun.sha — SHA-256' label is wrong. Bun.sha
     EXISTS and is SHA-512/256 (hex of 'abc' matches the sha512-256
     vector; default returns Uint8Array) — the repo already corrected
     this in §24; the table regressed it.
  4. CORRECTED: the table's 'Temporal — not yet natively shipped' is
     FALSE. Temporal is enabled by default on 1.4.0 (typeof object,
     Instant callable) — verified in §88 and adopted in §89.
- Lesson: a plausible API table from an LLM summary carries regressions
  (Bun.sha's algorithm, Temporal's availability) and invention (the
  'bun:semver' module). Row-by-row probing against the runtime is the
  only ground truth — same discipline as §95's operator-manual audit.
- Artifacts: tools/bun-apis-probe.ts (new), tests/lib/bun-apis-probe.
  test.ts (new), package.json (bun:apis-probe), tools/verify-contracts.ts
  (gate #26), scripts/audit-bun-native.ts (keep-list +1), this section.
  verify:contracts 26/26.
## 116. ws:probe deep-dive audited — pong payload verified, three claims corrected (2026-08-24)

- A pasted deep-dive on ws:probe was audited against the actual probe +
  runtime. Corrections and additions:
  1. FALSE: 'each test runs against a fresh Bun.serve() instance' — the
     probe uses ONE server for all checks (state is per-check via the
     seen array, not per-instance).
  2. VERIFIED: the pong handler RECEIVES the ping payload —
     pong(ws, data) gets the bytes (probe: ping('pay') ->
     'pong-payload:pay'). ws-probe extended to 8/8 (P8).
  3. FALSE: server.connections does NOT exist on 1.4.0 (probe:
     undefined). The writeup's ping-interval design (for-of
     server.connections) would fail — sockets must be tracked manually
     (open handler registers, close removes).
  4. §111 mischaracterized: the sqlite bigint issue is NOT only a type-
     lag — the RUNTIME ignores the option too (lossy Numbers in both
     modes). The types AND the runtime lag together.
  5. Bun.serve DOES accept an http2 option (probe: serve({http2:true})
     starts and responds) — the earlier API table's 'http1 and http3
     options' naming was wrong. Real h2 negotiation needs TLS; not yet
     probed (next-step list, §115/§116).
  6. Gate count: 26 (the writeup said 25; bun:apis-probe §115 followed).
- SPORTSBOOK DESIGN NOTES (grounded, kept for the pipeline): ws.data
  for per-book context; publish-inclusive gotcha -> dedupe by message id
  or publisher flag in the handler; close codes for policy/error;
  keep-alive via MANUALLY tracked sockets (server.connections absent).
- Artifacts: tools/ws-probe.ts (P8, 8/8), tests/lib/ws-probe.test.ts
  (8/8), this section. verify:contracts 26/26.
## 117. Bun.Image API correction probed — every claim VERIFIED, probe extended (2026-08-24)

- A pasted Bun.Image API correction (per-format encode methods,
  constructors, metadata, modulate, flip/flop, extension-inferred format)
  was probed claim-by-claim against 1.4.0 (macOS arm64). ALL VERIFIED;
  image-probe extended P15-P22 -> 35/35:
  - constructors: new Image(path) and new Image(bytes) both work;
    Bun.file().image() already verified (§70)
  - metadata {width,height,format}: format reflects the SOURCE (the
    correction's 'jpeg' example was their input; the fixture is png)
  - resize(width) single-arg keeps aspect (2x1 -> 10x5)
  - rotate enforces multiples of 90 — rotate(45) throws 'rotate: only
    multiples of 90 are supported'
  - flip (vertical) + flop (horizontal) both exist
  - modulate({ brightness, saturation }) works (0 = greyscale)
  - per-format encode: .jpeg -> ffd8 magic; .png compressionLevel +
    palette/colors/dither accepted; .webp lossless -> RIFF-WEBP-VP8L,
    .webp quality -> VP8 (codec chunk distinguishes)
  - EXTENSION-INFERRED FORMAT: write(path) with NO encode method uses
    the destination extension (.jpg -> JPEG bytes) — verified
  - terminals bytes/buffer/blob/toBase64/dataurl/write already locked
    (§70)
- PROBE-SIDE BUG RECORDED: comparing bytes via Uint8Array.toString()
  gives comma-joined numbers ('82,73,70,70'), not text — my first run
  reported 'no-riff' on a VALID RIFF-WEBP-VP8L. Use TextDecoder for
  magic-byte checks.
- ALSO: `Image` must be imported from 'bun' — the DOM global
  HTMLImageElement shadows it otherwise (tsc + runtime both misresolve).
- Artifacts: tools/image-probe.ts (P15-P22, 35/35), this section.
  verify:contracts 26/26 (image:probe count grew within its gate).
## 125. fetch h2 version history — NOT a 1.4 feature (correction, user-flagged) (2026-08-24)

- User-flagged: 'in v1.3.14 you could use fetch(url, { protocol:
  "http2" })'. CORROBORATED by the repo's own records:
  - docs/bun-v1.3.14-catalog.md row 8: fetch protocol "http2" VERIFIED
    on 1.3.14 — typed @experimental, union "http2" | "http1.1" | "h2"
    | "h1", flag --experimental-http2-fetch confirmed in --help (e2e
    was sandbox-network-blocked back then, so the SURFACE was verified,
    not the round-trip).
  - §14 records both eras: 1.3.x 'plain fetch negotiates http/1.1 by
    default — h2 requires --experimental-http2-fetch'; 1.4.0 the
    per-request protocol:'http2' works unflagged (e2e-verified against
    node:http2, §14 fetch-pool-h2).
- So the 1.4 blog's 'fetch() now supports HTTP/2 and HTTP/3'
  OVERSTATES recency for h2 — per-request h2-fetch predates 1.4
  (1.3.14 surface). The 1.4 addition is HTTP/3 fetch
  (--experimental-http3-fetch / Alt-Svc upgrade; h2/h3 flags both still
  in bun --help on 1.4.0).
- Version story (precise): 1.3.14 = per-request h2 option typed +
  global flag, surface-verified; 1.4.0 = per-request h2 e2e-verified
  unflagged over TLS, h3 fetch added (flag-gated Alt-Svc upgrade),
  Bun.serve h2 still absent (docs + runtime, §123/§124).
- Artifacts: this section. verify:contracts 28/28.

## 124. serve-h2 correction triple-confirmed — docs + blog + runtime (2026-08-24)

- Challenged to re-check §123's serve-h2 correction against the docs
  and release blog. Result: the correction stands, now triple-grounded:
  1. BLOG (cached bun-blog.html): the 1.4 blog's HTTP/2 claim is about
     FETCH — 'fetch() now supports HTTP/2 and HTTP/3. Pass protocol:
     "http2"'. For Bun.serve it only claims 'HTTP/3 in Bun.serve()
     (experimental) — Set http3: true next to tls, and Bun listens on
     UDP on the same port' (h1.1 keeps working over TCP). The §115
     table's 'Bun.serve supports HTTP/2 via the http2 option' was
     INVENTED — the blog never said it.
  2. OFFICIAL SERVE DOCS (fetched bun.sh/docs/runtime/http/server):
     http3: true documented ('HTTP/3 requires TLS'); http2: ABSENT —
     the string 'http2' does not occur on the page. idleTimeout is
     documented; maxRequestBodySize and the error() option are NOT on
     the guide page (they work at runtime — verified §123 P4/P5 — and
     may live on the reference page; runtime evidence is authoritative
     either way).
  3. RUNTIME (probe §123 P2): serve({ http2: true, tls }) is ACCEPTED
     but serves HTTP/1.1 only — Bun fetch protocol http2 fails with
     HTTP2Unsupported, node:http2 client fails with 'h2 is not
     supported'. The accepted-but-vestigial option is undocumented.
- The probe's negative-behavior pin is the right call: it self-
  invalidates if a future Bun release actually delivers serve h2.
- Artifacts: this section. verify:contracts 28/28.

## 123. serve-tls:probe — TLS works, http2 option is a NO-OP (CORRECTED) (2026-08-24)

- Closed the §116/§120 next-step (real TLS + h2/h3). serve-tls:probe
  (verify:contracts gate #28 -> 28/28), VERIFIED 5/5:
  1. TLS serve works; the scheme comes from req.url (https:), NOT a
     req.scheme property (that is undefined).
  2. CORRECTED: serve({ http2: true }) does NOT negotiate h2 on 1.4.0.
     The option is ACCEPTED and the server serves HTTP/1.1 over TLS,
     but Bun's own fetch with protocol:'http2' fails with
     HTTP2Unsupported, and a node:http2 client fails with 'h2 is not
     supported'. Pinned as a negative-behavior check (self-invalidates
     when Bun fixes ALPN). The §115 table's 'HTTP/2 via the http2
     option' and the blog's h2 framing are overstated for serve; the
     repo's fetch-pool h2 CLIENT works against node:http2 servers (§14)
     — the gap is the SERVER side.
  3. http3:true + TLS: the server STARTS and serves (default fetch
     gets a response; actual QUIC transport not asserted — no h3
     client). The serve TS types declare http3 but NOT http2 — the
     type hint ('did you mean http3?') confirms http2 is untyped.
  4. maxRequestBodySize enforced: small POST 200, oversized -> 413.
  5. serve error() handler fires on a handler throw (custom 500).
- tsc evidence: 'http2 does not exist in type ... did you mean http3'
  — the runtime accepts it but the types omit it (another types-lag
  case, but here the runtime ALSO doesn't deliver h2, so the types are
  honest).
- Artifacts: tools/serve-tls-probe.ts (new), tests/lib/serve-tls-probe.
  test.ts (new), package.json (serve-tls:probe), tools/verify-contracts.
  ts (gate #28), scripts/audit-bun-native.ts (keep-list +2), this
  section. verify:contracts 28/28.

## 122. routes:probe — Bun.serve routes API locked, non-working forms pinned (2026-08-24)

- routes:probe (verify:contracts gate #27) locks the routes surface the
  repo's serve.ts runs on. VERIFIED 11/11 on 1.4.0:
  1. exact routes; 2. named params (:id -> req.params.id);
  3. wildcard /*: params is EMPTY — handlers read req.url (intact);
  4-7. dir routes: content-type + accept-ranges:bytes + ETag +
     Last-Modified + Content-Length on files, Range -> 206 +
     Content-Range, index.html for dirs, built-in EMPTY 404 for missing;
  8. fetch fallback for unmatched paths (routes + fetch compose).
- NOT WORKING on 1.4.0 (pinned so the repo never relies on them):
  9. METHOD-PREFIXED route keys: serve({ routes: { 'GET /m': ... } })
     THROWS 'Invalid route "GET /m". Path must start with /' — method
     filtering must happen in the handler via req.method.
  10. dir-route error/headers options NOT honored (missing file -> the
      built-in empty 404; custom headers ignored). The DirectoryRoute-
      Options TS type does not declare them either.
  11. SPA-fallback nested routes ({ dir, routes: { '/*': handler } }) NOT
      honored — a deep path under the dir returns EMPTY. SPA fallback
      must live in the fetch handler.
- The repo's own patterns (exact + { dir } + fetch fallback, §87/§118)
  are exactly the supported subset — serve.ts is correct as-is.
- tsc confirms the runtime: the TS types for DirectoryRouteOptions do
  not declare error/headers/routes (both casts needed).
- Probe nuance: the first verify run showed a transient failure (11/11
  isolated, 11/11 on re-run) — a port-0 fetch race under parallel gate
  load; documented transient pattern.
- Artifacts: tools/routes-probe.ts (new), tests/lib/routes-probe.test.ts
  (new), package.json (routes:probe), tools/verify-contracts.ts (gate
  #27), scripts/audit-bun-native.ts (keep-list +1), this section.
  verify:contracts 27/27.

## 121. node:quic listen() pinned non-functional — deep QUIC probe (2026-08-24)

- §120 verified the node:quic MODULE surface. Deeper probe of the
  actual API: listen() is NOT functional on 1.4.0:
  - listen({}) throws 'the callback argument must be of type function'
  - listen(cb) RETURNS and the script CONTINUES (the marker prints),
    then the process ABORTS asynchronously at internal:quic/quic:2811
    with exit 1 — a hard crash, not a catchable error. A QUIC server
    cannot be started; a full round-trip is impossible.
  - connect({}) accepts an options object (no throw) — but no server
    can answer, so no handshake.
  - The blog's 'the full experimental Node v26 API is covered: listen()
    and connect()' is OVERSTATED for the listen path on this runtime.
- P8 PINS the crash as a NEGATIVE-BEHAVIOR gate check: the probe spawns
  a child that calls listen(cb), asserts the child exits 1, with a 5s
  timeout guard so a future FIXED listen (which would keep the process
  alive) cannot hang verify:contracts — instead the check fails and
  demands re-probing. This turns a broken vendor claim into a tracked
  runtime fact that self-invalidates when Bun fixes it.
- Probe nuance recorded: the crash is ASYNC — the child prints its
  marker BEFORE aborting, so 'did the marker print?' is the WRONG
  assertion; 'did the process exit 1?' is right.
- bun:apis-probe P5-P8 -> 8/8 (gate #26). Keep-list +1 (P8 spawns).
- Artifacts: tools/bun-apis-probe.ts (P8), tests/lib/bun-apis-probe.
  test.ts (8/8), scripts/audit-bun-native.ts (keep-list), this section.
  verify:contracts 26/26.

## 120. Blog anchor 'replay / quic' probed — node:quic + serve http3 verified (2026-08-24)

- The URL anchor (replay / newly passing tests / quic) points at the
  blog's interactive 'newly passing tests' CHART — '↻ replay' is the
  chart's UI replay button, NOT a Bun runtime feature. The real claim
  behind the anchor is node:quic.
- node:quic VERIFIED on 1.4.0: import 'node:quic' exports
  QuicEndpoint, QuicError, QuicSession, QuicStream, connect, listen,
  constants (the experimental Node v26 API, per the blog) — with an
  ExperimentalWarning. Bun.Quic is UNDEFINED — QUIC lives in the
  node:quic module, not a Bun global.
- serve http3 option VERIFIED: Bun.serve({ http3: true }) is a REAL
  option — it errors 'HTTP/3 requires tls to be set' when TLS is
  absent (the option is recognized; it needs a cert). This confirms the
  blog's 'vendors lsquic for HTTP/3' and corrects the §115 table's
  naming: http2 + http3 options exist; 'http1' was the invented one.
- The chart's numbers (node:quic 235/237 tests, +235 from 0) are
  vendor comparative benchmarks against Node's own test suite —
  labeled marketing, not probeable in-repo (same discipline as §88).
- bun:apis-probe extended P5-P7 -> 7/7 (verify:contracts gate still
  #26). tsc gotcha: top-level await needs module context — added
  'export {}' to the probe script.
- Artifacts: tools/bun-apis-probe.ts (P5-P7, 7/7), tests/lib/bun-apis-
  probe.test.ts (7/7), this section. verify:contracts 26/26.

## 119. Release-blog mp4s — why NOT to adopt them (probed, §118 follow-up) (2026-08-24)

- The 1.4 blog DOES contain real mp4s (probe: 4 terminal demos, all
  fetchable 200 video/mp4): bun-audit-fix.mp4 (2.4 MB), bun-dedupe.mp4
  (2.7 MB), bun-prune.mp4 (2.0 MB), spawn-cgroup.mp4 (7.4 MB) — ~14.5
  MB total, at /images/blog/bun-1.4/tweets/*.mp4.
- WHY NOT TO ADOPT INTO public/videos/ (the user's suggestion, probed
  and assessed):
  1. OWNERSHIP: they are Bun's vendor demo recordings of the audit/
     dedupe/prune/cgroup commands — marketing content for bun itself,
     not content about the Kalshi-bot pipeline. The dir route serves
     whatever is dropped in; serving vendor marketing videos on this
     repo's public server is misattributed content with no license
     grant for redistribution.
  2. BLOAT: ~14.5 MB committed to a lean, offline-first repo; the
     assets/content gates assume repo-owned content.
  3. PURPOSE: the video surface (video-page.ts, isVideoFile, ops-
     videos signal) exists for REPO-generated captures, not bun
     command demos.
- WebView CANNOT generate video (probe): Bun.WebView methods are
  navigate/evaluate/screenshot/cdp/click/type/press/scroll/scrollTo/
  resize/goBack/goForward/reload/close + url/title/loading/onNavigated/
  onNavigationFailed — SCREENSHOT only, no recording. The videos dir
  stays empty until a real capture need exists; a future demo video
  must come from external screen capture or an HLS source, not WebView
  and not vendor clips.
- The suggestion DID prove something: the serving contract accepts a
  real multi-MB video/mp4 through the exact Range/206/seek path locked
  in §118 — the pipeline is genuinely production-ready for repo-owned
  content whenever one exists.
- Artifacts: this section (+ DESIGN-PIPELINE video note).
  verify:contracts 26/26.

## 118. Bun 1.4 blog replayed via claims-audit + mp4/assets review (2026-08-24)

- REPLAY: ran bun:claims-audit against the cached 1.4 blog with the
  session's verified claim strings — 6/8 FOUND (Compile-time feature
  flags, Bun.Image, Bun.XML, WebSocket, zlib-ng, 320 ms) and the two
  canonical fabricated numbers correctly NOT FOUND (535,496 lines, 64
  Claude agents; exit 1 is the tool's designed 'likely fabricated'
  signal). The blog is the ground truth every probe this session was
  derived from; the audit still rejects invented numbers.
- MP4/ASSETS REVIEW: public/videos/ contains NO video files (README
  only) — the ops-videos signal counts zero; the video surface is
  asset-less. The SERVING CONTRACT is verified for a real file: a
  served .mp4 gets video/mp4 content-type, Range bytes=0-99 -> 206 +
  Content-Range bytes 0-99/1032 with exactly 100 bytes, and mid-file
  seek (bytes=500-599) works — the prerequisites for a <video> element
  with seeking. Locked in tests/research/video-serving.test.ts (3
  tests, self-contained scratch fixture, no baked artifacts).
- GOTCHA (probe): the dir-route syntax is routes: { "/videos/*": { dir } }
  — the { dir } wrapper is required; routes: { "/videos/*": path }
  throws. Confirmed against serve.ts + defaults-probe §87 usage.
- ACTION: the video pipeline is production-ready but empty — dropping
  real .mp4 assets into public/videos/ will serve them with correct
  types + seeking out of the box.
- Artifacts: tests/research/video-serving.test.ts (new), this section.
  verify:contracts 26/26.
## 126. Bun.cron granularity + overlap — 5-field only, no self-overlap (2026-08-24)

- CORRECTED: Bun.cron is 5-field ONLY (minute hour day month weekday).
  A 6-field expression throws 'Invalid cron expression: too many fields.
  Bun.cron uses 5 fields' — at BOTH Bun.cron() registration AND
  Bun.cron.parse(). Seconds are unsupported. The repo's schedules
  (cron-main §99, finance-cron, partner cron) are all 5-field and
  correct; any future sub-minute cron attempt fails loudly.
- VERIFIED (2.5-min probe, 60s interval + 90s job over a 140s window):
  a job running LONGER than its interval does NOT run concurrently with
  itself — fires=1, max concurrent=1, overlap=false. The missed fire is
  neither queued behind the running job nor fired early.
- Implication: cron-main's single-flight wrapper (createSingleFlight,
  docs/CRON.md "single-flight, drains on graceful shutdown") is
  DEFENSE-IN-DEPTH against self-overlap rather than strictly required —
  it also guards cross-process/multi-tick races, so it stays.
- The skip-vs-defer policy for the missed fire was ambiguous in the 140s
  window (fires stayed 1 after the job finished at ~90s); resolving it
  needs a 4+ min probe — not worth it for minute-scale jobs.
- Locked in tests/scripts/audit-overlay-cron.test.ts: 6-field rejection
  at both entry points + a 5-field parse round-trip.
- Artifacts: tests/scripts/audit-overlay-cron.test.ts (+1 test), this
  section. verify:contracts 28/28.
## 127. Bun Shell — $ from "bun" (not global), 12-claim surface verified (2026-08-24)

- VERIFIED (tools/shell-probe.ts, gate #29, 12/12): Bun Shell is real on
  1.4.0 and its docs' primary API matches the runtime. NOTE: there is NO
  global shell namespace — the type Shell is exported from the "bun" module and
  the runtime exposes Shell/ShellPromise/ShellError as props on the $
  function (docs:api tokenizes the dotted form and rejects the token
  Shell, which bun-types does not declare as a global).
- $ is NOT a global — must import { $ } from "bun". The $ function
  also carries props: Shell, ShellPromise, ShellError, braces, escape.
- Capture methods chain BEFORE await: await $cmd.text() / .json() /
  .bytes() / .lines() / .quiet(). Awaiting a bare $cmd with no capture
  method INHERITS stdout to the parent (docs: "By default, shell
  commands print to stdout").
- .quiet() yields { stdout: Buffer, stderr: Buffer, exitCode }; .text()
  returns string with trailing newline; .bytes() -> Uint8Array.
- Non-zero exit THROWS ShellError { exitCode, stdout, stderr } by
  default; .nothrow() per-promise AND $.nothrow() global toggle both
  work.
- .lines() is an ASYNC ITERABLE — for await (const line of $...lines()).
  NOT a plain array: awaiting it directly yields {} (a trap; check the
  docs' for-await form before use).
- stdin: < ${Response} and < ${Buffer} work; a plain JS string is
  treated as a FILE PATH (bun: No such file or directory) — the docs
  list only Buffer/typed-array/Response/Bun.file as stdin sources.
- Interpolation is AUTO-ESCAPED and injection-safe: echo ${"a$(touch
  x)"} yields the literal string, no file created.
- .cwd(), .env(), stderr separation (2>&1), and $.escape/$.braces
  helpers all verified. bun --version passthrough works.
- Repo note: Bun Shell is a viable replacement for Bun.spawnSync in
  audit tooling (cleaner cwd/env/escape), but nothing was migrated
  this round — spawn:probe contract stays authoritative for spawn.
- Artifacts: tools/shell-probe.ts (new, gate #29), tools/verify-contracts.ts
  (28 -> 29 gates), package.json (shell:probe script). verify:contracts
  29/29.
## 128. Bun.cron missed-fire policy — SKIP (lost, not deferred) (2026-08-24)

- RESOLVED (§126's open question): a scheduled fire that lands while the
  job is still running is DROPPED — it does not run at job end, and the
  next fire is the following minute slot.
- Probe (scratch/cron-defer.ts, 210s window, 60s interval + 95s job):
  fire1 at t=0.8s, job1-end at t=95.8s, next fire at t=120.8s (exactly
  fire1 + 120s — the slot AFTER the missed one at +60s). Fires stay on
  exact minute boundaries (fire-to-fire delta 60000ms).
- §126's 140s window was underpowered: it ended (~140s) before job1
  finished (~155s from registration), so only fire1 had occurred and
  skip-vs-defer looked ambiguous. With the full window the policy is
  unambiguous.
- Implication: Bun.cron drops a tick that collides with a running job.
  For time-sensitive ticks (finance-cron, sports metadata) keep job
  duration well under the interval; single-flight cannot recover a
  dropped tick because the drop happens inside the runtime before the
  wrapper runs. If a tick must never be lost, the job itself should
  re-check elapsed time and run a catch-up pass on the next fire.
- Artifacts: this section. verify:contracts 29/29 (shell gate #29 added
  in §127).
## 129. HTML imports, standalone-HTML builds, HTMLRewriter — 14-claim surface (2026-08-24)

- VERIFIED (tools/html-probe.ts, gate #30, 14/14, fully offline): the
  docs' HTML surface matches the 1.4.0 runtime. Fixtures are generated
  at gate-run time into scratch/html-fixture (gitignored).
- TEXT IMPORT: import raw from "./x.html" with { type: "text" } yields
  the raw HTML string (guides/runtime/import-html).
- HTML IMPORT: a plain import of .html yields an HTMLBundle with .index
  (string); .files is undefined at runtime import (only populated when
  built ahead of time). The HTMLBundle type is INTERFACE-ONLY — there is
  NO runtime global constructor (typeof undefined) and no dotted
  namespace member (bun-types exports the type from the bun module, so
  docs:api rejects the token); the type describes the import result.
- STANDALONE BUILD: Bun.build({ entrypoints: [html], compile: true,
  target: "browser" }) emits ONE self-contained .html: JS inlined as
  <script type="module">, CSS as <style>, images/fonts as data: URIs
  (base64), no relative refs left. Source-path comments are retained in
  the output (e.g. /* scratch/html-fixture/style.css */) — harmless.
- HTML-STATIC BUILD: non-compile Bun.build with an .html entry emits
  chunk-<hash>.js + chunk-<hash>.css + hashed assets (logo-<hash>.png)
  + a rewritten index.html referencing them (crossorigin).
- HTMLRewriter is a GLOBAL (lol-html based): transform(string) ->
  string; transform(Response) -> RESPONSE (call .text() on the result);
  on(selector, handlers) supports element handlers (setAttribute,
  before/after with { html: true }, remove, tagName setter) and text
  handlers. Useful for pipeline HTML rewriting (e.g. preprocess the
  design-system meta HTML before serving).
- HTML IMPORT AS SERVE ROUTE: routes: { "/": page } compiles per
  request — HTML references / _bun/asset/<hash>.css and
  / _bun/client/index-<hash>.js chunks, and injects a dev-client script
  (data-bun-dev-server-script) + a visibilitychange sendBeacon to
  / _bun/unref EVEN in a plain Bun.serve (not just the CLI dev server).
- CLI DEV SERVER: bun ./index.html prints "ready in ~2.5ms, url:
  http://localhost:3000/" (default port 3000; --port is a GLOBAL flag:
  bun --port 3999 ./index.html). GOTCHA: it binds IPv6 ::1 ONLY —
  curl http://localhost:3999/ works, curl http://127.0.0.1:3999/ fails
  (000). SPA FALLBACK verified: any path (e.g. /about) returns the same
  compiled HTML (200 text/html) — the docs' client-side-router claim.
- Repo note: the frontend-module story (mtafile/design-system meta) can
  lean on standalone-HTML builds (single-file artifacts) + HTMLRewriter
  for preprocessing; nothing migrated this round.
- Artifacts: tools/html-probe.ts (new, gate #30), tools/verify-contracts.ts
  (29 -> 30 gates), package.json (html:probe script). verify:contracts
  30/30.
## 130. Bundler internals — splitting, macros, env inlining, plugins (2026-08-24)

- VERIFIED (tools/build-deep-probe.ts, gate #31, 10/10, fully offline
  + self-contained; fixtures generated at runtime into scratch/build-deep).
- SPLITTING: splitting: true with multiple entrypoints emitting one
  shared chunk (chunk-<hash>.js) containing the shared module ONCE;
  without splitting the shared code is duplicated into each entry
  output. Docs (bundler/index) claim correct.
- MACROS: import { fn } from "./m.ts" with { type: "macro" } — the
  FUNCTION CALL is evaluated at bundle time and the result inlined as a
  literal (var r = "MAGIC_7_191337";); the macro source is absent from
  the bundle (no Math.random, no magic() call). The assert { type:
  "macro" } form behaves identically. Docs (bundler/macros) correct.
- CORRECTION (P2b): macro CONST exports are NOT inlined. A bundle using
  an imported macro const (TABLE.b) keeps the reference with NO
  definition — the build succeeds but the output throws ReferenceError:
  TABLE is not defined at runtime (same in source-run). Only macro
  FUNCTION CALLS are replaced; consts must be returned from a function.
- ENV INLINING: env: "PUBLIC_*" replaces literal process.env.FOO refs
  at build time (prefix-matched); non-matched refs stay process.env.*
  at runtime. VERIFIED via CLI (--env=PUBLIC_*) and API with the var in
  the process STARTUP environment.
- CORRECTION (P3, pinned): Bun.build env inlining reads the process
  STARTUP environment — process.env.X = ... mutations made at runtime
  are NOT seen by the inliner (output keeps process.env.FOO). A future
  fix would flip the gate.
- PLUGINS: onStart/onEnd fire once per build; onResolve + onLoad with
  namespace filters implement virtual modules (import { V } from
  "virt:data") — loader: "js" + contents returned by onLoad are bundled
  and the virtual source is absent from output. Plugin API is a subset
  of esbuild's (docs note pluginData/pluginName unsupported).
- Repo note: macros could run the design-system meta pipeline pieces at
  bundle time (no runtime cost), but macro consts are a trap — return
  values from functions only.
- Artifacts: tools/build-deep-probe.ts (new, gate #31), tools/verify-contracts.ts
  (30 -> 31 gates), package.json (build-deep:probe script). verify:contracts
  31/31.
## 131. Filesystem layer — Bun.file/Bun.write, zlib+zstd, mmap, loaders, Archive (2026-08-24)

- VERIFIED (tools/fs-probe.ts, gate #32, 20/20, fully offline +
  self-contained; fixtures + loader imports via dynamic import after
  writes).
- Bun.file is lazy + Blob-conformant: size/type/text/bytes/json()/
  stream() all correct; a missing file reports size 0, default type
  text/plain;charset=utf-8, exists() false; type override appends
  ;charset=utf-8. .slice(start,end) reads offsets. .delete() works.
- Bun.write: returns byte count, OVERWRITES + truncates (writing "xy"
  over "abcdef" leaves "xy"); accepts string, Response body, and
  BunFile source (copy) — all verified.
- COMPRESSION (1.4.0 surface = the four *Sync zlib forms ONLY):
  gzipSync/gunzipSync, deflateSync/inflateSync round-trip. NO async
  gzip/gunzip forms (typeof undefined on the dotted names — docs:api
  rejects them) and NO brotli functions (brotliCompressSync/
  brotliDecompressSync undefined — brotli exists only as a
  CompressionFormat enum value). bun-types agree (no drift).
  NOTE: these return Uint8Array — decode with TextDecoder, not
  .toString().
- zstd: zstdCompressSync/zstdDecompressSync AND async zstdCompress/
  zstdDecompress all exist and round-trip (zstd is the only algorithm
  with async forms).
- Bun.mmap(path): returns Uint8Array<ArrayBuffer>, length = file size,
  .slice() reads at offsets.
- RUNTIME LOADER IMPORTS (docs claim runtime supports the bundler file
  set — VERIFIED): import .toml -> object, .yaml -> object, .json5 ->
  object, .xml -> { root: {...} }, .md -> string, .txt -> string. No
  plugins needed.
- Bun.stdout/Bun.stderr/Bun.stdin are Blob instances (BunFile).
- CORRECTION (P19, pinned): Bun.Archive.write(path, { name: BunFile })
  archives the entry as 0 BYTES — silent data loss (system tar
  confirms a 0-size entry). String content archives correctly
  (20 bytes, extract round-trips). Read path: new Archive(bytes) has
  files/entries undefined; extract(dir) writes whatever was archived.
  On 1.4.0 archive files with STRING/Buffer content, never BunFile
  values; re-probe before relying on Archive for real assets.
- Repo note: the video/assets pipeline uses Bun.file bodies for serving
  (fine); do NOT use Bun.Archive for packaging assets until the
  BunFile-content bug is fixed.
- Artifacts: tools/fs-probe.ts (new, gate #32), tools/verify-contracts.ts
  (31 -> 32 gates), package.json (fs:probe script). verify:contracts
  32/32.
## 132. 100%-coverage goal round 1 — matrix + ANSI + crypto clusters (2026-08-24)

- DELIVERABLE: docs/BUN_API_COVERAGE.md — the full matrix of the 102
  `Bun.*` tokens the repo uses, with Runtime (typeof on 1.4.0),
  Types (bun-types 1.4.0), Docs (installed mdx), Gate, and Uses
  columns. 73 runtime values + 29 type-only/non-existent (the latter
  already pinned by docs-api-validate INTENTIONAL + tests). The goal:
  zero GAP rows. Started at 47 runtime gaps; this round closes 12.
- ansi:probe (gate #33, 17/17): color/inspect/escapeHTML/stringWidth/
  stripANSI/sliceAnsi/wrapAnsi — shapes the repo relies on.
  - Bun.color is doc-correct: css returns the MOST COMPACT form (a
    named color when one exists — #ff0000 -> "red"); ansi AUTO-
    DETECTS terminal depth from stdout env and returns "" when stdout
    has no color support (probe runs under a non-color shell -> "");
    use ansi-16m / ansi-256 / ansi-16 to target a specific depth.
    number/hex/HEX/{rgba} formats verified (red -> 16711680 /
    #ff0000 / #FF0000 / {r:255,g:0,b:0,a:1}). Invalid input -> null.
  - Bun.inspect options verified: { colors } adds ANSI, { depth }
    truncates with [Object ...], { sorted } sorts keys.
  - escapeHTML escapes < > & " to &lt; &gt; &amp; &quot;.
  - stringWidth: ascii 1 per char, CJK 2 per char, strips ANSI codes
    before measuring; stripANSI removes codes; sliceAnsi slices by
    width KEEPING the ANSI codes; wrapAnsi wraps at width with \n.
- crypto:probe (gate #34, 11/11): CryptoHasher/SHA256/hash/deepEquals/
  randomUUIDv7.
  - new Bun.CryptoHasher("sha256").update("abc").digest("hex") ==
    ba7816bf... (repo's assets-audit/docs-audit pattern). Streaming
    update() equals one-shot. digest() default -> Uint8Array (32 bytes
    for sha256). md5/sha1/sha256/sha512 constructors work.
  - GOTCHA (shape): CryptoHasher.digest() is DESTRUCTIVE — a second
    digest() without re-update returns the hash of EMPTY input; a
    later update() restarts fresh from that update. Call digest once.
  - Bun.SHA256 is a class with update/digest/byteLength (also
    sha256-style usage).
  - Bun.hash(str) -> bigint (defaults-probe D8b); seeded hash differs.
  - Bun.deepEquals deep compare + 3rd arg accepted (repo passes true
    in generate-color-artifacts).
  - Bun.randomUUIDv7() -> v7 UUID (version nibble 7 at index 14);
    timestamp validation (> 2^48 throws) pinned in breaking-audit.
- Artifacts: docs/BUN_API_COVERAGE.md (new), tools/ansi-probe.ts (new,
  gate #33), tools/crypto-probe.ts (new, gate #34), tools/verify-contracts.ts
  (32 -> 34 gates), package.json (ansi:probe, crypto:probe).
  verify:contracts 34/34. Remaining runtime gaps: 35 (format/fsx/net/
  runtime-misc clusters — next rounds).
## 133. Coverage goal round 2 — format + fsx clusters (2026-08-24)

- format:probe (gate #35, 12/12): TOML/YAML/JSONC/JSONL/XML/markdown.
  - TOML.parse/stringify round-trip (partner-toml, defaults-probe).
  - YAML parse: 1.2 semantics — yes/on/no are STRINGS (runtime-surface
    asserts the same); stringify round-trips.
  - JSONC = JSON with COMMENTS + trailing commas, but QUOTED KEYS ARE
    REQUIRED — unquoted keys throw ("Expected string but found a");
    JSONC is NOT JSON5 (pinned boundary). Repo's jsonc usage is safe.
  - JSONL.parse -> array of objects. parseChunk(input) -> { values,
    read, done, error } and is STATELESS: a partial trailing line is
    dropped, not carried across calls — callers must buffer the
    remainder (repo's ndjson replacement should do its own buffering).
  - XML.parse: attributes -> "@attr", text -> "#text", repeated
    elements -> arrays (bun-docs-index §68 pattern); stringify works.
  - markdown: object with html/ansi/render/react methods; html() renders
    headings/strong/em correctly. react() (React elements) is a
    frontend-relevant surface worth a future look.
- fsx:probe (gate #36, 13/13): Glob/which/resolve/fileURLToPath/
  pathToFileURL/openInEditor.
  - Glob.match (incl. **), Glob.scan({ cwd, absolute }) — repo's 49
    uses covered.
  - which: found -> path, missing -> null, { PATH } override honored.
  - CORRECTION (P3b, pinned): Bun.resolve on 1.4.0 resolves BARE
    PACKAGE names to entry paths (typescript -> .../typescript.js) and
    returns node: builtins as the specifier, but RELATIVE paths THROW
    ("Cannot find module") even for existing files — resolve absolute
    via node:path or import.meta.resolve for relative targets.
  - fileURLToPath/pathToFileURL round-trip; openInEditor is a function.
- Matrix progress: docs/BUN_API_COVERAGE.md runtime gaps 47 -> 22
  (ansi/crypto/format/fsx + Image mapping). Remaining: net cluster
  (connect/listen/udpSocket/dns/redis/secrets) + runtime-misc
  (env/argv/sleep/version/revision/nanoseconds/WebView/Transpiler/
  Terminal/CSRF/Cookie/CookieMap/peek/readableStreamTo*/ArrayBufferSink).
- Artifacts: tools/format-probe.ts (new, gate #35), tools/fsx-probe.ts
  (new, gate #36), tools/verify-contracts.ts (34 -> 36 gates),
  package.json (format:probe, fsx:probe), docs/BUN_API_COVERAGE.md.
  verify:contracts 36/36.
## 134. Coverage goal final round — net + runtime-misc clusters, matrix COMPLETE (2026-08-24)

- net:probe (gate #37, 9/9): listen+connect TCP round-trip on loopback
  (echo verified); udpSocket send/recv — GOTCHAS: port 0 rejected
  ("Expected port to be an integer between 1 and 65535" — no ephemeral
  auto-bind), send(data, port, address) is POSITIONAL (no options
  object), and the receive handler lives in options.socket with
  signature data(socket, data, port, address, flags) — the payload is
  the SECOND arg (first is the socket). dns: prefetch + a 17-member
  surface (lookup/resolve/resolve* family/reverse/getServers/...);
  lookup("localhost") resolves offline via hosts (::1 + 127.0.0.1).
  redis: client class shape only (no server in gates — no connect).
  secrets: get({service,name}) object form returns null on a missing
  ref; positional form works at runtime (bun-types doesn't declare
  it — src/lib/secrets.ts documents this); a BARE STRING throws
  "Expected options to be an object" (pinned). Never set/delete in
  gates (mutates the OS vault).
- runtime:probe (gate #38, 16/16): env (object, PATH readable),
  argv, sleep (~32ms), version 1.4.0 + revision hex, nanoseconds
  monotonic, peek (fulfilled -> value; PENDING/REJECTED -> the promise
  itself, not undefined — pinned; peek.status "fulfilled"/"pending"),
  readableStreamToArrayBuffer/readableStreamToText, ArrayBufferSink
  (write/write/end -> Uint8Array), Transpiler ({loader:"ts"} strips
  types; tsx JSX), Terminal class (not constructed in gates — spawns a
  pty), WebView (construct + evaluate("1+2")==3 + close works headless
  — the repo's check-contrast pattern). P12: all bun: (test/sqlite/
  ffi) + node: (path/fs/util/os/crypto/tls/net/child_process) imports
  resolve.
- MATRIX COMPLETE: docs/BUN_API_COVERAGE.md — 102/102 Bun.* tokens
  classified, 73 runtime values ALL gated, 29 type-only/non-existent
  pinned, ZERO GAP rows, plus the module-imports appendix (step 1 of
  the objective). verify:contracts 38/38.
- Artifacts: tools/net-probe.ts (new, gate #37), tools/runtime-probe.ts
  (new, gate #38), tools/verify-contracts.ts (36 -> 38 gates),
  package.json (net:probe, runtime:probe), docs/BUN_API_COVERAGE.md.
  verify:contracts 38/38.
## 135. Fence lang contract — Bun-native tags, @bun-run execution (2026-08-24)

- Every code fence in docs now carries a Bun-native lang tag; docs:check
  FAILS on any untagged fence (the loader set Bun handles out of the box
  via its transpiler).
- Normalized fence tag typescript -> ts (the Bun loader name; the
  generator for docs/COLORS.md updated to match). The 14 previously
  untagged display fences (ASCII diagrams, sample output, URLs, schema
  lines) are now tagged text.
- Validators extended to Bun-native parsers: jsonc (Bun.JSONC.parse —
  probe §133: comments + trailing commas OK, quoted keys REQUIRED) and
  env (the .env loader shape of Bun: KEY=value lines, # comments). The
  json/json5/toml/yaml/xml set was already Bun-native.
- @bun-run EXECUTION pass: a ts/tsx block containing a // @bun-run
  marker line is a COMPLETE, self-contained example — docs:check writes
  it to a temp file and RUNS it via bun run (Bun executes TS/TSX out of
  the box); non-zero exit FAILS the gate. 15 API-example blocks in
  docs/BUN_NATIVE.md are marked (all pass; a future Bun breakage that
  changes an example behavior flips the gate and demands a re-probe).
  Unmarked blocks remain syntax-validated only (fragments are normal).
- Artifacts: src/lib/docs-validate.ts (jsonc/env validators),
  tools/docs-check.ts (untagged-fence FAIL + @bun-run execution),
  scripts/generate-color-artifacts.ts (typescript->ts template), the
  52 docs fences. docs:check — 52/52. verify:contracts 38/38.
## 136. Git language stats — .gitattributes (Linguist) vs fence lang (2026-08-24)

- The fence lang tags (ts/text/jsonc/..., §135) drive docs:check via
  Bun.Transpiler + bun run — they do NOT feed GitHub language %.
- GitHub language stats use Linguist, configured by .gitattributes. The
  repo had NONE, so the pie counted generated state: 14 .data files,
  27 research/reports, docs/COLORS.md, docs/BUN_API_COVERAGE.md.
- Added .gitattributes: .data/** and research/reports/** and the two
  generated docs -> linguist-generated; .audit-inbox/** and node_modules/**
  -> linguist-vendored; docs/**/*.md + README.md -> linguist-documentation
  (code-only pie; drop those lines to show Markdown %).
## 137. bun:test runner surface — the gate IS a test file (2026-08-24)

- tools/test-probe.test.ts (gate #39) runs `bun test` against bun:test
  itself: 15 pass + 1 todo (P8c, todo is not a failure) + 1 inline
  snapshot. The runner exercises its own API on 1.4.0.
- VERIFIED: mock.fn (calls/results/lastCall/mockClear, mockImplementation
  (Once), mockReturnValue(Once), mockResolvedValue(Once),
  mockRejectedValue + rejects.toThrow); spyOn tracks WITHOUT replacing
  (original runs) + mockRestore; mock.module intercepts by path (repo
  pattern from github-budget.test.ts — registers top-level, dynamic
  import resolves to the mock); setSystemTime fakes Date.now()/new Date
  (2020-01-01 -> 1577836800000) + afterAll restore; toMatchInlineSnapshot;
  test.each; test(name, { retry: 2 }) and { timeout } options accepted;
  expectTypeOf runtime no-op + jest.fn/vi.fn compat aliases;
  beforeAll/afterAll/onTestFinished lifecycle; matcher set (toBeTypeOf,
  toMatchObject, toBeCloseTo, toContain, toHaveLength).
- Repo note: github-budget.test.ts mock.module pattern is the correct
  shape (closure flags instead of re-registering); the repo could adopt
  spyOn + test.each + { retry } in future tests — all verified.
- Artifacts: tools/test-probe.test.ts (new, gate #39), tools/verify-contracts.ts
  (38 -> 39 gates), package.json (test:probe), docs/BUN_API_COVERAGE.md
  + AGENT-PITFALLS header (38/38 -> 39/39). verify:contracts 39/39.
## 138. bun:test deeper — fake timers, failing/if/concurrent, file snapshots (2026-08-24)

- Extended gate #39 (tools/test-probe.test.ts) to 23 tests: 22 pass + 1
  todo + 2 snapshots (inline + file).
- FAKE TIMERS: vi.useFakeTimers()/useRealTimers()/isFakeTimers() +
  advanceTimersByTime(ms) fires pending setTimeout; runAllTimers/
  advanceTimersToNextTimer/getTimerCount/clearAllTimers exist.
- CLAIM VERIFIED (docs dates-times): bun's useFakeTimers does NOT patch
  Date/Date.now (Date stays === OriginalDate — unlike Jest); only
  setSystemTime fakes the clock (Date.now -> frozen). Two different
  mechanisms; pinned in P13 so a future change flips the gate.
- test.failing(name, fn) INVERTS: a test that throws PASSES (tracking a
  known bug); test.if(cond)(name, fn) runs conditionally; test.concurrent
  runs in parallel (keep such tests isolated — no shared state);
  describe.skip/only are functions; setDefaultTimeout(ms) accepted.
- FILE SNAPSHOTS: expect(x).toMatchSnapshot() writes
  tools/__snapshots__/test-probe.test.ts.snap (Bun Snapshot v1 format);
  CI runs COMPARE (no writes without --update-snapshots). Inline
  snapshots (P7) need no file.
- Note: bun:test options are the THIRD arg (test(name, fn, options))
  typed number | TestOptions; test.todo requires a fn.
- Artifacts: tools/test-probe.test.ts (+P12..P18),
  tools/__snapshots__/test-probe.test.ts.snap (new). verify:contracts 39/39.
## 139. fetch/HTTP client semantics — keep-alive, redirects, abort, streams (2026-08-24)

- tools/fetch-probe.ts (gate #40, 10/10, loopback node:http server — also
  exercises Bun node:http compat). The research pipeline's GitHub
  traffic rides on these semantics.
- KEEP-ALIVE: 5 sequential fetches to one origin reuse a SINGLE TCP
  connection (node:http server connection counter). A server
  Connection: close header is honored — the next fetch opens a fresh
  connection (the /close request itself reuses the pool).
- REDIRECTS: follow default (final URL /target, 200); redirect:"error"
  throws; CORRECTION (pinned): redirect:"manual" does NOT return an
  opaqueredirect — it returns the 302 UNFOLLOWED as a normal response
  (type default, status 302). Deviates from the fetch spec.
- ABORT: AbortController aborts a streaming response mid-flight; the
  reader rejects with an Abort-named error after the first chunk.
- STREAMING: ReadableStream request bodies POST chunk-by-chunk and the
  server reassembles the full payload; responses arrive incrementally
  (chunk a, 200ms gap, chunk b — client sees the timing).
- FormData multipart: content-type multipart/form-data with a boundary
  and both text fields + Blob files present in the wire payload.
- gzip auto-decompression: a Content-Encoding: gzip response decodes
  transparently (body reads as plain text).
- Artifacts: tools/fetch-probe.ts (new, gate #40), tools/verify-contracts.ts
  (39 -> 40 gates), package.json (fetch:probe), docs/BUN_API_COVERAGE.md
  + AGENT-PITFALLS header (39/39 -> 40/40). verify:contracts 40/40.
## 140. node: module behavior on Bun 1.4.0 — compat gate #41 (2026-08-24)

- tools/node-compat-probe.ts (12/12, offline): the repo imports node:path
  (103), node:fs (74), node:util (33), node:os (32), node:crypto (10),
  node:net/tls/child_process — runtime:probe P12 proved they RESOLVE;
  this gate proves they BEHAVE.
- VERIFIED: path join/resolve/basename/dirname/extname/relative; fs sync
  (readFileSync/writeFileSync/mkdirSync/existsSync) + fs/promises +
  fs.watch firing on file change (repo: match-liquidity-db-watch);
  os platform/arch/type/hostname/tmpdir/cpus; util format/promisify/
  types; EventEmitter on/once; child_process spawnSync; net TCP echo
  round-trip.
- PARITY: node:crypto createHash("sha256").update("abc").digest("hex")
  === Bun.CryptoHasher("sha256") hex (ba7816bf...) — the two hash
  paths agree; createHmac works; randomBytes/randomUUID (v4).
- Node compat on 1.4.0 is behaviorally sound for everything the repo
  uses — no corrections needed this round.
- Artifacts: tools/node-compat-probe.ts (new, gate #41), tools/verify-contracts.ts
  (40 -> 41 gates), package.json (node-compat:probe), docs/BUN_API_COVERAGE.md
  + AGENT-PITFALLS header (40/40 -> 41/41). verify:contracts 41/41.
## 141. Pattern enhancements — Bun.$ in the design pipeline, §128 catch-up visibility (2026-08-24)

- MIGRATED scripts/build-design-system.ts: the CLI metafile-md report
  subprocess was Bun.spawn + manual exited/stderr plumbing — now the Bun
  Shell template: interpolation auto-escape, .cwd()/.nothrow()/.stderr
  verified §127. design:build + design:check still pass; the stale
  SPAWN_KEEP_LIST entry was removed (no Bun.spawn left in the file).
- ENHANCED createSingleFlight (scripts/cron-main.ts): exposes
  droppedTicks() — a fire that lands while the job is active is
  coalesced AND the scheduled tick is LOST (§128 SKIP policy).
  jobSportsMetadata logs the drop count so the 30m freshness deadline
  can never slip silently. Tested in tests/scripts/audit-overlay-cron.test.ts
  (3 concurrent run() calls -> 2 dropped, 1 execution).
- The rest of the repo's patterns were already Bun-native (cron jobs
  all use Bun.$, ids.ts uses randomUUIDv7, HTML imports serve hq-app);
  these were the last two non-native seams found in the audit.
- Artifacts: scripts/build-design-system.ts, scripts/audit-bun-native.ts
  (keep-list), scripts/cron-main.ts, tests/scripts/audit-overlay-cron.test.ts.
  verify:contracts 41/41 (unchanged).
## 142. Bun.Transpiler internals — scan APIs the repo enforcement relies on (2026-08-24)

- tools/transpiler-probe.ts (gate #42, 9/9): the guard's scanImports and
  docs-validate's .scan() both verified against the runtime.
- scan(src) -> { imports, exports }: static imports (import-statement),
  side-effect imports, dynamic imports (dynamic-import), require calls
  (require-call) all detected with paths; exports array lists exported
  names. scanImports(src) returns the same imports array (the guard's
  enforcement surface is sound).
- transformSync: ts loader strips types, tsx handles JSX; define option
  replaces process.env refs + plain identifiers (unmatched kept);
  target bun vs node output IDENTICAL for plain ESM; invalid syntax
  throws; minify { whitespace } vs minify true (renames identifiers).
- CORRECTION (pinned): transformSync THROWS on a with { type: "macro" }
  import when the macro file is unresolvable (error variant by loader:
  AggregateError Parse error vs Macro-not-found) — the transpiler is not
  a macro runner; builds resolve macros (§130).
- GOTCHA (docs:api STRICT): the call-site regex \s*\( spans newlines —
  prose like "Bun.$\n(see..." reads as a call on the MISSING-classified
  $ token. Doc wording avoids Bun.$ adjacent to an open paren.
- Artifacts: tools/transpiler-probe.ts (new, gate #42), tools/verify-contracts.ts
  (41 -> 42 gates), package.json (transpiler:probe), docs/BUN_API_COVERAGE.md
  + AGENT-PITFALLS header (41/41 -> 42/42), §141 reworded.
  verify:contracts 42/42.
## 143. Transpiler grounded in runtime/transpiler.mdx — 8 doc claims verified (2026-08-24)

- Extended gate #42 (tools/transpiler-probe.ts) to 17 checks against the
  installed docs (docs/runtime/transpiler.mdx).
- VERIFIED (doc-correct): per-call loader override (transformSync(code,
  loader) — a js-loader instance accepts tsx per call); async transform()
  returns Promise<string>; scan() IGNORES type-only imports/exports and
  the DOC EXAMPLE output matches the runtime exactly (require-call
  ABSENT from scan() imports; exports array lists only value exports);
  scanImports() INCLUDES require-call (consistent); exports option
  { eliminate, replace } removes/renames exports; minifyWhitespace (the
  documented option name — minify:{whitespace} also works); inline:true
  inlines constant values.
- CORRECTIONS (pinned): (1) CSS import scanning is UNSUPPORTED on 1.4.0
  — the docs list import-rule/url-token kinds but the css loader throws
  "only JavaScript-like loaders supported for now"; (2) tsconfig
  jsxFactory/jsxFragment/jsxRuntime are IGNORED — jsxDEV (automatic
  runtime) is emitted regardless, so the docs' Preact-via-tsconfig
  claim does not work on 1.4.0.
- NOTE: scan()'s require-call detection is source-shape-dependent (my
  earlier P3 source included require-call; the doc example omits it).
  scanImports() is the consistent surface — the guard's choice is right.
- Artifacts: tools/transpiler-probe.ts (+P9..P16). verify:contracts 42/42.
## 152. Reference/pointer staleness audit — renumbering + uniqueness gate (2026-08-24)

- Audited every §N reference + numbered heading + cross-file pointer for
  staleness. Findings and fixes:
- (1) EIGHT duplicate ## N. section numbers from interleaved parallel
  work (both agents used §110/§111/§118/§121-§123/§127/§131) — pointers
  were AMBIGUOUS (e.g. §127 meant either Bun Shell or code-search).
  Renumbered the parallel (2026-08-25) sections to §144-§151 and
  updated ~15 references in docs, src/lib, src/institutions, src/research,
  scripts, tools, and tests (semver.ts/deps-outdated/version-gt ->
  §147-§149; code-search tooling -> §150-§151; github-budget channel ->
  §146; mock.module test ref corrected to §137).
- (2) A VERBATIM duplicated §16 block in AGENT-PITFALLS (merge artifact)
  deleted; (3) docs/DESIGN-PIPELINE.md had two ## 6. sections (Gate
  matrix vs Commands) — Commands renumbered to ## 8.
- ENFORCEMENT: docs:check now FAILS on duplicate ## N. section numbers
  per doc (the slug check had missed identical-title duplicates). The
  rule immediately caught the DESIGN-PIPELINE case on first run.
- Verified: AGENTS.md doc targets (BUN_TECH_STACK/BUN_NATIVE/AUTHORIZED_
  EXECUTION) all exist; every §N reference now resolves to exactly one
  heading; gate names in the matrix all run (42/42).
- Artifacts: docs/AGENT-PITFALLS.md (renumbered + §152), docs/DESIGN-PIPELINE.md,
  tools/docs-check.ts (uniqueness rule), ~13 reference-updated files.
  verify:contracts 42/42.
## 153. bun:sqlite deep — strict mode, query.as, serialize, transactions (2026-08-24)

- tools/sqlite-deep-probe.ts (gate #43, 12/12) — beyond the base 9-claim
  sqlite:probe (§19): the repo imports bun:sqlite 126x.
- VERIFIED (docs runtime/sqlite.mdx correct): strict:true THROWS on a
  missing param AND allows prefix-less binding; query.as(Class) maps
  rows to class instances; multi-query run ("SELECT 1; SELECT 2;") in
  one call; run() returns { changes, lastInsertRowid }; readonly mode
  rejects writes; serialize() -> Buffer + Database.deserialize(buf) ->
  Database round-trips data; BLOB <-> Uint8Array round-trip.
- SHAPES: db.transaction(fn)() is deferred, exposes db.inTransaction,
  ROLLS BACK on throw AND RETHROWS the inner error (callers must
  catch). Statement introspection is columnNames/columnTypes/
  declaredTypes/paramsCount — NOT columns/params (better-sqlite3 API
  shape differs).
- CORRECTION (pinned): bun:sqlite has NO createFunction/
  createAggregate on 1.4.0 (better-sqlite3 parity gap) — custom SQL
  functions need a different approach (no native path on 1.4.0).
- Artifacts: tools/sqlite-deep-probe.ts (new, gate #43), tools/verify-contracts.ts
  (42 -> 43 gates), package.json (sqlite-deep:probe), docs/BUN_API_COVERAGE.md
  + AGENT-PITFALLS header (42/42 -> 43/43). verify:contracts 43/43.
## 154. HTTP/2 fetch multiplexing + serve protocol semantics (2026-08-24)

- tools/h2-probe.ts (gate #44, 5/5, loopback TLS via throwaway openssl
  cert — SPAWN_KEEP_LIST + TLS_OVERRIDE_ALLOWLIST entries added).
- H2 FETCH MULTIPLEXING (extends §124/§125): 8 CONCURRENT
  protocol:"http2" fetches against a node:http2 server use ONE TCP
  connection with 8 concurrent streams and ~1 round-trip elapsed
  (156ms vs ~1200ms serial — verified with a 150ms-delayed server).
  The research pipeline's GitHub traffic can ride h2 with full
  multiplexing (connection-count pressure drops 8x on concurrent
  bursts).
- SERVE PROTOCOL: HEAD requests get an EMPTY body with the real
  Content-Length (12 for a 12-byte body) and all headers — correct
  HEAD semantics; streaming responses are transfer-encoding: chunked
  with NO content-length; an Expect: 100-continue request header
  reaches the handler unchanged (Bun.serve does not reject it).
- Artifacts: tools/h2-probe.ts (new, gate #44), tools/verify-contracts.ts
  (43 -> 44 gates), package.json (h2:probe), scripts/audit-bun-native.ts
  + src/lib/breaking-audit.ts (allowlists), docs/BUN_API_COVERAGE.md +
  AGENT-PITFALLS header (43/43 -> 44/44). verify:contracts 44/44.
## 155. Bun.build metafile schema — the mtafile contract verified (2026-08-24)

- tools/metafile-probe.ts (gate #45, 11/11): the schema the
  design:build pipeline (dist/*.meta.json + --metafile-md) emits,
  probed against the pasted esbuild-compatible claims.
- VERIFIED: top-level { inputs, outputs }; inputs entries { bytes,
  imports, format }; outputs entries { bytes, inputs, imports, exports,
  entryPoint, cssBundle } (cssBundle only when a CSS output exists);
  outputs.inputs = { source: { bytesInOutput } } contribution map;
  entryPoint + cssBundle cross-references resolve; dead-code import()
  chunks omitted from both maps; CLI --metafile=path.json emits the
  same schema.
- CORRECTIONS (pinned): (1) relative/package imports carry
  { path, kind, original } — the external flag appears only on
  node_modules require-calls (external: true), not on import-
  statements (the pasted claim's { path, kind, external } is esbuild's
  shape, not Bun's); (2) treeShaking: false does NOT force import()
  chunks to appear — dead branches are eliminated regardless (tested
  with if(false) and with an unused () => import() export).
- Repo check: dist/design-system.meta.json (the mtafile) conforms —
  inputs+outputs with bytes/entryPoint/exports/imports/inputs; no
  cssBundle because the design-system bundle imports no CSS.
- Artifacts: tools/metafile-probe.ts (new, gate #45), tools/verify-contracts.ts
  (44 -> 45 gates), package.json (metafile:probe), scripts/audit-bun-native.ts
  (SPAWN_KEEP_LIST), docs/BUN_API_COVERAGE.md + AGENT-PITFALLS header
  (44/44 -> 45/45). verify:contracts 45/45.
## 156. Reprobe + pointer/contract hardening (2026-08-24)

- REPROBE: full suite re-run — verify:contracts 45/45, docs:check 52/52,
  docs:api 0 drift, breaking-audit ok, guard ok, typecheck 0. Nothing
  drifted since the gates were pinned.
- POOR CONTRACT FIXED: tools/net-probe.ts P5 (secrets.get missing ->
  null) PASSED on exception (catch -> check(true)), masking vault or
  behavior regressions — now a THROW FAILS the gate (the vault is
  reachable in this environment, so the normal null path is what
  passes).
- POINTER SWEEP (file pointers in docs): 16 flags -> 2 REAL (fixed:
  SEAT-OPS pre-commit.sh -> tools/pre-commit.ts; BUN_NATIVE
  bun-doc-refs.ts -> tools/bun-docs-index.ts). The other 14 were
  intentional (documented absences/moves: ansi-width replaced by
  Bun.stringWidth, partner/domain moved, meta-audit no-such-file,
  flat tests/patterns.test.ts convention), prose examples (src/index.ts
  NOT-bugs list), package-relative commands (alpha/tennis-game-model
  src/run-watch.ts + src/backtest.ts — verified they exist), or regex
  truncation (.jsonl/.ts.snap).
- ENFORCEMENT: docs:check now FAILS on missing repo-root file pointers,
  with an INTENTIONAL_PATHS allowlist for the deliberate cases (§156)
  — stale file references can no longer accumulate.
- Artifacts: tools/net-probe.ts (P5 hardened), docs/SEAT-OPS.md,
  docs/BUN_NATIVE.md (pointers), tools/docs-check.ts (pointer rule).
  verify:contracts 45/45.
## 157. Enhanced-ecosystem-diagram claim audit — gate #46 (2026-08-24)

- tools/ecosystem-probe.ts (7/7) against the pasted Mermaid diagram's
  API/version claims.
- VERIFIED CORRECT: Bun.enableANSIColors is a real BOOLEAN (theme gating
  claim right); Bun.Image.prototype has modulate + resize/rotate/flip/
  flop (instance methods, not statics); bunfig [console] depth = 3 is
  documented (with the --console-depth flag); install.globalStore is
  documented (default false, BUN_INSTALL_GLOBAL_STORE env, isolated-
  linker links store at <cache>/links/).
- FABRICATED (pinned): bunfig [dev] port/hostname and [server] static/
  development sections do NOT exist — the real sections are [serve]
  (port default 3000) and [serve.static] (env = "PUBLIC_*" inline
  config lives here, not top-level); node:http2 has NO server push
  (pushStream undefined on 1.4.0) — the diagram's "Server push
  (partial)" is wrong.
- UNVERIFIABLE OFFLINE (noted, not pinned): version stamps like
  Global Virtual Store v1.3.14+, metafile v1.3.8+ (contradicts the
  earlier paste's v1.3.6), Bun.cron v1.4.0+, Bun.JSONL/JSON5 v1.3.7+,
  sqlite v0.6.0+ — need release-note verification.
- Artifacts: tools/ecosystem-probe.ts (new, gate #46), tools/verify-contracts.ts
  (45 -> 46 gates), package.json (ecosystem:probe), docs/BUN_API_COVERAGE.md
  + AGENT-PITFALLS header (45/45 -> 46/46). verify:contracts 46/46.
## 158. Full-surface gap closed — the honest completeness picture (2026-08-24)

- ROOT CAUSE of the "missing key aspects": the coverage matrix was
  repo-scoped (100% of REPO-USED tokens), and probes were claim-driven.
  Bun's runtime namespace has 110 members; 34 were entirely unprobed
  (S3Client/s3, FileSystemRouter, password, the SHA class family,
  readableStreamTo* family, unsafe, memory APIs, randomUUIDv5...).
- docs/BUN_API_COVERAGE.md now carries a FULL-SURFACE table: all 110
  runtime members with probed/unprobed status — gaps are visible.
- tools/surface-probe.ts (gate #47, 8/8) closes the biggest gaps:
  SHA family classes (MD4/MD5/SHA1/SHA224/SHA384/SHA512/SHA512_256)
  constructible with known digests; password hash/verify round-trip;
  FileSystemRouter match/routes; readableStreamToArray/Bytes/Blob/JSON;
  deepMatch; concatArrayBuffers; memory/runtime members (gc/shrink/
  generateHeapSnapshot/isMainThread/isStandaloneExecutable/main/
  unsafe/indexOfLine/resolveSync/allocUnsafe/embeddedFiles/stderr/
  stdin); postgres/RedisClient/s3/S3Client shapes.
- CORRECTIONS pinned: randomUUIDv5 is BROKEN on 1.4.0 (every namespace
  form — string, hex, Buffer, Uint8Array — throws Invalid UUID format);
  concatArrayBuffers takes ONE array of buffers and returns an
  ArrayBuffer (byteLength, not length).
- REMAINING KNOWN-GAP: S3Client/s3/RedisClient/postgres are shape-
  checked only (need servers/credentials to probe behavior); unsafe
  internals documented as object. Version-stamp claims and network
  behaviors stay unverifiable offline (marked in §157).
- Artifacts: tools/surface-probe.ts (new, gate #47), tools/verify-contracts.ts
  (46 -> 47 gates), package.json (surface:probe), docs/BUN_API_COVERAGE.md
  (full-surface table), AGENT-PITFALLS header (46/46 -> 47/47).
  verify:contracts 47/47.
## 159. Systematic-risk gates — version pin + type drift (2026-08-24)

- tools/version-probe.ts (gate #48, 3/3): FAILS when Bun.version/
  revision leave the pinned 1.4.0/34cbb9a40 — a runtime bump now
  forces RE-VERIFICATION of the whole suite instead of silently
  invalidating every pin (the "snapshot-at-version" risk, §158).
- tools/type-drift-probe.ts (gate #49, 3/3): every runtime Bun member
  must have a bun-types declaration (all 110 typed on 1.4.0 — index/
  bun/sqlite/shell/ffi/redis/s3/deprecated d.ts); the readableStreamTo*
  family is declared in deprecated.d.ts (a deprecation signal — still
  functional, surface:probe P4); the documented non-existence set
  (gzip/html/image/watch/zstd/term/rename/CSV/Quic) stays absent.
- These close the two SYSTEMATIC gaps from §158: version drift and
  type-lag are now gate-enforced rather than found by accident.
- Artifacts: tools/version-probe.ts (new, gate #48), tools/type-drift-probe.ts
  (new, gate #49), tools/verify-contracts.ts (47 -> 49 gates), package.json,
  docs/BUN_API_COVERAGE.md + AGENT-PITFALLS header (47/47 -> 49/49).
  verify:contracts 49/49.
## 160. Server-backed client shapes — RedisClient/S3/postgres/FSR depth (2026-08-24)

- tools/client-shape-probe.ts (gate #50, 8/8) — closes the §158
  "shape-checked only" note into real client-surface probes (no live
  servers: constructors + method surfaces + refused-connection error
  paths).
- RedisClient: URL constructor (NOT an options object — options form
  throws Invalid URL format); a ~213-method command surface (get/set/
  hgetall/publish/subscribe/xadd/zadd/...); a refused connection makes
  commands REJECT (Max reconnection attempts reached) — no hang.
- S3Client: { bucket, accessKeyId, secretAccessKey } ctor; file API
  (file/delete/write/list/presign/stat/size); S3File is BunFile-like
  (text/arrayBuffer/bytes/stat/stream/slice + presign); presign
  generates real signed URLs locally (X-Amz-...) — options object,
  not a number (presign(path, { expiresIn })).
- Bun.postgres: a thenable QUERY-BUILDER (execute/run/values/raw/
  simple + then/catch/finally) — NOT a node-postgres tagged-template
  client (pg`select 1` errors "Query is not a function"; the repo must
  use .execute()/.values()). Queries reject on refused connections.
- FileSystemRouter: params { id } with kind "dynamic" for [id]/page
  routes (nextjs style); routes map exposes the pattern keys.
- password: algorithm options verified — argon2id ($argon...) and
  bcrypt ($2b$...) both hash + verify.
- Artifacts: tools/client-shape-probe.ts (new, gate #50), tools/verify-contracts.ts
  (49 -> 50 gates), package.json (client-shape:probe), docs/BUN_API_COVERAGE.md
  + AGENT-PITFALLS header (49/49 -> 50/50). verify:contracts 50/50.
## 161. bun test --coverage semantics — gate #51 (2026-08-24)

- tools/coverage-probe.ts (5/5): the repo's 300+ tests could ride on
  coverage thresholds for the CI story.
- VERIFIED (docs code-coverage.mdx correct): --coverage prints the
  % Funcs / % Lines table with uncovered line ranges (a one-covered-
  of-two fixture reports 50% funcs / 100% lines); [test] coverage =
  true auto-enables WITHOUT the flag; coverageSkipTestFiles excludes
  test files from the report by default; coverageThreshold enforces:
  below -> bun test exits 1, above -> 0; the object form
  { lines, functions } works.
- NOTE: thresholds only apply when coverage RUNS — bun test without
  --coverage (or [test] coverage) does NOT check thresholds.
- Artifacts: tools/coverage-probe.ts (new, gate #51), tools/verify-contracts.ts
  (50 -> 51 gates), package.json (coverage:probe), scripts/audit-bun-native.ts
  (SPAWN_KEEP_LIST), docs/BUN_API_COVERAGE.md + AGENT-PITFALLS header
  (50/50 -> 51/51). verify:contracts 51/51.
## 162. Fullstack combo + permessage-deflate — gate #52 (2026-08-24)

- tools/fullstack-probe.ts (3/3, own fixture dir — html:probe owns
  scratch/html-fixture; sharing it clobbered the HTML marker and
  flaked the earlier gate run).
- VERIFIED (docs bundler/fullstack.mdx): ONE Bun.serve carries an HTML
  import route (compiled on demand) + method-keyed API routes (GET/
  POST) + /api/users/:id params + development: true — the repo hq-app
  serving pattern, all in one server.
- WebSocket permessage-deflate: REAL — the type declares
  perMessageDeflate?: boolean, DEFAULT true (the upgrade advertises
  permessage-deflate; client_max_window_bits; false suppresses the
  header — matching the ws package option). The diagram's
  extensions-object form is an older shape (accepted, not typed).
- Artifacts: tools/fullstack-probe.ts (new, gate #52), tools/verify-contracts.ts
  (51 -> 52 gates), package.json (fullstack:probe), docs/BUN_API_COVERAGE.md
  + AGENT-PITFALLS header (51/51 -> 52/52). verify:contracts 52/52.
## 163. Matrix generator promoted to committed tooling (2026-08-24)

- tools/bun-coverage-matrix.ts (script: coverage:matrix) — the matrix
  generator moved OUT of gitignored scratch/ (where it depended on
  gitignored inputs) into a committed, SELF-CONTAINED tool: scans
  src/tools/scripts/tests for Bun.* tokens, sweeps runtime typeofs,
  checks bun-types d.ts + docs mentions, applies the gate map, and
  regenerates docs/BUN_API_COVERAGE.md offline.
- The matrix is now REPRODUCIBLE on a fresh checkout (the prior
  scratch-only generator was a reproducibility gap — the committed
  matrix could not be regenerated). 140 rows · 0 GAPs.
- Artifacts: tools/bun-coverage-matrix.ts (new), package.json
  (coverage:matrix script), docs/BUN_API_COVERAGE.md (regenerated).
  verify:contracts 52/52 (unchanged).
## 165. Hardcoded values made auto — counts sync (2026-08-24)

- The verify:contracts N/N header count was hardcoded + manually bumped
  on every gate addition (a stale-risk chore). Now AUTO:
  tools/docs-sync-counts.ts derives the count from the gates array
  (pure string ops, no regex hell) and updates the AGENT-PITFALLS
  header. Proven: corrupting the header to 51/51 -> docs:sync-counts
  restores 52/52 -> docs:check passes. Chained after coverage:matrix
  (the one command keeps the matrix AND the count current).
- The matrix generator's counts["$"] = 47 hardcode was REMOVED — the rg
  scan counts Bun.$ correctly (verified 47); the hardcode would mask
  drift.
- docs:check's stale-count scan remains the FAIL-side enforcement; the
  generator is the auto-FIX side. Both coexist.
- Artifacts: tools/docs-sync-counts.ts (new), package.json (docs:sync-
  counts script + coverage:matrix chain), tools/bun-coverage-matrix.ts
  ($ hardcode removed), docs/AGENT-PITFALLS.md (§165).
  verify:contracts 52/52.
## 164. Realignment executed — hq-app chunking + two real bugs found (2026-08-24)

- Executed the §13 per-module plan: hq-app's hash-routes.ts + surface-edge.ts
  converted to top-level dynamic imports + splitting:true in design:build
  — the entry shrank 49.9 -> 48.0 KB with 3 split chunks (268+1356+1066 B)
  emitted. Behavior unchanged (app awaits chunks; HTML-import serve
  serves them). design:check budgets pass (46.83/64 KB).
- BUG 1 (metafile path resolution): the object-form metafile resolves
  json/markdown paths against the OUTDIR — even ABSOLUTE paths get
  outdir-prefixed. Since the §155 object-form migration, design:build
  wrote meta files to dist/dist/... and design:check read STALE
  pre-migration meta (the chunking was invisible to the gate). Fixed:
  relative paths (module + .meta.{json,md} -> dist/). Pinned P34.
- BUG 2 (design:check externalImports): split chunks are OUTPUTS, not
  inputs — the check flagged ./chunk-*.js as unexpected externals
  (design:check FAIL). Fixed: outputs join the membership set (chunks +
  assets are internal). Unit-tested in design-budget.test.ts.
- P33 (chunks omitted from metafile.outputs) was a FALSE PREMISE — the
  metafile includes chunks; the omission was the stale file from BUG 1.
- Artifacts: src/research/hq-app/app.js (dynamic imports),
  scripts/build-design-system.ts (splitting + relative meta paths),
  src/lib/design-budget.ts (externalImports), tests/lib/design-budget.test.ts
  (+1), tools/metafile-probe.ts (P34), docs/AGENT-PITFALLS.md (§155 fix,
  §164). verify:contracts 52/52 (unchanged).
- FILENAME BEHAVIOR (pasted --metafile-md claims vs 1.4.0, gate P9-P13):
  a bare --metafile-md writes meta.md to the PROCESS CWD, NOT the
  --outdir (the pasted claim's location is wrong); --metafile-md=<path>
  resolves against the CWD (not outdir); --metafile + --metafile-md
  together write both; a bare --metafile DEFAULTS to meta.json in the
  CWD (the pasted claim says a path is always required — wrong).
  Absolute paths do NOT write where asked — the object form resolves
  json/markdown paths against the OUTDIR (absolute paths get
  outdir-prefixed; P34 pins this). Use RELATIVE names. §163's hq-app
  chunking found design:build writing to dist/dist/ since §155 — fixed.
  All pinned.
- API OBJECT FORM (verified, gate P14-P16): Bun.build({ metafile:
  { json, markdown } }) writes BOTH files relative to the OUTDIR (no
  CLI CWD quirk) and res.metafile stays populated; metafile: "path"
  writes the JSON only. bun-types 1.4.0 types metafile as boolean —
  cast the object form.
- ADOPTED in scripts/build-design-system.ts: the metafile object form
  replaced the CLI --metafile-md re-build — one build call emits both
  dist/<module>.meta.json + .meta.md, the Bun.$ subprocess is GONE
  (and the unused $/BUN imports removed). Output identical to the
  CLI report; design:check unchanged.
- REPORT CONTENT (verified, gate P17-P20): the object-form markdown has
  the six claimed sections — Quick Summary (output size, module/entry
  counts, ESM modules), Largest Modules by Output Contribution (size +
  % + format), Entry Point Analysis, Dependency Chains, Full Module
  Graph (contribution/format/imported-by/imports), Raw Data for
  Searching with [MODULE:] / [IMPORT:] / [IMPORTED_BY:] / [ENTRY:] /
  [EXTERNAL:] / [NODE_MODULES:] / [OUTPUT_BYTES:] / [FORMAT:] markers.
- CORRECTIONS vs the pasted claim: the Largest section is named
  "Largest Modules by Output Contribution" (not "Largest Input Files");
  Quick Summary counts ESM only — NO CJS metric and NO output/input
  ratio; the byte marker is [OUTPUT_BYTES:] not [SIZE:].

- DEFINE-GATED tree shaking (gate P21-P22): an import() behind a
  define that resolves false is dropped, AND treeShaking:false does
  NOT keep it — the pasted claim ("set treeShaking:false to keep
  every import() chunk") is wrong on 1.4.0, consistent with P7.
- outputs.imports is ALWAYS EMPTY (P23, pinned) — the schema field
  never populates even when the output JS carries external imports.
- Node BUILTINS are bundled into the output (P24 — node:path polyfill
  inlined, 10KB) — esbuild keeps builtins external; a real difference.
- JSON.stringify(result.metafile) + Bun.write round-trips (P25);
  the relative-path form (Bun.write("./dist/meta.json", ...)) resolves
  against the process CWD (P26) — same rule as the CLI outputs.
- bunfig.toml has NO [build] metafile key — a [build] metafile = true is
  IGNORED (P27); metafile is per-call/CLI only. Pretty-print
  JSON.stringify(mf, null, 2) and metafile:false (the env-gated
  ANALYZE=1 pattern) verified (P28).
- BuildOutput/BuildArtifact surface (gate P29-P32): kinds observed
  entry-point/asset/sourcemap (+ chunk via splitting, bytecode via
  --bytecode); loader + hash (string with [hash] naming) present.
  CORRECTIONS: BuildArtifact is Blob-CONFORMANT but NOT instanceof Blob,
  and .bytes() does NOT exist on it (text/arrayBuffer/size/type work);
  artifact.sourcemap points at the CSS asset in this build, not the .map
  (sourcemaps are separate outputs with kind sourcemap) — the pasted
  "extends Blob ... .bytes()" and the sourcemap-field semantics are
  overstated.
  SUPERSEDED: the BuildArtifact surface is consolidated, corrected, and
  evidence-grounded in §177 / docs/BUN_BUILD_FINDINGS.md (S01 methods,
  S04 sourcemap nesting). This P29-P32 bullet records the original era.
- "Matches esbuild exactly" is NOT exact: inputs.imports entries are
  { path, kind, original } without the always-present external flag
  (external appears only on require-calls). The analyzer likely still
  tolerates it (extra fields ignored), but exact-match is overstated.
- GitHub recomputes the pie on the default branch after push (a few
  minutes). Verified with git check-attr.
- Artifacts: .gitattributes (new). verify:contracts 38/38 (unchanged).

























## 166. Allowlist/keep-list staleness auto-detected (2026-08-24)

- The guard's SPAWN_KEEP_LIST and breaking-audit's five allowlists
  (LABEL_FILES, YAML_ALLOWLIST, TEMPORAL_ALLOWLIST,
  TLS_OVERRIDE_ALLOWLIST, WS_ALLOWLIST) drifted silently: a renamed or
  deleted keep-listed/allowlisted file left a DEAD entry behind (the
  entry does nothing, but nothing told you). Both sides now report it:
- scripts/audit-bun-native.ts: warn-level check — every SPAWN_KEEP_LIST
  entry must resolve to an existing file (exact paths only today);
  a missing file prints a warning but does NOT fail the gate (a rename
  mid-flight is a normal transient state — same tolerance as the scan
  loop's deleted-but-unstaged skip).
- src/lib/breaking-audit.ts: the allowlists were hoisted to module
  scope + new staleAllowlistEntries(root): glob entries are matched
  with Bun.Glob (cwd root, onlyFiles), exact entries with existsSync;
  zero-match entries come back as listName + entry lines. tools/bun-
  breaking-audit.ts prints them as a non-fatal WARN (exit code
  unchanged — a dead entry weakens nothing, the audit gate stays on
  real breakage).
- Unit tests (tests/lib/breaking-audit.test.ts, staleAllowlistEntries
  describe): the fixture root reports all entries stale; the LIVE repo
  root must report ZERO — a deleted allowlisted file now fails the
  test suite. Auto-FIX side is deleting the entry; FAIL side is the
  test.
- Verified: guard ok (no stale keep-list), breaking-audit 14 checks ok
  (0 stale), fixture tests 13/13, verify:contracts 52/52, docs:check
  clean.
- Artifacts: src/lib/breaking-audit.ts (hoist + staleAllowlistEntries),
  scripts/audit-bun-native.ts (keep-list staleness warn),
  tools/bun-breaking-audit.ts (non-fatal report),
  tests/lib/breaking-audit.test.ts (+2 tests).

## 167. Gate count derived structurally — heuristic regexes gone (2026-08-24)

- The verify:contracts N/N count was derived by FORMAT-SENSITIVE
  heuristics in two places: docs:sync-counts scanned lines starting
  with a bracket plus quote character (charCodeAt(1)===39) and
  docs:check regex-counted ^\s*\['[^']+' lines. A formatting change
  (multi-line entries, quote style, comments between entries) could
  silently drift the count or make the two sides DISAGREE.
- Now ONE shared structural derivation: src/lib/gate-count.ts parses
  tools/verify-contracts.ts with the TypeScript compiler API, finds
  the gates variable declaration (initializer may be as-const wrapped -
  the AsExpression is unwrapped), and counts the array ELEMENTS.
  Both docs:check (FAIL side) and docs:sync-counts (FIX side) import
  countGates() — a single source of truth, formatting-immune.
- docs-sync-counts.ts also replaced the regex header splice with a
  quote-free indexOf/digit-scan splice (no \d escapes to mangle).
- Tests (tests/lib/gate-count.test.ts): a fixture with multi-line +
  double-quoted + extra-element + as-const entries counts exactly;
  a missing gates array throws; the LIVE repo must count 52 — gate
  additions now fail the suite until docs:sync-counts is run.
- Verified: countGates() == old heuristic == 52; docs:sync-counts
  no-op ("already current"), docs:check 52/52, verify:contracts
  52/52, guard ok, typecheck clean.
- Artifacts: src/lib/gate-count.ts (new), tools/docs-sync-counts.ts
  (structural + quote-free splice), tools/docs-check.ts (import +
  countGates), tests/lib/gate-count.test.ts (new).

## 168. Full Bun shape generated structurally — tools/bun-shape.json (2026-08-24)

- The Bun-native stack had NO machine-readable full-API ground truth:
  the coverage matrix was a curated used-union-GATES view (140 rows) and
  type-drift probe regex-scanned concatenated dts. Both ALSO hardcoded
  the same bun-types bundle path. Now there is one source of truth.
- tools/bun-shape.ts (bun run shape:gen) parses the bundled bun-types
  for the pinned 1.4.0 with the TS compiler API (no regex — the
  countGates §167 pattern): every export of declare module bun is
  captured (name, ns, kind, typeOnly, docs, deprecated, extension).
  Sub-namespace members are captured at depth 2 (dns.prefetch,
  TOML.parse, ...). The internal namespace is excluded; abstract
  classes are classified type-only (they are not runtime-exported);
  Bun.FFI (declared in ffi.d.ts outside the module export set) is
  classified as a documented runtime extension. Globals are extracted
  from globals.d.ts. Docs flag = bundled mdx mention of the dotted
  name. Emits tools/bun-shape.json (committed).
- The bun-types bundle dir name is 1.4.0-<hash> — that hash is the
  bun-types PACKAGE version, NOT the runtime revision; do not assert
  the hashes match (verified: runtime 34cbb9a40 vs bundle c0dadede).
- Verified numbers: 503 members (331 top-level, 172 sub-namespace)
  + 79 globals; runtime live keys 110; 95 declared top-level values
  all present at runtime.

## 169. shape:probe gate — full-shape runtime agreement + exhaustive matrix (2026-08-24)

- tools/shape-probe.ts (bun run shape:probe, gate #53) pins the
  committed shape to the INSTALLED runtime: S1 freshness (version +
  revision), S2 every declared top-level VALUE exists, S2b namespaces
  live-or-type-only (informational), S3 every live member is mapped,
  S4 documented globals present. In-process only (no spawn, no keep-
  list entry). A Bun upgrade or a stale shape file fails here.
- tools/type-drift-probe.ts P1/P2 reworked to consume shape.json
  structurally (P1 every runtime member mapped, P2 readableStreamTo*
  via the deprecated flag) — the hardcoded bundle path is GONE from
  both the matrix and the probe.
- tools/bun-coverage-matrix.ts now derives rows from the FULL shape
  (503 rows, up from 140): Token | Runtime (live typeof) | Types |
  Docs | Gate | Uses. Gate map lives in src/lib/bun-gates.ts (shared
  with the report): gateFor() applies namespace inheritance. Usage is
  attributed to the LONGEST shape-matching key (Bun.argv.includes is
  usage of argv; Bun.TOML.parse is the TOML.parse member).
- Tier A (hard fail): used runtime members must have a probe gate —
  all 133 used members are probed (0 failures). Unused GAPs are
  reported, not fatal (3: readableStreamToFormData, sleepSync,
  version_with_sha). Every GATES key must exist in the shape (dead
  curated entries fail). coverage:matrix = shape:gen + matrix +
  module-shape:report + docs:sync-counts (auto-FIX side; verify:
  contracts header now 53/53).

## 170. Per-module shape report — docs/BUN_MODULE_SHAPE.md (2026-08-24)

- tools/module-shape-report.ts (bun run module-shape:report) groups
  Bun usage by module (src/research/<dir>, src/lib, tools, ...) with
  one rg pass, and annotates each token with its probe gate and docs
  status from the shape + bun-gates. Regenerates docs/BUN_MODULE_SHAPE
  .md (44 modules) — the data-driven per-module plans (§13) can now be
  grounded in per-API probed/used/docs status: a module row with a GAP
  gate is a used-but-unprobed API to prioritize.
- Spawns rg -> tools/module-shape-report.ts added to SPAWN_KEEP_LIST.
- Chained into coverage:matrix after the matrix generator.

## 171. Full-shape probe coverage closed — 0 GAPs + a broken-API pin (2026-08-24)

- The three unused runtime GAPs from §169 are closed: sleepSync,
  version_with_sha, and readableStreamToFormData now carry runtime:
  probe gates (P13/P13a/P13b). The matrix reports 0 unused GAPs -
  every runtime member of the full shape (156) has a probe gate
  (136 used, 136 probed).
- P13 sleepSync: blocks SYNCHRONOUSLY with ~100ms granularity (a 30ms
  request measured 180ms). P13a version_with_sha = v1.4.0 (34cbb9a40)
  (v + version + revision in parens).
- P13b PIN-NEGATIVE finding: Bun.readableStreamToFormData is BROKEN in
  1.4.0 - it throws for a standard multipart stream with SHORT
  boundaries (missing final boundary) and LONG boundaries (boundary is
  too long, >= 48 chars), while the SAME body parses fine via
  Response.formData(). The probe pins the breakage: if a future Bun
  fix makes it parse, the check flips FAIL for re-verification.
- The module report's unmapped rows are prose/placeholder/non-existent
  mentions (verified: Bun.rename documents non-existence; placeholder
  tokens like Foo and x; Bun.ffi intentional) - review-only, not drift.

## 172. Test-suite isolation flake fixed — bun test --isolate (2026-08-24)

- The main test script ran without --isolate, so test FILES sharing a
  worker process raced on file-level env swaps. The temp-cache helper
  already documented it: "Prefer bun test --isolate so file-level env
  swaps do not race across files." The race intermittently broke 3
  searchGitHubRepos ETag-cache tests in full-suite runs (a concurrent
  file's enterTempCache/exitTempCache swapped or deleted
  RESEARCH_CACHE_DB mid-test) - tests that always passed in isolation.
- Fix: "test" now runs bun test --isolate --parallel (the repo's
  test:parallel already used it). Full suite: 0 fail, 2535 tests in
  4.3s (vs 22s racing + retries) - faster AND deterministic.
- The real-failure fixes this round: docs:api STRICT flagged Foo/x as
  phantom tokens because §171 prose + the module-report note wrote
  prefixed placeholders - reworded to bare names; the report shows
  unmapped tokens without the Bun. prefix.

## 173. Module report pulls REAL code examples (2026-08-24)

- The per-module shape report now quotes the FIRST matching source line
  per token (Uses = matching source lines): docs/BUN_MODULE_SHAPE.md
  shows real usage like "return new Bun.CryptoHasher("sha256")..." for
  the execution module - the enhancement-plan data is grounded in actual
  code, not just counts.
- Sanitizer: the Bun. prefix is kept ONLY for LIVE runtime members.
  Placeholder tokens (Foo, x) and type-only namespaces (Security,
  ArchiveInput) in quoted source would otherwise reach docs:api STRICT
  as phantom tokens. Examples truncate at a word boundary (mid-token
  cuts created phantom tokens like deepEqu) and escape pipes for the
  markdown table.

## 174. Repo API grounded in the shape — docs/REPO_API_BUN.md (2026-08-24)

- tools/repo-api-shape.ts (bun run repo-api:shape) maps every
  ROUTE_MANIFEST entry (98 routes, 7 layers - the repo's API SSOT) to
  its handler's Bun usage: the handler is located with the TS compiler
  API and traced through its called functions (resolution-only BFS:
  same-file helpers + imported modules, imports-first priority, caps
  30 visited / 15 chain), plus global Web APIs (fetch, WebSocket,
  crypto...) from the shape. Regenerates docs/REPO_API_BUN.md.
- The trading layer rows show the compliance-gated authorized-
  execution surface: handleTradingOrder traced through
  executeKalshiLiveOrder -> placeOrder -> ... with Bun.env +
  fetch/URL/Response globals; handleTradingBook -> fetchKalshiOrderbook
  Wire with fetch + URL. Deep Bun surface (CryptoHasher etc.) is in
  the module report's src/partner/execution rows.
- BUG FIX in docs:api: TOKEN_RE ends in a word boundary, which can
  NEVER match Bun.$ (a trailing $ is a non-word char), so Bun.$ was
  invisible to the token scan and its call-sites flagged as MISSING
  (unallowed). Explicit Bun.$ scan added - docs:api STRICT now 0 drift.
- Chained into coverage:matrix after the module report. No spawn (TS
  parse + file reads only) - no keep-list entry needed.

## 175. bun:* reference module plane — grounded on bun.com/reference (2026-08-24)

- The /reference API page (bun.com/reference) is generated from the SAME
  bun-types bundle we parse locally - so grounding on it means covering
  its MODULE plane, not just the Bun namespace. The shape generator now
  parses every declare module "bun:*" declaration: bun:test (92 exports
  incl. expect/expectTypeOf/mock/spyOn), bun:sqlite (74 incl. Database/
  Statement/constants), bun:ffi (36 incl. dlopen/cc/CFunction), bun:jsc
  (33), bun:bundle (2 - TYPES-ONLY: bun:bundle cannot be imported at
  runtime, verified; excluded from the importability check like
  __internal).
- shape:probe S5: bun:test/bun:sqlite/bun:ffi/bun:jsc must import at
  runtime with key exports present (expect, expectTypeOf, Database,
  dlopen, jscDescribe) - 6/6 checks.
- PROVEN GAP FIX: the Bun.* token scan misses named imports - 44 files
  do import { X } from "bun" (serve.ts $, bun-settle.ts peek,
  github-network.ts dns+$) and 124 import Database from "bun:sqlite".
  The module report now counts the from-bun/bun:* import plane
  (alias-resolved to the real member; type imports count too): the
  execution module shows Database (15, sqlite:probe) and $ (shell:
  probe); the matrix counts from "bun" imports into member Uses ($
  48 -> 67, peek -> 8, dns -> 12). 63 modules now appear (was 49).
- Module exports gate via MODULE_GATES (bun:test->test:probe,
  bun:sqlite->sqlite:probe, bun:ffi->ffi:probe, bun:jsc->surface:probe,
  bun:bundle->build-deep:probe).

## 176. Automatic ETag/304 behavior probed — one docs claim corrected (2026-08-24)

- tools/etag-probe.ts (bun run etag:probe, gate #54) probes Bun's
  automatic ETag claims on the pinned 1.4.0, in-process:
- P1 CONFIRMED: new Response(await file.bytes()) static routes get an
  ETag AND If-None-Match -> 304; even a plain static Response gets an
  ETag (stronger than the docs claim).
- P2 CONFIRMED: fullstack dev server with development: false adds both
  ETag and Cache-Control (Cache-Control = no-cache, not a max-age).
- P3 CORRECTED (pin-negative, deep-probed): the docs claim "new
  Response(artifact) sets Content-Type and Etag" is WRONG on 1.4.0 -
  Content-Type is set (text/javascript;charset=utf-8) but Etag is NULL
  at construct time, after the body is read, served via a handler
  route, AND as a static route value (static values get Last-Modified
  instead). The companion claim "BuildArtifact extends Blob" is also
  WRONG (instanceof Blob = false; no .bytes()). If a future Bun adds
  the Etag, the checks flip FAIL for re-verification.
- P4 PARTIAL: S3Client.stat returns a Promise and S3Stats declares
  etag: string (type-level confirmed); a live etag VALUE needs a real
  S3 object - not probed, honest pin.
- BuildArtifact-side claims above are consolidated and evidence-grounded
  in §177 / docs/BUN_BUILD_FINDINGS.md (S01 method surface, S04 sourcemap).
- Grounds the repo's own conditional-request postures: serve.ts
  hand-rolls notModified()/If-None-Match for dynamic routes, and the
  route manifest marks /colors.css, /design-system.js etc cache: etag
  - the probe verifies the NATIVE behavior those postures build on.
- 7/7 checks; verify:contracts 54/54 (header auto-synced).

## 177. BuildArtifact gotchas probed — two docs corrections (2026-08-24)

- tools/build-artifact-probe.ts (bun run build-artifact:probe, gate #55)
  probes the seven documented BuildArtifact gotchas on 1.4.0, 18/18:
- P1/P2 CONFIRMED: with outdir, path is the absolute written path;
  without outdir, path is a bare name (./entry.js), nothing is written
  to disk, content via .text()/.arrayBuffer(). CORRECTED: .bytes() is
  NOT available on 1.4.0 (typeof undefined) - the docs list it.
- P3 CORRECTED: "hash can be null" is wrong for naming without [hash]
  (hash still computed, e.g. khtpy9tb). The REAL no-content-hash case
  is SOURCEMAP artifacts: they get a 00000000 placeholder hash.
- P4 CONFIRMED: sourcemap:external emits a sourcemap-kind artifact and
  artifact.sourcemap is a nested artifact object; sourcemap:none
  produces no sourcemap output.
- P5 CONFIRMED: kinds vary - splitting yields entry-point + chunk, a
  css import yields an asset kind, sourcemap yields sourcemap.
- P6 CONFIRMED: Response(artifact) sets Content-Type only - Cache-
  Control NOT set, Etag NOT set (consistent with §176).
- P7 CONFIRMED: a naming string applies to ENTRYPOINTS only; chunks
  keep [name]-[hash].[ext]; the object form { entry, chunk, asset }
  applies to all.
- BONUS gotcha discovered: naming "static/[name].js" (no [hash]) with
  a css-importing entry FAILS the build ("Multiple files share the
  same output path") - hash-less naming strings are unsafe for multi-
  output builds.
- FULL SHAPE claims probed (probe now 24/24): the interface is
  BuildArtifact-like, NOT extends Blob on 1.4.0 (instanceof=false,
  .bytes() absent) - but .size/.type/.text()/.arrayBuffer()/.stream()
  exist; loader reflects the SOURCE loader ("ts" for a .ts entry);
  entry-point hashes are PRESENT ("null by default for entry-points"
  is wrong on 1.4.0 - the null-ish case is sourcemap artifacts with
  the 00000000 placeholder); bytecode:true yields a bytecode-kind
  output; the nested artifact.sourcemap .text() returns the map JSON
  (version 3, sources).
- OPTION INTERACTIONS probed (probe now 33/33): default naming - entry
  paths carry no hash, chunk paths embed [hash], file-loader assets
  (png) ARE hashed, but CSS BUNDLES are NOT hashed by default
  ([name].[ext] - contradicts the "asset gets [name]-[hash].[ext]"
  claim); sourcemap modes - linked emits a separate artifact + a
  sourceMappingURL comment in the JS, external emits the artifact with
  NO linking comment, inline gives sourcemap null with the map
  base64-embedded in the JS, none gives null; loader overrides - a
  default unknown extension becomes a file-loader hashed asset, while
  loader {.xyz: text} INLINES the file (no artifact) - the override
  consumes the file rather than producing a re-loader artifact.
- verify:contracts 55/55 (header auto-synced).
- REFACTOR (2026-08-25): findings consolidated and grounded with REAL
  artifacts - docs/BUN_BUILD_FINDINGS.md (new) is regenerated from
  tools/build-artifact-evidence.json (bun run build-artifact:evidence ->
  build-artifact:findings): 42 scenarios in scratch/art-ground/, every
  BuildArtifact property and BuildConfig option OBSERVED on live 1.4.0
  (paths, hashes, sizes, MIME types, methods, compile executable bytes).
  New corrections pinned by the evidence: outfile is INERT on the API
  (bare-name output, nothing written; compile:{outfile} writes, S19/S07d);
  env:'inline'/'disable'/'PREFIX_*' do NOT substitute process.env.X on
  1.4.0 (S12 - use define for build-time constants); allowUnresolved only
  the default '*' passes non-literal import() through - [] and glob lists
  fail the build (S14); CSS assets report loader 'ts' on 1.4.0 (S01 quirk);
  entry-point hash is identical across sourcemap modes despite different
  output bytes (S04); compile:'bun' is invalid - target must start 'bun-'
  (S07b); compile:true + outdir writes a ~64MB standalone executable with
  kind still entry-point (S07a). Coverage matrix rows BuildArtifact /
  BuildConfig now gate build-artifact:probe (not GAP); probe extended to
  36/36 with evidence pinning (P17 evidence JSON matches runtime version/
  revision, P18 live surface agrees with evidence, P19 findings doc
  references the pinned revision).
- Blob#image() + BuildArtifact.slice() gotchas grounded (docs/BUN_BUILD_FINDINGS.md §5-§6):
  BuildArtifact.image() is ABSENT on 1.4.0 (P23, instanceof Blob false); the
  Blob#image() pipeline gotchas apply to Blob/Bun.file().image(); maxPixels
  guard boundary is EXACTLY 2^28 px (16384^2, P26); slice() returns a plain
  Blob (props lost, .bytes() gained, P20), byte offsets match Blob (P21),
  and NEGATIVE offsets deviate with outdir on 1.4.0 - negative start is
  empty, negative end is ignored, while no-outdir artifacts are
  spec-compliant (P22, docs/BUN_BUILD_FINDINGS.md §6 matrix); probe 36->39.
- Image constructor gotchas grounded (docs/BUN_BUILD_FINDINGS.md §7, image:probe
  41->46): path strings are FILESYSTEM reads (ENOENT when missing, P29);
  SharedArrayBuffer + resizable buffers rejected (ERR_INVALID_ARG_TYPE, P30);
  transferring the input buffer between ctor and terminal -> OBSERVED
  ERR_IMAGE_UNKNOWN_FORMAT, deviating from the documented ERR_INVALID_STATE
  (P31); maxPixels option honored (P32); autoOrient DEFAULTS TO true - EXIF
  Orientation=6 spliced into a Bun-encoded JPEG rotates 2x1 -> 1x2 by
  default, autoOrient:false keeps raw (P33). CORRECTED earlier wording: the
  maxPixels default is 268402689 px (0x3FFF^2 = 16383^2, same as Sharp),
  NOT 16384^2 - 16383^2 is accepted, 16384^2 rejects (strict exceeds).
- Prisma Compute image-transformations guide claims grounded (docs/BUN_BUILD_FINDINGS.md
  §8, image:probe 46->51): withoutEnlargement prevents upscaling (2x1 stays 2x1 at
  800x600, P34); resize(width, undefined, opts) accepted (P35); progressive JPEG
  emits SOF2 multi-scan (P36); palette PNG emits indexed color type 3 (P37);
  CORRECTED: Bun.s3 is an S3Client INSTANCE, NOT callable - Bun.s3("key")
  throws, use Bun.s3.file("key").image()/.write() (P38); crop/extract absent
  (needs an external library); saturation-0 grayscale not directly verifiable
  (no pixel-decode API on 1.4.0).
- DOC-HYGIENE round (2026-08-25): docs/bun-v1.3.14-catalog.md DEPRECATED
  (1.3.14-era; repo pins 1.4.0 — banner points to BUN_API_COVERAGE + BUN_BUILD_FINDINGS);
  docs/BUN_NATIVE.md now links the findings doc; BUN_SHELL.md negative claims
  gate-pinned (shell:probe 12->15): no .stdin() method (P13), callable-options
  AND $({...})`cmd` object forms both throw on 1.4.0 — chainable .cwd()/.env()
  are the supported options (P14/P15).

## 178. Reference cross-check — official bun-types docs vs observed evidence (2026-08-25)

- tools/reference-cross-check/ (bun run reference-cross-check, gate #56) audits
  the PINNED bun-types bundle (docs + bun.d.ts) against the observed evidence:
  every ledger claim must still find its doc fragment (DOC-CHANGED -> FAIL,
  re-verify) and resolve its evidence path (NO-EVIDENCE -> FAIL, ledger bug);
  verdicts CONSISTENT vs PINNED-DISCREPANCY (our corrections, non-fatal).
- 24 claims: 19 CONSISTENT, 5 PINNED-DISCREPANCY (BuildArtifact extends Blob
  is type-only; outfile inert on the API; env: no substitution;
  allowUnresolved glob lists fail the build; transferred Image input ->
  ERR_IMAGE_UNKNOWN_FORMAT not ERR_INVALID_STATE).
- Coverage sweep: 38 claims (33 CONSISTENT, 5 PINNED-DISCREPANCY), ZERO gaps -
  every declared BuildConfig option is now evidence-grounded. Last four,
  grounded with a fake-react fixture + virtual-file builds (build-artifact:
  probe P30-P33): files is VIRTUAL IN-MEMORY bundling (map of paths ->
  contents; NOT the standalone-executable embedded-files option - earlier
  note corrected); reactFastRefresh adds refresh registration markers;
  reactCompiler adds memoization guard checks, and client mode requires
  react/compiler-runtime to resolve while ssr mode builds without it
  (reactCompilerOutputMode honored).
- Outputs: tools/reference-cross-check/report.json (deterministic, committed)
  + docs/BUN_BUILD_FINDINGS.md §9 (regenerated; idempotent).
- Artifacts: tools/reference-cross-check/{index,run,compare,docs-parser,
  evidence-loader,reporter}.ts, package.json (reference-cross-check script),
  tools/verify-contracts.ts (gate #56), docs:sync-counts 56/56.
- Serve surface expanded (178): 7 serve ledger claims grounded offline on
  127.0.0.1 ephemeral ports - routes method-keyed + :id params (unregistered
  method -> 404 on 1.4.0), static Response/BunFile route values, dir routes,
  websocket upgrade + echo, error handler (500), port 0 ephemeral assignment,
  fetch fallback. Coverage sweep now includes the ServeOptions interfaces:
  remaining gaps are maxRequestBodySize, id, hostname, reusePort, ipv6Only,
  http1, idleTimeout, unix (+ jsx fragment/sideEffects) - 45 claims (40
  CONSISTENT, 5 PINNED-DISCREPANCY).
- bun:sqlite surface grounded (178): 8 SQ ledger claims - query cache,
  run changes/lastInsertRowid, transaction atomic rollback, serialize /
  Database.deserialize (STATIC, not an instance method), close semantics,
  constraint error codes, and the NAMED-PARAM MODE MATRIX: default mode
  requires PREFIXED keys ({':x': 10}), strict mode requires PREFIX-LESS keys
  ({y: 7}, sqlite-deep P2) - the sqlite.d.ts 'no longer need the prefix'
  comment is true only in strict mode (mode-dependent pin). Coverage sweep
  now includes bun:sqlite Database/Statement members: remaining gaps
  loadExtension, setCustomSQLite, fileControl, iterate, raw, finalize,
  toString. 53 claims (47 CONSISTENT, 6 PINNED-DISCREPANCY).
- URLPattern surface grounded (178): 6 UP ledger claims + evidence
  urlPatternGotchas - a runtime global but NOT importable from 'bun' and NOT
  declared in bun-types (shape gap; the repo typechecks via @types/node
  url.d.ts, which is now the cross-check source for it). Verified: object-form
  init, test/exec with pathname.groups.id, string+base form, wildcards
  (groups[0]), component matching (port/search; hash ignored when unpinned),
  regex groups (hasRegExpGroups), OPTIONAL-PARAM QUIRK (/users matches
  /users/:id? but /users/ does NOT), component getters. Sweep now includes
  URLPattern + URLPatternInit: remaining gap baseURL. 59 claims (53
  CONSISTENT, 6 PINNED-DISCREPANCY).
  Integration grounded (same source, second pass): the guide's Bun.serve fetch
  handler + URLPattern.exec(req.url) pattern works end-to-end offline
  (200 "User 123" / 404 fallback), and the "not related to Bun.build"
  distinction verified: BuildArtifact.path is a filesystem path and
  URLPattern.test rejects it (false) - evidence urlPatternGotchas.
  serveIntegration.
- REPO-AUDIT (sqlite named-param convention validated): no repo code uses
  prefix-less named-param keys (the silent-null hazard in default mode) and
  zero strict-mode Databases exist - all bindings are prefixed ({$id: ...})
  against default-mode DBs ({create: true}), which our mode matrix confirms is
  correct. The grounded convention is the repo's existing convention.
- GAP-CLOSE + STABILIZE round (178): 8 more ledger claims (67 total, 61
  CONSISTENT / 6 PINNED-DISCREPANCY) - Statement.iterate/raw/finalize/toString
  (raw() is a METHOD returning Array<Array<Uint8Array|null>>; raw=true
  assignment is a NO-OP), URLPatternInit.baseURL, Serve.maxRequestBodySize
  (over-size POST -> 413), jsx fragment/sideEffects. Remaining gaps are the
  offline-unprobeable pins: serve id/reusePort/ipv6Only/http1/idleTimeout/unix,
  sqlite loadExtension/setCustomSQLite/fileControl. url-health test stabilized:
  probeOfficialCatalog retries the report once (same 108 philosophy as
  probeHttp's network-failure retry) - transient DNS/connection hiccups no
  longer fail bun:ci; a genuinely dead endpoint fails both attempts.
- FULL-SURFACE round (178): Bun.cron (6 CR claims - parse is deterministic
  offline, tz honored, nicknames, invalid throws, CronJob handle), Bun.WebView
  (7 WV claims - navigate data: URLs, evaluate (NOT eval), screenshot,
  close()/Symbol.dispose disposal, no destroy), Bun.s3 (6 S3 claims - S3File
  surface, presign/stat/list reject ERR_S3_MISSING_CREDENTIALS offline). Two
  NEW type-vs-runtime discrepancies pinned: WebView back/forward and S3File
  data/options are DECLARED in bun-types but ABSENT at runtime on 1.4.0.
  Cross-check now 88 claims (80 CONSISTENT, 8 PINNED-DISCREPANCY); remaining
  4 gap groups are the offline-unprobeable pins (serve id/reusePort/ipv6Only/
  http1/idleTimeout/unix, sqlite loadExtension/setCustomSQLite/fileControl).
  THE GROUNDING SYSTEM IS AT FULL for the probeable surface: BuildArtifact,
  BuildConfig, Bun.Image, Bun.serve, bun:sqlite, URLPattern, Bun.cron,
  Bun.WebView, Bun.s3 all ledgered + evidence-grounded + sweep-covered.
- DEEP PASS (178): the 4 remaining 'unprobeable' gap groups were all probed -
  every one was probeable with the right approach: serve id (Server.id),
  reusePort (two binds / EADDRINUSE), ipv6Only (v6 ok / v4 refused),
  http1:false (THROWS unless http3:true - enforced), idleTimeout (1s did NOT
  close idle conns within 4s - honest pin), unix (unix-socket serving works);
  sqlite setCustomSQLite (first call true, after-Database throws SQLite
  already loaded), fileControl (returns 12 = SQLITE_NOTFOUND), loadExtension
  (REJECTS - the macOS system SQLite build does not support dynamic
  extensions). Cross-check now 97 claims (89 CONSISTENT, 8 PINNED-DISCREPANCY),
  ZERO gaps - every declared option on every covered surface is grounded.
## 179. Markdown probe artifacts — three false no-ops + one bogus discrepancy found by a third-party test (2026-08-26)

Running a third-party Bun.markdown coverage test (tests/lib/bun-markdown-coverage.test.ts) against the
pinned 1.4.0 exposed FOUR errors in the existing evidence/ledger. Probe fixtures must exercise the ACTUAL
construct the option governs, and every boolean "not observed" must be double-checked against the real output.

1. **noHtmlBlocks was probed with an inline `<div>` — that is a SPAN, not a block.** `html('x <div>y</div> z', { noHtmlBlocks: true })`
   keeps the div because inline HTML is governed by noHtmlSpans. A real block on its own line (`<div>block</div>` alone)
   DOES change: raw block passthrough stops, the block becomes a paragraph with inline HTML (`<p><div>block</div></p>`).
2. **tagFilter evidence searched for the wrong substring.** It looked for `&lt;script&gt;` (with `&gt;`) but the real output is
   `&lt;script>` — only `<` is escaped, `>` stays literal. So `includes('&lt;script&gt;')` was false and the option was recorded as
   a no-op. It WORKS (boolean true escapes script/style/iframe; table/div allowed).
3. **hardSoftBreaks "works" evidence used a two-trailing-spaces fixture — that is CommonMark's own hard-break rule**, `<br>`
   appears with the option OFF. With a plain newline (`Line 1\nLine 2`) the option has NO effect. So hardSoftBreaks is a true
   no-op, and the earlier CONSISTENT evidence was a probe artifact.
4. **MD-permissiveAtx was a BOGUS PINNED-DISCREPANCY.** The claim said "runtime default ON, types say false" but the default
   is OFF (`#NoSpace` → `<p>#NoSpace</p>`), matching the types. The earlier default-on probe result was wrong; corrected to
   CONSISTENT (kind 'discrepancy' → 'consistent', new evidencePath permissiveAtxTrueOn). PINNED-DISCREPANCY count 9 → 8.

Rule: for every option marked "no effect", probe BOTH the exact construct the type doc describes AND the negative case,
and assert on the real output string (print it) instead of guessing escaped forms. Third-party tests are cheap
adversarial probes — run them (corrected to the true contract) as regression suites.

Cross-check after corrections: 114 claims (106 CONSISTENT, 8 PINNED-DISCREPANCY), gaps 0.
## 180. react() override props: capture timing — function overrides only render under React (2026-08-26)

Probing whether Bun.markdown.react() overrides receive element props (id/language/href/src/checked/start/align)
almost produced a FALSE PINNED-DISCREPANCY. Function overrides are stored as the element `type` and the body
ONLY RUNS when React actually renders the tree — `Bun.markdown.react()` alone never calls them. A probe that
pushes to an array inside the override function body therefore records NOTHING, which looks like 'override
never fired / empty props'. Inspect the ELEMENT TREE instead (walk `el.props.children`, read `.type` and
`.props` on each node): with the right options the overridden elements DO carry id/language/href/title/
src/alt/checked/start/align — exactly per the d.ts contract (MD-reactProps, all CONSISTENT).

Also pinned: fenced code blocks produce ONLY `<pre>` (language prop on pre, no nested `<code>`); the `code`
ComponentOverrides key applies to INLINE code (codespan). Callback-contract facts: null/undefined return
omits the element; no callbacks -> children pass through; list meta depth 0/1/2 for nesting; ordered
start comes from the marker (3. -> 3); ul has no start; hr receives empty children; html/render/react
accept TypedArray/ArrayBuffer inputs (MD-renderOmit, MD-renderPassthrough, MD-listDepth, MD-inputTypes).
Cross-check now 121 claims (113 CONSISTENT, 8 PINNED-DISCREPANCY), gaps 0.
## 181. scratch-docs automation — index freshness gate + import-guard pitfall (2026-08-26)

The scratch/ area (git-ignored by design, .gitignore:71) now has automation:
  - `bun run scratch:docs` regenerates scratch/README.md as a byte-stable index
    (sorted file table: kind/size/orphan flag; fixture dirs with counts; NO
    timestamps so the gate output is deterministic).
  - verify:contracts gate #57 runs `scratch:docs --check`: missing README is
    bootstrapped (written, pass), existing-but-different exits 1 with a pointer
    to regenerate. Drift = someone added/removed a scratch file without regen.
  - `bun run scratch:sweep --apply` moves top-level probe/log files that are
    ORPHANED (basename not referenced by any committed code/docs set in
    REFERENCE_FILES) and untouched > 45d into scratch/.stale/<date>/. Default
    is --dry-run. Age is checked at sweep time only - never embedded in README.
  - gate count 56 -> 57: update tests/lib/gate-count.test.ts AND the
    AGENT-PITFALLS.md header 'verify:contracts N/N' (docs:check enforces it).

PITFALL: importing a tool script that ends in `process.exit(main())` RUNS main()
## 182. Utility surfaces grounded — Glob / CryptoHasher / password / escapeHTML / deepEquals (2026-08-26)

Goal round 2 extended the sweep with 8 claims (GL-scan, GL-match, CH-digest, CH-staticHash,
PW-hashVerify, PW-sync, EH-escape, DE-equal): 129 total, 121 CONSISTENT / 8 PINNED, gaps 0.
Notable pins:
  - Bun.password verifySync/hashSync 3rd arg is a STRING AlgorithmLabel ('bcrypt'), not an
    object — { algorithm: 'bcrypt' } throws ERR_INVALID_ARG_TYPE (types correct).
  - The widely-known $2b$10$ bcrypt hash for 'password' does NOT verify on Bun 1.4.0
    (bcryptKnownHashRejected) while Bun-generated bcrypt roundtrips fine — third-party
    bcrypt interop pin, recorded honestly as CONSISTENT observation.
  - deepEquals uses Object.is-style strictness: NaN===NaN true, -0 vs 0 FALSE, no == coercion.
  - CryptoHasher sha256('abc')/md5('abc') hex digests match the known published values.
  - Compression is NOT declared in the 1.4.0 bun-types (classMembers returns []) — skipped.
New regression suite: tests/lib/bun-utility-coverage.test.ts (9 tests, 25 expect calls).

on import. scratch-sweep.ts imports generate() from scratch-docs.ts and the
first version silently regenerated the README and exited before its own logic
ran. Guard with `if (import.meta.main) process.exit(main());` so the module is
safe to import.

After: verify:contracts 57/57 (scratch:docs gate active).
## 183. Blog-assets mirror — public/blog/ + /blog/* serve route + gate #58 (2026-08-26)

`bun run blog:assets` (tools/blog-assets-mirror.ts) regenerates public/blog/ from the
tracked blog data (.data/blog-map.json + blog-map-state.json + research/outputs/*.md
reports when present). The dev server serves it at /blog/* (dir route) with
/blog/index.json as the manifest (source https://bun.sh/blog/bun-v1.4, 55 entries).
Gate #58 `blog:assets --check` enforces freshness (bootstrap on missing, fail on drift).
Gate count 57 -> 58: update tests/lib/gate-count.test.ts AND the AGENT-PITFALLS header
(docs:check enforces the header count). Also fixed the scratch:docs drift from §181:
the README's fixture-dir section no longer renders file counts/bytes (probe gates
write into scratch/art-ground DURING parallel verify runs) — only dir NAMES, which
are stable across gate runs. verify:contracts 57/57 stable again before the +1.
## 184. Blog-map v2 — full-tree registry (13 sections, h3+h4, context fields) (2026-08-26)

The v1 tracker only registered the 55 h3s under 5 anchors and discarded the rest of
the bun-v1.4 release post. The cached HTML (research/cache/bun-blog.html, 2.6 MB)
has 286 id'd headings: 13 h2 / 150 h3 / 123 h4. v2 rethink:
  - extractTree() parses h2/h3/h4 with hierarchy (section/parent/level), version
    provenance parsed from the title anchor tags (clean FIRST — the ' v X.Y.Z'
    tags sit inside <a> elements, so raw-text regexes miss them), and per-heading
    context: codeBlocks (<pre> count), links (href count), excerpt (first 140
    chars of the section slice).
  - Registry v2: 271 unique h3/h4 entries (duplicate heading ids deduped — the
    blog repeats process-on-memorypressure and code-splitting ids), 55 curated
    (mappedTo/layer/status carried over from v1 by subId), 216 unmapped.
  - Contract: every blog h3/h4 must be REGISTERED (registration coverage 100%),
    curation = share with a real mapping status (20.3%) — separate signals.
  - h2 sections are grouping keys (entry.section), NOT registry entries — the
    first migration included them and the diff flagged all 13 as missing.
  - State file shape is additive (curation + total) — the mapping channel and
    pipeline-status keep reading coverage/matched/newUnmapped unchanged.
  - Curation of the 216 unmapped entries is the open work (map each to
    repo file/script + layer + status in .data/blog-map.json).
## 185. Strict typing migration — tsconfig + 661 errors fixed, behavior preserved (2026-08-26)

tsconfig.json now: strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes +
noImplicitOverride + noFallthroughCasesInSwitch + noImplicitReturns, types [bun] pinned
to bun-types 1.4.0. Enabling the extra flags surfaced 661 errors across 248 files
(most: TS2532/TS18048 possibly-undefined indexing; TS2379/TS2375 exactOptional).
Fixed via 15 parallel subagents + 1 cascade agent, patterns:
  - `!` ONLY where provably present (after length/in/type guards, fixed literal keys);
  - safe defaults `?? 0/""` when a default matches the intent;
  - conditional spread `...(v !== undefined ? { opt: v } : {})` for imported option types;
  - widen in-file declared types `opt?: T | undefined` (never foreign types);
  - zero @ts-ignore / as any introduced.
Vendored vendor/proton-pass (4 files, 7 errors) fixed in the vendored source (the repo
owns it per §91-93) then `bun install` refreshed the bun-cache copy. No behavior
change: full suite 2604 pass / 0 fail; tsc --noEmit exits 0 project-wide.
## 186. Blog benchmark + code-block verification — numbers and examples grounded (2026-08-26)

Two new tools verify the bun-v1.4 blog against this pinned runtime:
  - `bun run blog:bench-verify` (tools/blog-bench-verify.ts): measures the blog's
    benchmark claims (absolute numbers parsed from the cached HTML) on this machine:
    new URL() 49ns (blog 75), Buffer hex 164us/1MiB (blog 128), base64url 105us (blog 84),
    Promise.race 142ns (EXACT blog match), Promise.all 125ns (blog 207), await 18ns.
    Verdicts: CONSISTENT within 2.5x, DIFFERS beyond, RATIO-NOT-REPRODUCIBLE without a
    1.3 runtime, NOT-MEASURABLE for absent deps (isbot) or surfaces (Bun.SourceMap is
    NOT on 1.4.0 - the blog's `new SourceMap(json)` example uses an external class).
    Report: research/outputs/blog-bench-verify.md + .json.
  - `bun run blog:codeblocks-check` (tools/blog-codeblocks-check.ts): extracts the 233
    shiki code blocks, keeps the 36 that touch the Bun API, typechecks each against
    bun-types 1.4.0 with the repo strict tsconfig: 35 PASS / 1 PARTIAL / 0 FAIL. The
    PARTIAL is the blog's `tls: { ... }` ellipsis placeholder (TS1109 syntax, not a
    type error). Blocks are cross-referenced to the §9 ledger claims they touch
    (markdown/image/serve/cron/webview/spawn/sqlite/glob/crypto/password).
    Report: research/outputs/blog-codeblocks-check.md + .json.

BENCH PITFALL: a bench fn whose result is discarded gets DCE'd by the JIT (measured 0 ns).
Keep a live sink (module-level var written by every iteration, checked after) and create
fresh promises per iteration; `x ? 1 : 0` on a Promise trips TS2801 - attach .then instead.
FULL-COVERAGE EXTENSION (same session): the checks now cover ALL of the blog.
  - codeblocks-check: all 233 shiki blocks classified (89 code: ts/js/json; 144
    shell/output/other) and typechecked: 85 PASS / 4 PARTIAL / 0 FAIL. PARTIAL =
    blog illustration conventions only: `{ ... }` ellipsis placeholders (TS1109),
    duplicate-key before/after JSON (invalid strict JSON by design), truncated
    snippets. Classification pitfalls fixed: shell must be checked BEFORE ts (a
    `bun repl -e 'console.log(1)'` line contains console.log); JSON is validated
    by JSON.parse (object literals at statement position are not valid TS), with
    lenient comment/trailing-comma stripping.
  - bench-verify: extended to Production + Platforms. Code splitting 20,000-module
    graphs: measured 485 ms (blog 320 ms) using the grounded in-memory `files`
    option (BC-files) with ABSOLUTE /app/ keys - relative keys fail to resolve.
    Binary size macOS arm64: 60.6 MB (blog 61.2). Startup hello.js: 8.7 ms (blog
    5.1 Linux / 15.5 Windows). 9 CONSISTENT total; prod memory/CPU is app-specific
    (NOT-MEASURABLE); ffi 3x + installs 7x remain RATIO (no 1.3 runtime).

## 187. Extended color formats — kernel-only (lch/oklab/oklch/hsv) + inverse parsers (2026-08-26)

The color kernel (src/lib/color/kernel.ts) now emits lch/oklab/oklch/hsv in
addition to the Bun.color-native hex/css/rgb/hsl/lab/number:
  - Bun.color 1.4.0 REJECTS these as OUTPUT formats (verified: Bun.color(hex,
    "hsv" | "lch" | "oklab" | "oklch") throws; the runtime error enumerates the
    full accepted list — lab is the newest CSS4 OUTPUT, these four are absent
    from the guide table AND bun-types). Shapes are kernel-defined (documented
## 191. Code mode — the bash execution-tier gate (docs/CODE_MODE.md) (2026-08-26)

Researched the AI-agent 'code mode' concept (Claude Code canonical: plan mode =
read-only, code mode = execution-enabled, with ask/auto-accept/deny permission
tiers per tool category) and implemented it natively for our bash layer:
  - src/lib/bash-mode.ts: classifyBashTier(command) (read-only verbs: rg/grep/cat/
    tsc/git status|diff|log/bun test; compound && chains read-only only when every
    segment is) + runBashInMode(command, mode) via Bun.$ (guard-compliant).
  - tools/bash-mode-cli.ts: `bun run bash:mode [--mode plan|code] -- <cmd>`.
  - Plan mode BLOCKS full-tier commands ([plan mode] blocked, exit 2); code mode
    is today's full behavior. Mode NEVER affects the authorized-execution runtime
    gates (AGENTS.md) - they are independent of the bash tier.
Tests: tests/lib/bash-mode.test.ts (6 tests).

    in the color page probe table as W_NOTE).
  - INPUT parsing is the opposite split — see §189 for the correction: Bun.color
    PARSES lab()/lch() inputs natively (guide input list); it returns null only
    for oklab()/oklch()/hsv()/device-cmyk(), which the kernel parser covers.
  - Derivation facts locked by tests: hsv hue equals hsl hue (same geometry)
    for every palette color; lch derives from lab (L matches, C = hypot(a,b));
    oklab/oklch use the standard Ottosson matrices; lab uses the CSS Color 4
    D50 white point (Bradford-adapted from D65) to match Bun.color "lab".
  - Inverse parsers: labToHex/oklabToHex include the D50->D65 Bradford step
    and the linear->gamma sRGB re-encode; round-trip is exact for the kernel's
    own output strings (trimDecimals keeps 6 significant digits).
  - Related trap (design-tokens): prefer Bun.color "hex" over "css" for
    canonical palette values — "css" can emit NAMED colors (#FF0000 -> "red"),
    which breaks hex-string audits.

## 188. Watermark pipeline — ML-DSA key naming + WebView/Blob verified facts (2026-08-26)

src/lib/watermark-sign.ts watermarks via SVG -> Bun.WebView, then signs with
ML-DSA from node:crypto. Verified facts locked by tests:
  - node:crypto key type names are ml-dsa-44 / ml-dsa-65 / ml-dsa-87 — bare
    "ml-dsa" throws; modulusLength is RSA-only (ignored for ML-DSA).
  - Bun has NO Canvas/2D API (img.canvas is undefined) — text overlay must go
    through SVG rendered in Bun.WebView (data: URL; WebKit settle + retry).
  - Bun.WebView screenshot() returns a Blob (image/png); navigation to blob:
    URLs THROWS (WebKitBlobResource) — data: URLs keep it offline (repo 178
    gotcha). WebView capture is skipped under the parallel test suite (WebKit
    flakiness) — the real capture lives in `bun run watermark:sign`.
  - Blob across a worker: postMessage WITHOUT a transfer list clones (sender
    stays usable); WITH a transfer list it throws DataCloneError — transfer
    the ArrayBuffer, not the Blob.
  - Bun.Image .webp({quality}) is CHAINABLE (returns Image, not bytes);
    .bytes()/.write() are the terminals; .arrayBuffer() is NOT an Image method.

## 189. Color input-parsing correction — lab()/lch() parse natively, oklab/oklch/hsv/device-cmyk null (2026-08-26)

Correction to the §187 draft (the grounding pass re-verified every claim against
the official guide + live probes): Bun.color 1.4.0 INPUT parsing splits
differently than the OUTPUT format list:

  - PARSES (native): hex, named, rgb/rgba, hsl/hsla, hwb, color-mix, AND
    lab() / lch() — the guide input list documents "LAB strings like lab(50%
    50 50)"; lch shares the CSS parser (probe: both return hex).
  - NULL: oklab() / oklch() / hsv() / device-cmyk() — kernel-only.
  - OUTPUT: lab IS accepted (runtime error list + bun-types 1.4.0 both include
    it); lch/oklab/oklch/hsv THROW as outputs ("format must be one of ..." —
    the error enumerates the full list, which the guide table mirrors).

Grounding sources (all three agree):
  - Guide: research/cache/bun-docs/color.mdx (cached bun.com/docs/api/color)
    — output-format table + input list line for lab.
  - Runtime: Bun 1.4.0 live probes (this session) — output throw message list,
    lab/lch input -> hex, oklab/oklch/hsv/device-cmyk input -> null.
  - Types: node_modules/bun-types/bun.d.ts 1.4.0 Bun.color overloads — format
    literals include lab; no lch/oklab/oklch/hsv.

Repo surfaces corrected: kernel.ts parseExtendedColor docstring (was: lab/lch
inputs null — wrong), /api/color-info now tries Bun.color FIRST (native path,
parser: bun.color) with the kernel as fallback (parser: kernel), color page
probe table + advanced-input blurb, and parity tests in color-kernel.test.ts
that lock the split.

## 190. Canonical-asset generator — fit set + CryptoHasher.hash static grounded (2026-08-26)

src/lib/canonical-asset.ts produces a deterministic digital-asset tuple (PNG
bytes, SHA-256 asset hash, canonicalized metadata, digest). Claims re-verified
against the guide, runtime probes, and pinned bun-types 1.4.0:

  - RESIZE FIT is "fill" | "inside" ONLY. "cover"/"contain"/"outside" throw
    ERR_INVALID_ARG_TYPE ("fit must be one of 'fill' or 'inside'") — bun-types
    ImageResizeOptions.fit is "fill" | "inside". A draft of this module
    defaulted to fit:"cover" and would have thrown on every call; corrected.
  - Bun.file(path).image() is a SYNC factory (do not await it); terminals
    (.bytes()/.write()/...) are awaited (guide: "Nothing runs until you await
    the terminal"). png().bytes() is a valid terminal pair.
  - Bun.CryptoHasher.hash(algorithm, input, "hex") STATIC exists and returns a
    hex string; input may be string or Uint8Array. Passing the buffer avoids an
    intermediate JS string — measured 1515 vs 1710 ns/op on 4 KiB (buffer ~13%
    faster; content-pipeline §24 measured parity on 100MB). "arraybuffer"
    encoding still throws; instance digest() returns a Buffer.
  - Array sorting uses a deterministic typed-key comparator, NOT localeCompare
    (ICU locale-dependent + punctuation-ignoring — not canonical across
    environments; a test caught the draft's localeCompare producing
    environment-dependent order).
  - Float normalization: toFixed(precision) with trailing-zero strip; integers
    untouched; non-finite and |n| >= 1e21 pass through (toFixed would throw
    RangeError at 1e21).
  - Timestamp is explicit (epoch-0 fallback warns) — a changing timestamp
    changes the digest by design; same bytes + metadata -> byte-identical tuple.
    Surfaces: bun run canonical:asset CLI (writes .png + .metadata.json),
    bench:feature evidence, tests/lib/canonical-asset.test.ts.
## 192. Bun.XML grounded + async-IIFE evidence bug (2026-08-26)

Bun.XML surface grounded (8 claims: XML-parse/stringify/compact/xxe/import/bundler/
namedExport/perf): parse compact shape (@name attrs, #text, child arrays), tree
shape { compact: false }, stringify round-trips + escapes & < > + Date ISO + throws on
malformed names, XXE-safe (DOCTYPE/ENTITY left as literal text, never resolved),
.xml imports evaluate to the compact shape, Bun.build inlines .xml at build time
(output contains the parsed data), import { XML } from "bun" === Bun.XML, and the
SIMD perf claim measured: 6.2 ms for ~1.2 MB (docs: 27 ms for 2.2 MB) - CONSISTENT.
Cross-check: 153 claims (145 CONSISTENT / 8 PINNED-DISCREPANCY), gaps 0.
Docs source routing: run.ts only loaded docs/bundler/index.mdx - .mdx sources from
other paths (docs/runtime/xml.mdx) resolved to the bundler doc and DOC-CHANGED;
added xmlMdx + explicit source routing.

EVIDENCE PITFALL (invalidated earlier AR/UDP/FI values): an async IIFE in an object
literal (`staticWrite: (async () => {...})()`) returns a PENDING PROMISE -
JSON.stringify serializes it as {}, and the cross-check treats {} as a defined
value, so the claim passes against BOGUS evidence. Fix: top-level await
(`staticWrite: await (async () => {...})()` - the evidence tool is ESM). Only the
utilityGotchas password block used direct await and was correct. Re-verified:
udp loopbackEcho now records the real 'ping-42' round-trip; archive extractCount=2;
file writeBytes=3; xml import = compact shape.
## 193. Heap-based odds clustering — min-heap Prim MST + HDBSCAN-lite + z-score pitfall (2026-08-26)

The 'heap clustering for sources data and odds' ask is implemented zero-dep:
  - src/lib/min-heap.ts: generic binary min-heap (Prim's MST dependency).
  - src/alpha/cluster/hdbscan.ts: coreDistances -> mutualReachability -> primMST
    (heap) -> flatLabels. Deterministic: sorted edge iteration, tie-break by
    (weight, from, to). Flat labels use a LARGEST-GAP epsilon (the standard
    single-linkage elbow) but only when the gap exceeds 2x the median edge weight,
    so a dense uniform pocket stays ONE cluster.
  - src/alpha/cluster/odds-vector.ts: prints [implied%, vig, ts] -> z-scored vectors.
  - src/alpha/cluster/consensus.ts: detectShifts(prev, next) -> merge/split/new/
    dissolved signals (the steam-move alert).
  - tools/alpha-cluster-cli.ts: `bun run alpha:cluster` (synthetic fixture default,
    --input <json> supported) -> research/outputs/odds-clusters.{json,md}.
  - Tests: min-heap invariants, two-pocket split, dense-pocket merge, determinism,
    3-pocket odds separation, merge/split detection.

PITFALL (fixture + z-score): z-scoring a near-constant column AMPLIFIES its noise to
unit variance, so a tight vig jitter (~0.001) dominated the vector over the real
## 194. Artifact interface — uniform contract for bundles/tiles/manifests/XML + two proposal corrections (2026-08-26)

src/lib/artifact.ts implements the uniform Artifact contract (kind/path/hash/size/
type/sourcemap + text/json/arrayBuffer/bytes/stream) with helpers fromBuildOutput,
## 195. Bun 1.4 perf mapping - most proposal items ALREADY active here + 2 new grounded facts (2026-08-26)

A pasted Bun-1.4 performance mapping (targeting the proposal's own server.ts,
frontend/, tiles - none of which exist in this repo) was audited item by item:

ALREADY ACTIVE (verified in-tree, no work needed):
  - bun test --parallel + --isolate: package.json test script already uses both.
  - bun dedupe --check + prune --dry-run: tools/pre-commit.ts deps:check gate.
  - process.on('memoryPressure'): src/research/serve.ts:1326 registers the handler
    (clears bookCache + source catalog + auth + tennis board caches on 'critical');
    tests/research/serve-memory-pressure.test.ts covers it.
  - startup 50% faster + code-split 14x: measured by blog-bench-verify (8.7 ms,
    485 ms vs blog 320 ms - CONSISTENT).

NOT REPRODUCIBLE / SKIP: idle CPU 5x + HTTP memory 35% are app-specific (the blog's
fastify/express numbers, NOT-MEASURABLE); installs 7x is env-dependent; streaming
XML - Bun.XML.parse does NOT stream (the proposal admits it); build:all - no
frontend/tiles pipeline exists (no geo data).

NEW GROUNDED FACTS (157 claims, gaps 0):
  - Bun.Terminal EXISTS (class Terminal implements AsyncDisposable, TM-terminal);
    the proposal's terminal.warn() does NOT (warnFn undefined) - use console.warn.
  - bun --cpu-prof-md writes a Markdown CPU profile (CPU.*.md) - blog Observability
    claim grounded (evidence miscGotchas.cpuProfMd).

etagFor, responseFor (sets the strong ETag EXPLICITLY), sha256Hex (Bun.SHA256),
fromBunFile. New grounded facts (156 claims, gaps 0):
  - BA-namingHash: naming { entry: '[name]-[hash].[ext]' } makes the entry-point
    hash NON-NULL (strong ETag source).
## 196. Consensus tracker - steam-move shifts wired + k-default bug (2026-08-26)

src/alpha/cluster/tracker.ts: ConsensusTracker keeps the previous snapshot's labels
and emits merge/split/new/dissolved shifts on each push (the steam-move alert from
the clustering ask). Wired into tools/alpha-cluster-cli.ts (replaced the manual
two-snapshot shift code). Tests: first-push-no-shifts, merge detected across
converging snapshots, stable snapshots emit nothing, reset clears.

PITFALL (k-default): clusterOddsPrints defaulted k=5; the tracker passed only
minClusterSize, so for small pockets (4 points) the 5th-nearest neighbor was a FAR
point - the core distance collapsed to ~2.0 and the MRD had no intra-cluster
structure, producing ONE cluster instead of two (no merge was ever detected).
Fix: k now defaults to minClusterSize (HDBSCAN convention: core-distance neighbors
track the minimum cluster size) unless k is given explicitly. The CLI passes k=5
## 197. Styled integration - alpha:cluster --styled via markdown.ansi + Bun.Terminal PTY pin (2026-08-26)

alpha:cluster gained --styled: the consensus summary renders through the grounded
Bun.markdown.ansi surface (MD-ansi) - bold counts, heading, rule. Tested (ANSI
escapes present when --styled, absent by default).

Bun.Terminal grounded deeper: it is a PTY emulator (class Terminal implements
AsyncDisposable: constructor + write/resize/setRawMode/closed; TerminalOptions =
cols/rows/name + data/exit/drain callbacks; pairs with Bun.spawn({ terminal })).
The blog's Bun.spawn(["bash"], { terminal: { cols, rows } }) codeblock typechecks
(PASS in blog:codeblocks-check). Full PTY OPEN is NOT-MEASURABLE in this sandbox:
'Failed to open PTY' (no tty alloc) - same class as Bun.SourceMap. The proposal's
terminal.warn() does not exist (warnFn undefined) - Bun.Terminal is NOT a color API.
Evidence miscGotchas.terminal.ptyOpenInSandbox records the honest note.
## 198. Bun.YAML grounded - YAML 1.2 semantics confirmed (159 claims) (2026-08-26)

Bun.YAML surface grounded (YM-parse, YM-stringify): parse maps objects/arrays/
nesting; stringify emits flow style ({a: 1,b: [1,2]}); and the YAML 1.2 semantics
claimed by breaking-audit are CONFIRMED at runtime: 'v: yes' - string "yes",
'v: on' - "on", only 'v: true' - boolean true. Cross-check: 159 claims
(151 CONSISTENT / 8 PINNED-DISCREPANCY), gaps 0. Tests: bun-yaml-coverage (3).
The repo already consumes Bun.YAML in breaking-audit, docs-validate,
runtime-surface, format-probe - the claims now ground that usage.
## 199. ui:regen CLI - regenerate UI artifacts from meta/variant sources + the Bun.$ template failure class (2026-08-26)

tools/ui-regen-cli.ts (bun run ui:regen / ui:watch) regenerates the UI artifacts
from their meta/variant sources: design-tokens.ts - colors.css + color-system.json
+ TOKENS/COLORS docs + hq-app css (colors:artifacts), market-registry/registry.ts
- sports-sources.json (sports:registry:bake), .data/blog-map.json + reports -
public/blog mirror (blog:assets). --watch uses node:fs.watch (Bun.watch is
UNDEFINED on 1.4.0 - pinned) with a 250ms debounce; the dev server (bun --hot
serve) picks up the regenerated artifacts. Verified end-to-end: touching
design-tokens.ts logs the regenerating-colors line.

TOOL-CALL FAILURE CLASS (the repeated parse errors this session): program lines
containing Bun.$ followed by a BACKTICK tagged template with ${} interpolation get
mangled by the run_code lexer (the $-bash-lexing family). RELIABLE PATTERN: never
write Bun.$ tagged templates inside run_code program strings - call the repo's
runBunCommand(['run', script], { cwd }) helper (src/lib/run-bun.ts) instead, and
build file content with the plain p()-line array (no backticks, no ${, no \n inside
lines - newlines come from the join). ui-regen-cli.ts was written first-try with
this pattern.



explicitly so its 24-print fixture is unaffected.

  - BA-sourcemapNested: sourcemap: 'linked' nests a BuildArtifact whose hash is a
    '00000000' PLACEHOLDER - not a real hash.
  - BA-sha256: Bun.SHA256 exists (class SHA256 extends CryptoHashInterface);
    sha256('abc') hex = the known digest (same as CryptoHasher).

TWO PROPOSAL CORRECTIONS (the pasted 'auto-ETag' design was wrong on 1.4.0):
  1. new Response(artifact) sets Content-Type but NOT ETag from hash - you MUST set
     the ETag header yourself ('"' + hash + '"'). Same for new Response(Bun.file).
  2. BuildArtifact has NO .bytes() method - the read methods are arrayBuffer, text,
     json, stream (proto: arrayBuffer/hash/json/kind/loader/path/size/slice/
     sourcemap/stream/text/type). bytes() must be a helper over arrayBuffer().
Cross-check: 156 claims (148 CONSISTENT / 8 PINNED-DISCREPANCY), gaps 0.
The async-IIFE evidence pitfall from §192 recurred (sourcemapLinked) - always await
top-level in the evidence object.

implied-prob structure and smeared the pockets into one cluster. Fix: give each
pocket its own vig level (0.030/0.040/0.050) so the dimension reinforces the
separation instead of drowning it. Real data should choose vector weights or
scale vig with its actual signal, not z-score noise blindly.

Also: MinHeap comparator must return BOOLEAN (a.to < b.to), not the diff - the
strict types caught a number-returning comparator immediately (TS2322).



## 200. Bun.mmap grounded - live-updating Uint8Array, MAP_SHARED write-through, EINVAL/ENOENT, fixed length (2026-08-26)

Bun.mmap(path, opts?) grounded (MM-surface/liveWrite/liveRead/offsetSize/shared/
empty/missing/close; evidence block mmapGotchas; tests bun-mmap-coverage, 7).
- Returns a PLAIN Uint8Array (ctor Uint8Array, buffer ArrayBuffer); length = file
  size; .slice() reads offsets.
- MAP_SHARED default: writing to the array writes THROUGH to the file
  (m[0]=99, m[1]=42 -> file bytes 99,42,3).
- Reading is live: external file writes visible through the view. BUT appends
  after mapping are NOT seen - length is fixed at map time (3:1,2,3).
- offset/size map a window (offset 2 size 4 -> length 4); size clamped to file
  size minus offset (offset 1 size 1000 on an 8-byte file -> length 7).
- shared: false = MAP_PRIVATE: view mutation NOT written back to the file
  (file stays 10,20,30, view shows 111).
- Empty file -> SystemError EINVAL; missing file -> ENOENT (observed codes).
- Close = set the array to null (no handle API); no throw.
- Cross-check: 167 claims (159 CONSISTENT / 8 PINNED-DISCREPANCY), gaps 0.
  Repo adoption: none yet (probe-only, D12) - mmap is for hot big-file
  read-write paths; the video/assets pipeline currently uses Bun.file bodies.



## 201. Live consensus stream - ConsensusTracker wired into a repeated-snapshot consumer (2026-08-26)

src/alpha/cluster/live-consensus.ts (LiveConsensusStream) +
tools/alpha-consensus-watch.ts (bun run alpha:consensus:watch) - the live
consumer of the heap clusterer beyond the alpha:cluster CLI's two manual
pushes.
- LiveConsensusStream owns ONE ConsensusTracker across repeated snapshots;
  observe(prints, ts) per pass returns the snapshot (with shifts) and appends
  shifts to a bounded rolling window (windowSize, default 20) for alerting.
- observeEvents(events, ts) converts The Odds API wire shape via
  eventsToOddsPrints (signal-context) before clustering.
- alpha:consensus:watch polls fetchOdds(sport) on an interval (default 60s,
  --passes=0 = infinite), prints STEAM-MOVE lines on shift passes, and writes
  research/outputs/odds-live-watch.json. Requires ODDS_API_KEY; without it the
  fetch fails gracefully per pass (no artifact write, exit 0 after passes).
- Exported from src/alpha/index.ts (LiveConsensusStream + LiveConsensusOptions).
- Tests: tests/alpha/live-consensus.test.ts (5): first-pass no shifts, merge
  on move, bounded history, wire-shape conversion, <2 prints -> null, reset.







## 202. Bun.inspect + inspect.table grounded - table options (properties filter + colors), namespace custom symbol (2026-08-26)

Bun.inspect surface grounded (IN-table/tableProps/tableColors/tableShapes/options/
custom; evidence block inspectGotchas; tests bun-inspect-coverage, 7). Cross-check:
173 claims (165 CONSISTENT / 8 PINNED-DISCREPANCY), gaps 0.
- Bun.inspect is a function; Bun.inspect.table + Bun.inspect.custom live on a
  namespace (NOT in BunInspectOptions - the options interface is colors/depth/
  sorted/compact only).
- inspect.table(data, properties?, { colors }?) - properties is an ARRAY of
  column names (missing keys render BLANK cells; a STRING is ignored -> all
  columns); colors:true -> bold headers + YELLOW numbers (ANSI).
- Table shapes: object-of-objects -> outer keys as row labels; primitive arrays
  -> single Values column; mixed rows -> union (k + Values); empty -> minimal
  empty box; box-drawing with index column + trailing newline.
- BunInspectOptions ALL work: depth truncates with [Object ...], sorted reorders
  keys, compact:true single-line vs false expanded, colors ANSI.
- inspect.custom === Symbol.for(nodejs.util.inspect.custom) (Node parity);
  plain inspect CALLS it (CUSTOM-VALUE), inspect.table does NOT (the symbol key
  surfaces as its own column).
  Repo adoption: findings:term/alpha:cluster --styled already use ANSI;
  inspect.table is the zero-dep pretty-printer for CLI summaries.



## 203. Managed agent CLI - schedule register/remove/preview + offline daily ground/report cron worker (2026-08-26)

The agent CLI (bun run agent) is now managed like the tennis canary/experiment:
a schedule CLI + an OS-cron worker.
- src/agent/constants.ts: AGENT_CRON_TITLE=kalshi-agent-daily-ground,
  AGENT_CRON_SCHEDULE='0 6 * * *' (daily 06:00 local).
- tools/agent-schedule-cli.ts (bun run agent:schedule:{register,remove,preview}):
  registers src/agent/scheduled.ts via Bun.cron; preview uses Bun.cron.parse
  (UTC display, register is local time - same convention as the others).
- src/agent/scheduled.ts: runScheduledAgent() = discovery ground over cache.db
  (runDiscoveryGround, NO live GitHub) + agent report write (runAgentReportCmd ->
  research/reports/agent-report.{md,json}). Deps-injectable for tests; the
  scheduled() handler throws on non-zero so Bun.cron records the failed fire.
- ops:status orchestration now lists agent + agent:schedule:*.
- Tests: tests/agent/schedule.test.ts (5): parse CLI, constants defaults,
  worker delegation + exit-code surfacing. Worker smoke: runs the real offline
  pipeline end-to-end (ground + report write) in ~seconds.
  Note: agent-report.{md,json} are TIMESTAMPED regenerated artifacts - never
  stage their dirt; restore committed versions (git checkout) after smoke runs.



## 204. Bun.which grounded - absolute path/null, PATH override, cwd anchors relative commands AND PATH entries, long-bin error (2026-08-26)

Bun.which surface grounded (WH-surface/pathOverride/cwd/longBin; evidence block
miscGotchas.which expanded; tests bun-which-coverage, 5). Cross-check: 177 claims
(169 CONSISTENT / 8 PINNED-DISCREPANCY), gaps 0. Audits the pasted proposal:
- Returns an ABSOLUTE path string (ls -> /bin/ls on this machine) or null.
- options.PATH REPLACES the env PATH (same ls result with explicit
  /usr/local/bin:/usr/bin:/bin); PATH: '' -> null (no dirs to search).
- CORRECTION (proposal framing ambiguous): cwd anchors RELATIVE-PATH commands
  (./bin/x + cwd resolves, without cwd null) AND relative PATH ENTRIES
  (PATH: 'bin' + cwd resolves; PATH: 'bin' alone null). A BARE name with cwd
  -> null - cwd is NOT a search-dir addition (run-bun.ts already relies on
  the relative-PATH-entry behavior, §42).
- PARTIAL proposal claim: a long BIN NAME (100k chars) throws
  "bin path is too long"; a long PATH (20k x /x/) does NOT throw - returns
  null instead.
  Repo adoption: src/lib/run-bun.ts resolves the bun binary natively via
  Bun.which (never node:child_process); the PATH-replacement + relative-PATH-
  entry semantics are the load-bearing bits there.




## 205. CLI polish proposal audited - fictional desk.ts shell, NO_COLOR/FORCE_COLOR caller-gate truth, --format via Bun.YAML (2026-08-26)

Pasted 11-item CLI polish proposal audited against this repo:
- FICTIONAL shell: cli/desk.ts, ODDS_DATA_DIR/--data-dir, ~/.odds/config.json,
  .oddsrc - none exist. The real CLIs are tools/*-cli.ts (alpha:cluster,
  alpha:consensus:watch, bash:mode, ui:regen) + src/agent/cli.ts (which already
  has NESTED COMMANDS: status/ground/tennis/patterns/report/blueprint/run-research).
- FALSE claim: Bun has no yaml yet - Bun.YAML.parse/stringify grounded (§198);
  alpha:cluster now takes --format=json|yaml|table and renders yaml with it.
- ALREADY-PRESENT (deeper than the proposal): Bun.Glob helpers in src/lib/glob.ts
  (listFiles/listFilesAsync), inspect.table properties filter (§202), theme.ts
  NO_COLOR/FORCE_COLOR vocabulary (config.ts declares both).
- CORRECTED item 3 (color): Bun.inspect({colors:true}) and markdown.ansi emit
  ANSI even PIPED - env vars are IGNORED once colors are explicit; the CALLER
  must gate. Bun.color(hex,'ansi') is auto: EMPTY when piped, honors
  NO_COLOR/FORCE_COLOR only at process START (FORCE_COLOR=1 bun ... forces).
  alpha:cluster --styled now uses cliUseColor() (NO_COLOR=1/FORCE_COLOR=0 ->
  plain; verified: shell NO_COLOR=1 suppressed, FORCE_COLOR=1+NO_COLOR= emits
  escapes).
- WIRED: parseClusterCli validates --k/--min-cluster/--format (NaN/invalid ->
  exit 2, no silent Number() coercion), renderClusterSummary table/json/yaml.
- Cross-check: 178 claims (170 CONSISTENT / 8 PINNED-DISCREPANCY), gaps 0
  (IN-envColor pins the inspect-vs-env truth). Tests: alpha-cluster-cli (7).


## 206. alpha:cluster deeper - --help, --glob input via Bun.Glob, --verbose membership table (2026-08-26)

Completed the §205 audit items that were not yet wired into tools/alpha-cluster-cli.ts:
- --help / -h: clusterCliHelp() documents every flag (auto-help, item 2).
- --glob <pattern>: loadClusterPrints() expands a glob over research/outputs
  via src/lib/glob.ts listFiles (grounded Bun.Glob GL-scan/match, §9) and
  MERGES all matched feed files in sorted order (item 8). --input and --glob
  are mutually exclusive (exit 2). No-match -> exit 2.
- --verbose / -v: per-source cluster membership table via inspect.table
  properties filter (grounded §202); labels come from the tracker snapshot's
  labels map (result.prints are RAW OddsPrint, not labeled - pinned).
- loadClusterPrints is roots-injectable for tests (tmpdir fixtures).
- Tests: alpha-cluster-cli.test.ts now 11 (glob merge + no-match + single
  input + help flag coverage). Smoke: --glob matched 1 file -> 9 prints,
  1 cluster (z-score of 9 prints across 3 pockets is one cluster - correct).



## 207. CLI arg parsing audited against the official Bun guide - util.parseArgs is THE recommendation (2026-08-26)

Question: 'is this how bun recommends doing this?' - audited against the pinned
official docs (research/cache/bun-docs/guides-process-argv.mdx, bun-v1.4.0):
Bun deliberately does NOT ship its own parser; the guide says 'To parse argv
into a more useful format, use util.parseArgs' (node:util). Bun.Args does NOT
exist in 1.4.0 (grep of bun.d.ts + all bun-types: zero matches).
- REPO SPLIT: the schedule/tennis/match-liquidity/agent managed CLIs already
  use parseArgs (correct). A long tail of tools hand-rolled
  argv.find(a => a.startsWith('--x=')) + includes('--flag') - alpha:cluster,
  alpha-consensus-watch, watermark-sign, image-meta, blog-assets-mirror,
  brand-card, kalshi-secrets, canonical-asset, prune-content, content-verify,
  ops-cli, domain-cli, color-theme, licenses-gate, live-tracker, etc.
- MIGRATED NOW: alpha:cluster parseClusterCli -> util.parseArgs with shorts
  (-v/-h), strict:false + allowPositionals:true (lenient, repo convention),
  same error strings + defaults + exit codes (11 tests pass unchanged;
  --k=abc and --glob no-match still exit 2).
- Why parseArgs: value/boolean type separation, --flag=value AND --flag value
  forms, short aliases, unknown-flag policy, positionals - for free, instead
  of the hand-rolled startsWith subset. Remaining hand-rolled tools are
  LOW-RISK single-flag CLIs; migrating them is mechanical if desired.



## 208. Hand-rolled CLI parsing sweep - ALL tools/* migrated to util.parseArgs (2026-08-26)

Completed the S207 sweep: ZERO hand-rolled argv parsing remains in tools/.
- Shared SSOT src/cli/argv.ts (hasFlag/argValue/argValues) REBUILT on
  util.parseArgs: the schema is derived from argv (token with '=' or a
  following non-flag token => string multiple:true, else boolean), so the
  generic name-based API keeps working while all ~40 consumers get the
  recommended parser transitively. Test tests/cli/argv.test.ts unchanged,
  passes; full suite 2771 green.
- Migrated individually (parseArgs, strict:false + allowPositionals:true,
  behavior-identical): alpha:cluster, alpha-consensus-watch, kalshi-secrets
  (7 tests pass), prune-content, bun-claims-audit (positionals after --),
  live-tracker positionalAfterCmd (positionals after subcommand),
  watermark-sign + canonical-asset (tests pass), image-meta, brand-card,
  blog-story-server, research-resume, ops-cli, domain-cli, ui-regen,
  blog-assets-mirror, bun-blog-map, color-theme, bun-backup, kalshi-rotate-key,
  inventory-session-probe, tennis backfill-outcomes + build-player-profiles
  + build-player-opponent-profiles + harvest-nationalities, all five
  partner-execution demo tools, partner-sync-kalshi-lifecycle,
  partner-deliver-receipts, partner-reconcile-kalshi, design-budget-report,
  agent-encode, miss-taxonomy-status, bun-deps-audit, purge-ineligible-runs,
  partner-pandora-probe, partner-execution-schedule, host-discover,
  domain-event (regex positional via positionals), db-push-gate,
  protonpass-mint-pat.
- PITFALL caught: the blog-story-server port line fed Bun.env.PORT into a
  ternary ('port : Bun.env.PORT') which the breaking-audit env-port regex
  matched as a FALSE positive - restructured to avoid the token adjacency
  (const portEnv = Bun.env.PORT || '3456'; Number(...)). Audit ok again.
- Also: allowPositionals:true + Bun.argv.slice(2) means `--` still works,
  and positionals never leak the script path (bun-claims-audit note).
  Gates: 2771 tests pass / 0 fail, typecheck clean, breaking-audit ok,
  guard ok, docs:check 56/56.



## 209. Hand-rolled parsing sweep extended - src/calibration + scripts/* all on util.parseArgs (2026-08-26)

Continued the S208 sweep to src/ and scripts/ - ZERO hand-rolled argv parsing
remains anywhere in the repo (tools/, src/, scripts/):
- src/calibration/shadow-maintenance.ts parseMidArgs (--mid=TICKER:52 repeated)
  rebuilt on parseArgs with multiple:true (same Record<string, number> output).
- src/calibration entry points (maintenance, mark-toxicity, resolve-outcomes,
  toxicity-loop, init-program, cli) + src/alpha/run-shadow-once.ts migrated:
  --program/--file/--resolve/--dimension/--role as string opts; name as the
  first positional (init-program); passthrough still forwards non-program args.
- scripts/*: check-glossary-usage (hard/report/report-only/verbose),
  validate-glossary-urls (soft/og/json), generate-color-artifacts +
  generate-sports-source-artifacts (check), deps-outdated (json/latest).
- All strict:false + allowPositionals:true (repo convention, same as S208).
  Gates: 2771 tests pass / 0 fail, typecheck clean, breaking-audit ok,
  guard ok, docs:check 56/56. Smoke: glossary/colors/sports registry checks
  all green; calibration:maintenance still exits 1 with the usage text when
  --program is missing (unchanged behavior).



## 210. bun -p / bun -e one-liner cheat-sheet audited - inspect-style output (NOT JSON), {hsl} braced form invalid (2026-08-26)

Pasted 'bun -p / bun -e shape-inspection' one-liners audited against 1.4.0:
- OFFICIAL (pinned docs cli-run.mdx): -e/--eval = evaluate as script;
  -p/--print = evaluate AND print the result. Both verified live:
  bun -p "1 + 2" -> 3; bun -e "1 + 2" -> (no output).
- VERIFIED: bun -p Bun.inspect(Bun, {depth:2, colors:true}) prints the API
  shape; XML compact vs { compact: false } tree shapes exactly as claimed;
  Bun.inspect.table with colors works; BuildArtifact shape via bun -e
  (needs cwd with the entrypoint - ./index.ts resolved relative to cwd);
  bun:sqlite in-memory shape works.
- CORRECTED 1: Bun.color('royalblue', '{hsl}') THROWS (braced hsl is not a
  format). Bare 'hsl' works -> hsl(225, 72.7%, 56.9%); 'lab', 'number',
  'css', 'HEX' also work (S22 already lists them). The braced forms that
  work are {rgb}/{rgba}/{r,g,b} - and they return OBJECTS ([object Object]
  when stringified), not strings; [rgb]/[r,g,b] return comma strings.
- CORRECTED 2: bun -p output is Bun.inspect STYLE (JS literal: unquoted
  keys, root: {...}), NOT JSON - piping to jq FAILS (parse error). For jq,
  use bun -e + console.log(JSON.stringify(expr)) then pipe.
- Gotcha: bun -e needs the entrypoint path relative to CWD (ModuleNotFound
  for ./index.ts from the repo root); cd into the probe dir first.
  Repo habit: probes live in tools/scratch-*.ts + bun run, not inline -p
  (S199 lexer discipline applies to run_code program strings only).



## 211. Advanced bun -p diagnostics proposal audited - isTerminal/getColorDepth/Bun.File UNDEFINED, deepMatch is not a wildcard matcher (2026-08-26)

Pasted 10-item advanced bun -p/-e diagnostics harness audited against 1.4.0:
- -p color truth: FORCE_COLOR=1 -> ANSI even piped; NO_COLOR=1 / default
  piped -> plain. The 'auto-enables colours if stdout is a TTY' claim is
  WRONG - it is env-driven (same caller-gate truth as S205), NOT TTY-driven.
- CORRECTED APIs (all typeof undefined on 1.4.0): Bun.isTerminal,
  process.stdout.getColorDepth, and Bun.File (a TYPE BunFile, not a runtime
  value - `f instanceof Bun.File` throws ReferenceError; use
  `f instanceof Blob` + f.size/f.type, and process.stdout.isTTY - the repo's
  isTtyStdout() in src/research/terminal-out.ts).
- deepMatch (Bun.deepMatch, EXISTS) is NOT a shape/wildcard matcher:
  semantics = actual keys must ALL be present in expected (actual subset of
  expected), value-sensitive, no '*' wildcard, no partial arrays/nesting.
  The proposal's schema example ({root:{'@id':''}} vs parsed @id:'a')
  returns FALSE. For shape-shape comparison use deepEquals.
- VERIFIED: Bun.deepEquals exact compare; XML.parse(Blob) works
  (res.blob() -> parse directly); multi same-name children -> ARRAY
  (root.child is Array, elements string); [Bun.inspect.custom](d,o,i)
  signature works (Box({x:42}) with depth); performance.now() timing works
  (0.09 ms for 1000 children); try/catch surfaces 'XML Parse error'.
- CORRECTED: virtual entrypoint via new URL('data:text/javascript,...')
  FAILS on 1.4.0 (ENOENT failed to open root directory: data:text) -
  Bun.build needs a real filesystem entrypoint.
- fetch(file://...) -> blob works offline (mime application/json;charset=
  utf-8, size exact); use file:// or local servers for offline probes.
  Repo habit: probes in tools/scratch-*.ts, not inline -p (S199).



## 212. Proper definitions for the S211 corrections - resolveColorMode + isBunFile + shapeMatch wired into production (2026-08-26)

The S211 corrected items are now REAL production definitions, not doc notes:
- src/lib/color/theme.ts resolveColorMode(env, { isTty }): the proper
  color-depth detector (Bun.isTerminal / getColorDepth DO NOT EXIST).
  Grounded semantics: NO_COLOR wins; FORCE_COLOR 1|2|3 -> 16/256/16m;
  FORCE_COLOR=0 -> none; TTY -> 16m; piped no-env -> none. Verified the
  depth claim itself: Bun.color(hex,'ansi') under FORCE_COLOR=1 -> \x1b[36m
  (16), =2 -> \x1b[38;5;23m (256), =3 -> \x1b[38;2;r;g;b (24-bit) - the
  color-page claim is CORRECT (earlier red probe was depth-insensitive).
- src/lib/shape.ts: isBunFile(x) type guard (Bun.File is a TYPE not a
  runtime value; correct instanceof-Bun.File replacement: Blob + name/path),
  and shapeMatch(actual, schema) - the proper wildcard matcher the S211
  proposal wanted: '*' matches any value, nested objects recurse, array
  schema with one item checks every element, primitives deepEquals-style.
  Unlike Bun.deepMatch (actual keys must be in expected, value-sensitive),
  shapeMatch allows EXTRA actual keys (schema is a subset) + '*' wildcard.
- WIRED: tools/alpha-cluster-cli.ts cliUseColor() now delegates to
  resolveColorMode - this FIXED a latent bug: the old gate defaulted to
  true (color) when piped with no env; now correctly none. Test updated to
  the grounded semantics (piped -> false, FORCE_COLOR 1|2|3 -> true).
- Tests: tests/lib/shape-color-mode.test.ts (9) + alpha-cluster-cli (11)
  + cluster-styled (3) all green; end-to-end FORCE_COLOR=1 -> ANSI,
  NO_COLOR=1 -> plain, default piped -> plain.



## 213. bun -p/-e evaluation-engine proposal audited - TS + top-level await verified; getters/customInspect are Node options Bun ignores (2026-08-26)

Pasted 'Swiss Army knife' bun -p/-e proposal audited against 1.4.0:
- NEW VERIFIED: TypeScript works in BOTH -p and -e (bun -p "const x:
  number = 1; x + 2" -> 3); top-level await works in BOTH
  (bun -p "await Promise.resolve(42)" -> 42, -e with console.log too).
- NEW VERIFIED: depth: null shows EVERYTHING (Bun.inspect(Bun, {depth:
  null}) prints the full global); works via -p too.
- CORRECTED: getters: true does NOT evaluate getters (still [Getter]) and
  customInspect: false does NOT disable [Bun.inspect.custom] (still runs) -
  those are Node util.inspect options; BunInspectOptions is ONLY
  colors/depth/sorted/compact (S202 pin). Bun.inspect IGNORES unknown opts.
- CORRECTED: compact as a NUMBER is accepted but acts truthy/falsy
  (compact: 2 -> single line like true; compact: 0 -> expanded like false);
  there is NO element-grouping behavior. Type says boolean.
- CORRECTED (user check: 'is it the env?'): JSX is FULLY supported in
  -e AND -p. The earlier 'Cannot find module react/jsx-dev-runtime' error
  was MISSING ENV (this repo has ZERO runtime deps - no react), not a -p
  limitation. With a local jsx-runtime.ts + jsx-dev-runtime.ts in cwd,
  bun -p 'const el = <div className="a">hi</div>; JSON.stringify(el)'
  returns the real element {type,key,props,children}; -e works too.
- ENV CHECK pattern: 'bun env' is NOT a builtin (Script not found); the
  intended env inspection is bun -p 'process.env' or Bun.env - prints all
  30 keys (PATH/HOME present - env properly set). bun env --print in the
  repo resolves to the missing package.json script 'env'.
- RE-CONFIRMED (S211): the proposal's deepMatch schema example returns
  FALSE (value-sensitive: '' vs 'e1') and its 'actual contains all schema
  properties' framing is the REVERSE of reality (deepMatch checks actual
  keys are present in EXPECTED). Use shapeMatch (S212) for wildcard shape
  checks. The data: URL virtual build STILL fails (S211 ENOENT) and -p
  output is inspect-style (S210), NOT the claimed colors:true wrap - the
  wrap is env-aware (NO_COLOR/FORCE_COLOR), verified byte-level in S211.



## 214. Odds Heat metadata proposal audited - ETag auto-set is FALSE (S194 pin), cron job.active absent, revision is full hash; cluster metadata wired (2026-08-26)

Pasted 10-layer 'Meta Handling in the Odds Heat Pipeline' audited against 1.4.0:
- VERIFIED runtime metadata: Bun.version '1.4.0'; Bun.revision is the FULL
  40-char git hash (34cbb9a40b... NOT '1.4.0+34cbb9a40' - the proposal's
  version+hash format is wrong); Bun.main = entry path string; process.uptime
  function; Bun.env/process.env both 30 keys.
- CORRECTED (S194 PINNED-DISCREPANCY, re-confirmed): new Response(artifact)
  sets Content-Type from artifact.type but does NOT set ETag - the proposal's
  'ETag from artifact.hash automatically' is FALSE. etagFor() + explicit
  Response headers are required (src/lib/artifact.ts, BA-responseEtagNull).
- CORRECTED cron: Bun.cron(expr, fn) function form EXISTS and returns a
  CronJob with cron/stop/ref/unref + Symbol.dispose - but job.active does
  NOT exist (proposal wrong). GOTCHA: the default keeps the process ALIVE
  (ref'd) - .unref() lets the script exit (observed hang until unref).
- CORRECTED package.json: the proposal's 'odds-heat' 0.8.2 package is
  FICTIONAL - repo is kalshi-bot-research 0.2.0. peerDependenciesMeta is
  legitimately packed metadata (no runtime effect) - correct claim.
- VERIFIED XML: @-prefixed attrs, ALL string values (@live='true' string),
  repeated elements -> arrays (S192/XML claims).
- VERIFIED Bun.inspect.custom options object HAS stylize (function) +
  depth/colors - Node-convention held (S211 probe).
- VERIFIED bun:sqlite unixepoch() DEFAULT works (created_at number, age
  computes, JSON round-trip).
- WIRED: the proposal's fictional Cluster class getters (consensus/spread/
  tightness) now have a production home: clusterMetadata(prints) in
  src/alpha/cluster/odds-vector.ts, rendered per cluster by alpha:cluster
  --verbose. Tests: tests/alpha/cluster-metadata.test.ts (3).



## 215. Other Metadata Controls proposal audited - Bun.secrets EXISTS but takes {service,name}; Bun.env is writable + snapshotted; Env augmentation works (2026-08-26)

Pasted 'Other Metadata Controls in the Bun Pipeline' audited against 1.4.0:
- Bun.secrets EXISTS (get/set/delete) but the API is OBJECT-descriptor:
  secrets.get({ service, name }) -> value|null (verified null for missing);
  secrets.get('STRING') THROWS 'Expected options to be an object'. The
  proposal's string form is WRONG; the fallback pattern
  (await secrets.get({...}) || Bun.env.KEY) matches the pinned docs. Uses
  macOS Keychain Services / Linux libsecret / Windows Credential Manager.
- Bun.env is NOT read-only (writable at runtime - verified) and SNAPSHOTS
  at launch: 'changes to process.env at runtime won't automatically be
  reflected'. Typed as Env & NodeJS.ProcessEnv & ImportMetaEnv; the
  proposal's declare global { namespace Bun { interface Env {...} } }
  augmentation COMPILES (verified) - correct mechanism for typed keys.
- import forms ALL work on 1.4.0: bare './config.json',
  './config.json' with { type: 'json' }, and '.yaml' import (inlined
  object - S131 runtime loader pin).
- RE-CONFIRMED: Bun.isTerminal(process.stdout) is UNDEFINED (S211) - the
  proposal's parseArgs example uses it; use process.stdout.isTTY /
  resolveColorMode (S212) instead.
- Bun.build define constants + util.parseArgs + config merging + feature
  flags + /api/meta observability are all already grounded repo patterns
  (BC-define claim, S207/208 parseArgs, hq-view /api/* meta endpoints).
  Repo note: secrets live in Proton Pass + keychain wrappers today;
  Bun.secrets is the native alternative if wanted.



## 216. Deeper Bun 1.4 analysis audited - fs.rmdir({recursive}) REMOVED (new audit check #15), crypto.decapsulate/ML-KEM UNDEFINED, TOML v1.1 strict verified (2026-08-26)

Pasted 'deeper Bun 1.4 analysis' audited against 1.4.0. Most items were
already pinned (bun.lock v2, NODE_MODULE_VERSION 147, YAML 1.2, .env node
shim, TLS/checkServerIdentity, cron OS jobs, Terminal PTY, Image surface,
URLPattern, blog benchmarks S195). NEW findings:
- CONFIRMED + WIRED: fs.rmdir({ recursive: true }) is REMOVED - rmdirSync
  with recursive throws ERR_INVALID_ARG_VALUE on ANY dir (empty or not);
  fs.rmSync(path, { recursive: true, force: true }) works; plain rmdirSync
  on empty dir still works. ADDED breaking-audit check #15 (repo now 15
  checks): rgFiles rmdir(Sync)?\([^)]*recursive -> warn. Repo already uses
  fs.rm (no remediation); tests updated (14 cases) + new case.
- CORRECTED: crypto.decapsulate / crypto.encapsulate are UNDEFINED on 1.4.0
  (the ML-KEM claims are aspirational - typeof undefined; the repo's S22
  pin 'no crypto primitive need' holds). ML-DSA-65/87 via BoringSSL not
  exposed as a JS API either.
- CORRECTED: the --compile-autoload-* flags exist but are dotenv/bunfig
  autoload toggles (--compile-autoload-dotenv, --compile-autoload-bunfig,
  default true) - NOT the claimed --compile-autoload-tsconfig /
  --compile-autoload-package-json.
- VERIFIED: Bun.TOML.parse is strict (v1.1.0): duplicate keys rejected
  ('Cannot redefine key a'), date/time -> Temporal.Instant, basic parse
  works. Repo's toml-config.ts is on the TEMPORAL_ALLOWLIST already.
- Benchmark numbers: blog release claims (startup 5.1 ms etc.) were
  machine-verified in S195; the proposal's table mirrors those - treat
  absolute numbers as doc claims, our measured values are in S195.



## 217. Complete Bun 1.4 deep-dive audited - 'Zig to Rust rewrite' FALSE, static-route If-Match/If-Unmodified-Since -> 412 VERIFIED, color('reset') null (2026-08-26)

Pasted 'complete deep dive' audited against 1.4.0. Most items were already
pinned (S195 benchmarks, S216 ML-KEM/compile-autoload/rmdir/TOML, breaking-
audit lockfile/env/ws-handshake/publish-backpressure/v7). NEW findings:
- CORRECTED (false headline): 'complete rewrite of the core from Zig to
  Rust' is INVENTED. Bun's core is Zig; the pinned docs mention Rust only
  for SPECIFIC components: the JSON5 parser (docs/json5.mdx: 'written in
  Rust and passes 100% of the official JSON5 test suite') and the native
  plugin bindgen path. No docs claim a core rewrite.
- VERIFIED (new): static routes honor conditional headers - If-Match
  mismatch -> 412, match -> 200; If-Unmodified-Since before Last-Modified
  -> 412, after -> 200 (live Bun.serve probe). Not previously pinned; a
  real behavior for cache-conditional serving.
- CORRECTED framing: Bun.color('reset') returns NULL (both bare and with
  'ansi' format) - not a removal error; use raw \x1b[0m for reset.
- .xml import change (parsed doc, not path; --loader .xml:file old
  behavior) - the parsed-doc part is S192-pinned (xmlGotchas.
  importEvalToCompact); no --loader .xml:file flag exists in bun build --help.
- Other notes: WebSocket upgrade validation + publish() backpressure are
  breaking-audit checks 9/13 (S23); URLPattern/cron OS jobs/Image/Terminal
  are pinned surfaces (S195/S203/S22). Bun.cron in-process tz option
  verified in cronGotchas.



## 218. Why our security was not 'secret and defined' - the gap + the fix: SECRET_REGISTRY + argv-leak gate (2026-08-26)

Direct answer to 'why is our security not secret and defined': the secret
STORE was defined (src/lib/secrets.ts wraps Bun.secrets with the correct
{service,name} object API, injectable backends, env fallback - S215-correct)
and OUTPUT redaction existed (redact.ts). But two gaps made it not fully
'secret' nor 'defined':
- NOT SECRET: tools/kalshi-secrets-cli.ts --key-secret accepted a PLAINTEXT
  PEM on the command line (visible in ps/process list - the docstring even
  admitted it). The Kalshi key id was also accepted via --key-id (less
  sensitive, but still argv).
- NOT DEFINED: secret names were raw strings scattered across modules
  ('kalshi-api-key-id', 'kalshi-private-key' in kalshi-auth.ts + the CLI)
  with no single typed registry, so nothing enforced a source policy.
FIX (wired):
- src/lib/secret-registry.ts: SECRET_REGISTRY - every secret is a typed
  SecretPolicy {service, name, envName, sources, purpose}. Kalshi keys are
  vault+env ONLY, never argv. secretPolicy() throws on unknown names.
  argvSecretLeaks(argv) scans for secret-bearing flags (values redacted).
- kalshi-auth.ts: KALSHI_KEY_ID_SECRET/KALSHI_KEY_SECRET are now typed
  SecretName keys into the registry; service comes from the policy.
- kalshi-secrets-cli.ts store: --key-secret is REFUSED (exit 2) unless
  KALSHI_SECRETS_ALLOW_ARGV=1 (throwaway test keys only) - the plaintext-
  in-ps path is closed. Use --key-file / KALSHI_PRIVATE_KEY / PATH.
- Tests: tests/lib/secret-registry.test.ts (5): policy enforcement,
  single-source-of-truth, unknown-name throw, argv leak scan.
  Gates: 2789 tests pass / 0 fail; breaking-audit 15 checks ok.



## 219. Secret-leak audit GATE - repo-wide scan for plaintext-secret argv flags (2026-08-26)

Deeper than S218's single-CLI gate: the argv-leak protection is now a
REPO-WIDE gate wired into pre-commit + available as bun run secret:leak-audit.
- src/lib/secret-leak-audit.ts: scanSecretLeaks(root) rg-scans tools/
  scripts/ src/ CLI sources for secret-VALUE argv flags (--api-token=sk-1,
  --key-secret PEM). PATH-taking flags (--key-file, --pem) are allowed -
  the value is a path, not the secret. Values never appear in findings.
- tools/secret-leak-audit-cli.ts (bun run secret:leak-audit): exits 1 with
  findings; 0 when clean.
- pre-commit CONDITIONAL gate: fires on src/lib/secret-*.ts, src/lib/
  secrets.ts, tools/secret-leak-audit-cli.ts, tools/kalshi-secrets-cli.ts,
  tools/kalshi-rotate-key.ts (scoped to avoid colliding with the per-tool
  exact-path gates).
- TRAPS hit (worth pinning): rgFiles exits 2 (EMPTY result) when ANY path
  arg is missing - the scan filters to existing dirs; rgFiles returns
  paths RELATIVE to root - resolve join(root, f) before readFileSync;
  the scan itself must be excluded from its own results (scratch probes
  tripped it during dev).
- Verified clean: no secret values on any repo CLI argv. The Kalshi key
  id path (--key-id) is a non-secret id; --pem/--key-file are paths.
- Tests: tests/lib/secret-leak-audit.test.ts (3) + pre-commit.test.ts (13).
  Gates: 2793 tests pass / 0 fail; breaking-audit 15 checks ok.



## 220. Crypto/quantum truth + keys now defined - ML-DSA WORKS (persistent registered key), ML-KEM is keygen-only (2026-08-26)

Direct answer to 'why are we still not integrated with crypto/quantum and
have these keys defined':
- ML-DSA (post-quantum SIGNING) IS real on 1.4.0: node:crypto ml-dsa-44/65/
  87 key types + crypto.subtle.generateKey({name:'ml-dsa-65'}) both work;
  the watermark pipeline used it (S188) BUT regenerated the key pair on
  EVERY call - signatures were unverifiable afterwards. FIXED:
  watermarkKey() get-or-create a PERSISTENT key stored via Bun.secrets,
  typed in SECRET_REGISTRY ('watermark-mldsa-key', vault+env, never argv).
  watermarkAndSign now signs with the stable key; tests lock same-key
  reuse + sign/verify round-trip.
- ML-KEM (post-quantum ENCRYPTION) is keygen-ONLY: node:crypto
  generateKeyPairSync('ml-kem-768'/'ml-kem-1024') WORKS (ml-kem-512
  unsupported), but the KEM operations are NOT callable - crypto.subtle.
  encapsulate/decapsulate are UNDEFINED at runtime, subtle.generateKey(
  {name:'ml-kem-768'}) throws 'Unsupported key usage for an ML-KEM-768
  key', and node:crypto encrypt/decrypt on ML-KEM keys throws
  OPERATION_NOT_SUPPORTED. The pinned docs (nodejs-compat.mdx 'Fully
  implemented including encapsulate*/decapsulate*') OVERSTATES this build.
  So: no usable ML-KEM encapsulation on 1.4.0 - S216's 'crypto.
  decapsulate undefined' holds; the keygen part is what's new here.
- Keys defined: SECRET_REGISTRY now has 3 entries (kalshi-api-key-id,
  kalshi-private-key, watermark-mldsa-key) - every key has a typed policy,
  vault+env sources, never argv, and works through secrets.ts + the
  leak-audit gate (S218/219).
  Gates: 2796 tests pass / 0 fail; breaking-audit 15 checks ok.



## 221. SUPERSEDED - ML-KEM IS callable (see S223). The 'unusable' conclusion was OUR probe error (2026-08-26)

THIS SECTION IS WRONG - KEPT ONLY AS THE ERROR RECORD. The user's pushback
('the problem is us not the function') was correct. S223 has the truth:
crypto.subtle.encapsulateBits/decapsulateBits WORK with (algorithm, key)
arg order and the result property is 'sharedKey' (not 'sharedSecret').
The failures below were probe mistakes, not a JSC binding gap:
- WRONG property read: we inspected .sharedSecret (undefined) instead of
  .sharedKey - the round-trip had ALWAYS been working.
- WRONG arg order assumption: spec-shaped (key, algorithm) calls threw;
  the binding is (algorithm, key).
- The KeyUsage enum part WAS right (encapsulateBits/decapsulateBits, not
  encapsulate/decapsulate) - that part of S221 stands.
Do not cite this section for behavior; cite S223.

## 221a. (original wrong body below - historical record)

Direct answer: the methods DO exist on crypto.subtle but under JSC-internal
names + a non-standard argument contract that no documented JS shape
satisfies. The spec names in the docs/proposal are wrong for this build.
- Actual JSC surface: crypto.subtle has encapsulateBits/encapsulateKey/
  decapsulateBits/decapsulateKey (NOT encapsulate/decapsulate).
- The KeyUsage enum rejects 'encapsulate'/'decapsulate' ('value must be
  enumeration') but ACCEPTS 'encapsulateKey'/'encapsulateBits' -
  generateKey({name:'ml-kem-768'}, true, ['encapsulateKey','decapsulateKey'])
  SUCCEEDS and returns a real key.
- The KEM calls then fail: encapsulateKey.length === 5, decapsulateKey.
  length === 6 (the WebCrypto draft spec is 2 args). Errors name an
  internal param 'encapsulationKey' expecting 'an instance of ...' - a
  JSC C++ binding with its own argument layout. Every spec-shaped call
  ('Not enough arguments' / 'Type error') and passing CryptoKeys at every
  position ('Type error') fails. UNUSABLE from JS on 1.4.0.
- bun-types declares NONE of this (no KeyUsage union, no KEM methods) -
  the two pinned docs lines contradict: nodejs-compat.mdx line 424
  ('Fully implemented including encapsulate*/decapsulate*') is aspirational;
  line 112 ('Missing encapsulate/decapsulate') is the accurate one.
- Conclusion: ML-KEM keygen works (node:crypto + subtle with correct
  usages); the KEM operation is blocked by the JSC binding contract, not
  by our code. ML-DSA signing is the usable post-quantum path today (S220).
  Watch for a Bun bump that aligns the binding with the WebCrypto KEM spec
  (2-arg encapsulate/decapsulate).



## 222. MLKEM secrets one-liner audited - Bun.secrets.get string form CRASHES, no MLKEM key defined, decapsulation unusable (2026-08-26)

Pasted bun -p one-liner audited against 1.4.0 (re-confirms S215/S221 pins):
- CRASHES at line 1: Bun.secrets.get('MLKEM_PRIVATE_KEY') string form
  throws 'Expected options to be an object' - the API is the OBJECT
  descriptor { service, name } (S215 pin). The one-liner never gets past
  the first statement.
- No such key: object-form get({ service, name: 'MLKEM_PRIVATE_KEY' })
  returns null (not found). SECRET_REGISTRY has NO ML-KEM entry - the
  repo defines kalshi-api-key-id, kalshi-private-key, watermark-mldsa-key
  only. An MLKEM key would be useless anyway:
- The implied 'decapsulate, decrypt token' IS possible via
  crypto.subtle.decapsulateBits({name:'ml-kem-768'}, privateKey, ct) -
  S221 was wrong; see S223. The one-liner's real blockers are the
  secrets string-form crash + the undefined MLKEM key (below).
- CORRECT parts: fetch -> res.blob() -> Bun.XML.parse(blob) works (S211);
  Bun.inspect(parsed, { depth, colors }) works.
- CORRECTED version (what the pipeline should do today):
  const pem = await Bun.secrets.get({ service: 'com.kalshi-bot', name:
  'watermark-mldsa-key' }) - the REAL registered post-quantum key (S220)
  for ML-DSA signing, not ML-KEM decapsulation. Or env fallback
  WATERMARK_MLDSA_PRIVATE_KEY via the registry policy.
  Repo habit: probes in tools/scratch-*.ts + bun run, not inline -p (S199).



## 223. ML-KEM WORKS on 1.4.0 - the API, verified + wired (supersedes S221's wrong 'unusable' conclusion) (2026-08-26)

The user's pushback was right: the problem was OUR probe, not the function.
ML-KEM key encapsulation is fully callable via crypto.subtle on 1.4.0:
- Methods: encapsulateBits / decapsulateBits (the KeyUsage enum rejects
  the spec's 'encapsulate'/'decapsulate' - use the Bits strings).
- ARG ORDER: (algorithm, key) - NOT the spec's (key, algorithm).
- Result: encapsulateBits -> { ciphertext: ArrayBuffer (1088B @
  ml-kem-768), sharedKey: ArrayBuffer (32B) } - the property is
  'sharedKey', NOT 'sharedSecret' (our original probe read the wrong
  property and concluded 'unusable').
- decapsulateBits(algorithm, privateKey, ciphertext) -> ArrayBuffer;
  round-trip shared secrets MATCH; each encapsulate is FRESH.
- ml-kem-1024 also round-trips. ml-kem-512 unsupported (docs-pinned).
- WIRED: src/lib/ml-kem.ts (mlKemGenerateKey / mlKemEncapsulate /
  mlKemDecapsulate, typed, runtime-cast through the bun-types gap which
  still doesn't declare the Bits methods) + SECRET_REGISTRY entry
  'mlkem-private-key' (vault+env, never argv) - the keys are now defined.
- Tests: tests/lib/ml-kem.test.ts (3): round-trip, fresh secret, 1024.
  LESSON (the real S221 lesson): when an API 'doesn't work', verify the
  PROPERTY NAMES + ARG ORDER against the runtime, not the docs/spec -
  docs said encapsulate/decapsulate + sharedSecret + (key, algorithm);
  runtime is encapsulateBits/decapsulateBits + sharedKey + (algorithm, key).
  Gates: 2799 tests pass / 0 fail.



## 224. The CONFIRMATION PROTOCOL - surface first, then semantics, then test-locked positive (2026-08-26)

The S221->S223 episode was a PROCESS failure, not just a wrong answer: a
hand-rolled scratch probe concluded 'API unusable' from spec-shaped calls
without ever dumping the runtime surface. The protocol that would have
caught it in one step is now a verify gate (surface-confirm:probe, 59/59):
1. DUMP THE SURFACE FIRST: Object.getOwnPropertyNames(proto) + arity
   (.length) - anchors are DISCOVERED, never assumed from docs/spec.
   The ML-KEM surface dump shows encapsulateBits (arity 2) - the spec
   name encapsulate/decapsulate never existed; the runtime names did.
2. DERIVE THE CALL SHAPE FROM THE BINDING'S OWN ERROR TEXT: 'Argument 2
   (encapsulationKey) must be an instance of CryptoKey' reveals arg
   order (algorithm, key) - record it AND try it, don't just log it.
3. READ THE ACTUAL RESULT SHAPE: discover the property by name
   (/shared/i over Object.keys(result) -> sharedKey), never guess
   sharedSecret from docs. The round-trip was ALWAYS working.
4. LOCK A POSITIVE with assertions (test or probe gate). A scratch
   NEGATIVE is not confirmation - if the API works, the gate stays
   green and we know; if the API is truly absent, the gate FAILS and
   we know loudly instead of trusting a scratch note.
5. Docs are the NULL HYPOTHESIS: treat 'Fully implemented' as true and
   demand strong evidence (a working call) before declaring them wrong.
   The docs' substance (KEM implemented) was right; only the names/args
   notation differed.
This protocol applies to every future API confirmation. The S221 error
record + S223 correction are the case study; surface-confirm:probe is the
enforcement. Gates: verify:contracts 59/59.



## 225. Probe/surface/reference refactor - Bun.file + Bun.Glob consistency, and the symlink counter-lesson (2026-08-26)

Audited probe/surface/reference tooling for poor Bun API/CLI/Bun.file usage
and refactored the real gaps (all behavior-preserving; 503-shape matrix,
136 used / 0 gaps unchanged):
- tools/bun-shape.ts collectDocs: readdirSync({ recursive: true }) mdx walk
  -> listFilesAsync (Bun.Glob, src/lib/glob.ts) + Bun.file().text(). The
  file already used Bun.write; the sync recursive walk was the odd one.
- tools/shape-probe.ts + type-drift-probe.ts: readFileSync of
  bun-shape.json -> Bun.file(...).text() (top-level await files; the
  dead readFileSync import removed from type-drift).
- COUNTER-LESSON (the refactor almost went wrong): docs-parser.ts's
  readdirSync of node_modules/.bun-cache/links was NOT poor usage - the
  dir holds SYMLINKS and Bun.Glob.scanSync SKIPS them (probe-verified:
  readdirSync lists, Glob returns []). Reverted the Glob attempt; kept
  readdirSync + a comment documenting why. 'Use Bun-native' is NOT an
  unconditional rule - verify the tool fits the data shape first
  (the S224 confirmation protocol applied to our own refactor).
- Audited and left as-is (correct): node-compat-probe's deliberate
  node:child_process spawnSync (SPAWN_KEEP_LIST, S140 probe); bun-apis-
  probe's Bun.spawnSync of a probe file (keep-list); the d.ts
  readdirSync in bun-shape (sync top-level loop, small listing).
- No CLI misuse: surface/shape probes reference bun run only in doc
  comments; no inline bun -e/-p or wrapper shells in the tooling.
  Gates: 2799 tests pass / 0 fail; verify:contracts 59/59.



















