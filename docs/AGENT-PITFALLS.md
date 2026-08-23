# Agent working notes: pitfall catalog (read before editing)

Everything below is a real failure observed in this session, with the fix that
unblocks it. Order matters: run_code -> file tools -> bash/git -> tests -> verification.

## 1. run_code program text (the harness lexer)

| Symptom | Cause | Fix |
|---------|-------|-----|
| Parse errors like 'Expected comma' while authoring programs | Backticks or the two-char sequence dollar-open-brace anywhere in the program text (even inside template literals) | Keep program text template-literal-free. Literal backticks and dollar-open-brace ARE safe inside double-quoted JS strings (probed). For file content needing them, build from arrays joined by backslash-n, or fromCharCode(96), or string concatenation of the two pieces. |
| Same parse errors on multi-line 'strings' | Literal newlines inside JS string literals are illegal | Every multi-line payload is a line-array joined by backslash-n, or escaped newlines. |
| Parse errors when embedding TypeScript source | TS source uses double quotes; an inner quote terminates your outer double-quoted string | Use single-quoted JS strings for lines containing double quotes (watch apostrophes), double-quoted for lines containing apostrophes, escape when both appear. |

## 2. Calling the tools

- Only run_code is callable directly. bash, read, write, edit, todo_write,
  ask_user_question, web_search ... must be invoked from INSIDE a run_code program
  (await tools.edit(...)), or they fail with 'only run_code is callable directly'.
- tools.edit requires a prior tools.read of that file (bash cat/sed does NOT satisfy
  the policy). tools.write refuses to overwrite an existing file without reading it
  first.
- A run_code program that fails LATE can ROLL BACK edits made earlier in the same
  program (observed). After a failed batch, re-verify the file and re-apply if needed.

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

### 8c. What Bun does NOT help with (honest limits)
### 8d. Automate it: bun run agent:encode [file]

tools/agent-encode.ts reads stdin (or a file path) and prints the single-line
base64 - paste into run_code, decode with `echo <out> | base64 -d > target` or the
pure-Bun variant in 8a. Tested byte-exact (sha256 match) on content with
backticks, ${}, and mixed quotes.

### 8e. Kill the SHELL-quoting class: Bun.spawn with an args-array, not bash -c

A command string run through bash re-parses quotes, backticks (command
substitution), and ${} (expansion) - even when the JS string carried them safely
(the printf test above mangled its own payload exactly this way). Instead:

  const trickyArg = "it's ${x} and `y` and \"q\"";   // double-quoted JS string: lexer-safe
  Bun.spawnSync(["bun", "-e", "console.log(process.argv[1])", trickyArg]);
  // child received the arg VERBATIM - proven: exact match, no expansion/execution

Args-arrays are lexer-safe (values are double-quoted JS strings) AND shell-safe
(no re-parsing). Note: under `bun -e script arg`, the arg is argv[1] (argv[0] is
the bun binary; the -e script is not in argv).

### 8f. The run_code worker is plain Node - SOLVED with `bun run agent:probe`

Bun globals are NOT available inside a run_code program (Bun.spawnSync threw
'Bun is not defined'). SOLVED: `bun run agent:probe -- <code-file>` (or stdin)
writes the code to a repo-local `.probe-tmp.ts` (relative imports resolve), runs
it under bun, forwards stdout/stderr, and deletes the temp (verified). Pair with
agent:encode for tricky code: encode -> write .b64 -> base64 -d -> probe.

### 8j. Friction-killers shipped (this repo)
### 8k. Exit codes & processes (verified on 1.4.0)

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
  * Bun reference docs are now CACHED LOCALLY: bun:docs-index fetches 16
    curated .mdx pages (workers, child-process, image, markdown, xml,
    secrets, csrf, cookies, dns, fetch, tcp, udp, websockets, server,
    glob, sql) into research/cache/bun-docs/ with an INDEX.json manifest,
    24h freshness + --refresh/--check - verification cites local copies
    and can detect docs drift.
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
  Current run: 7/7 ok.
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
