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

### 8f. The run_code worker is plain Node

Bun globals are NOT available inside a run_code program (Bun.spawnSync threw
'Bun is not defined'). Any Bun API you need must run inside a bun script file:
tools.write the script (lexer-safe), then `bun /path/script.ts` via bash.

- The harness lexer parses the run_code program text BEFORE Bun runs - no Bun API
  can change that; base64 is the workaround, not a Bun feature.
- Bun.escapeHTML / JSON.stringify are NOT JS-literal-safe: verified that
  JSON.stringify leaves backticks AND dollar-open-brace unescaped in its
  output.
- encodeURIComponent is NOT safe: it escapes backticks and dollar-open-brace
  but LEAVES apostrophes - a single-quoted string breaks. Base64 (only
  [A-Za-z0-9+/=]) is the only reliably safe encoding; all three claims were
  probe-verified.
