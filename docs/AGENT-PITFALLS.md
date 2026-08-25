# Agent working notes: pitfall catalog (read before editing)

Everything below is a real failure observed in this session, with the fix that
unblocks it. Order matters: run_code -> file tools -> bash/git -> tests -> verification.

> **Numbering convention:** "pitfalls N" / "section N" references in this file
> and across the repo are HISTORICAL lesson counters from the 2026-08 audit
> rounds (the N-th lesson added) - NOT pointers to the §1-§11 headings above.
> The headings were renumbered to §1-§11 on 2026-08-23; the counters were kept
> so historical notes stay traceable.


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

Converted all non-keep-list `Bun.spawn` sites to `Bun.$` (see BUN_SHELL.md
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
