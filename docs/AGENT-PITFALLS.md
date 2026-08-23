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
