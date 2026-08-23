# Bun Shell (`Bun.$`) — deep reference

Canonical entry: [bun.com/docs/runtime/shell](https://bun.com/docs/runtime/shell#getting-started)

GitHub traffic is hybrid:

| Path | Transport |
|------|-----------|
| Repo search (discover) | [`github-search.ts`](../src/research/github-search.ts) — `Bun.fetch` + ETag cache |
| Inspect REST + code search + repo file contents | [`github-api.ts`](../src/research/github-api.ts) — `Bun.fetch` |
| Rate-limit preflight + budget facade | [`gh.ts`](../src/research/gh.ts) (no subprocess) / [`github-rate-limit.ts`](../src/research/github-rate-limit.ts) — `Bun.fetch` + `gh auth token` fallback |

No `Bun.spawn`, no `execa`, no Octokit. Token resolution still uses `gh auth token` when `GH_TOKEN` / `GITHUB_TOKEN` are unset.

Canonical `Bun.$` entry: [bun.com/docs/runtime/shell#getting-started](https://bun.com/docs/runtime/shell#getting-started)


## Repo-wide default (2026-08-23): `Bun.$` is the default subprocess transport

All subprocess calls under `src/`, `scripts/`, and `tools/` go through `Bun.$`
unless a hard reason exists (keep-list below). `bunfig.toml` `[run] shell = "bun"`
already routes every `bun run …` through Bun Shell; this section documents the
in-process side.

### Converted (2026-08-23 sweep — Phase A argv + Phase B pipelines)

| Area | Before | After |
|------|--------|-------|
| GitHub rate budget | `Bun.spawn(["gh","api","rate_limit"], pipes)` | `readGitHubRateLimitWire()` — `Bun.fetch` to `/rate_limit` (no gh subprocess) · `tools/github-rate-budget.ts` |
| Data-plane snapshot | git rev-parse / rm / commandSucceeds spawns | `$`git rev-parse --short HEAD` · `$`rm ${p}`.nothrow().quiet()` · `tools/snapshot-data-plane.ts` |
| Massey report dir | `Bun.spawn(["mkdir","-p",dir])` | `$`mkdir -p ${dir}`.nothrow().quiet()` · `tools/massey-crossref-cli.ts` |
| Serve launchd probe | `Bun.spawn(["launchctl","list"])` + kill-on-timeout | `$`launchctl list`.nothrow().quiet()` · `src/research/serve.ts` |
| Host discover TLS/DNS | s_client / x509 / dig spawns (stdin pipes) | `node:tls` `getPeerCertificate()` (SANs, zero subprocess) · `Bun.dns.resolveCname/NS/TXT/MX` (native DNS) · `src/domain/host-discover.ts` |
| Partner dashboard open | `Bun.spawn(["open",url])` | `$`open ${fileUrl}`.nothrow().quiet()` · `tools/partner-dashboard.ts` |
| Simplify-loop test run | `Bun.spawn(["bun","test",…])` pipes | `$`bun test ${[...testArgs]}`.cwd(ROOT).nothrow().quiet()` · `src/research/simplify-loop.ts` |
| Shadow tick | `Bun.spawn(["bun",runOnce,…])` inherit | `$`bun ${runOnce} ${passthrough}`.cwd(programDir).nothrow()` · `src/alpha/run-shadow-once.ts` |
| Cron jobs (7 sites) | `Bun.spawn(["bun","run",script], inherit)` | `$`bun run ${script}`.cwd(…).nothrow()` · `scripts/cron-main.ts` |
| deps outdated | `Bun.spawn(["bun","outdated"], env)` | `$`bun outdated`.env({…, NO_COLOR:"1"}).nothrow().quiet()` · `scripts/deps-outdated.ts` |
| Vault provisioning | pass-cli spawn + stdin write | `$`${bin} ${args} < ${Buffer.from(input)}`.nothrow().quiet()` · `tools/provision-fantasy402-vault.ts` |
| Guard git scan | `Bun.spawn(["git","ls-files","-z"])` | `$`git ls-files -z`.cwd(root).nothrow().quiet()` + NUL split · `scripts/audit-bun-native.ts` |
| Demo scenario runner | `Bun.spawn([process.execPath,"test",…])` + env | `$`${process.execPath} test ${spec.file} --test-name-pattern ${spec.pattern}`.env({…})` — undefined env dropped (verified) · `src/partner/execution/demo-scenario-runner.ts` |
| Regulatory CLI tests | `Bun.spawn({ cmd: […] })` pipes | `$`bun src/regulatory/scripts/… --db :memory:`.nothrow().quiet()` · `tests/regulatory/state-compliance.test.ts` |

### Keep-list — `Bun.spawn` / `Bun.spawnSync` stay (deliberate)

| Site | Reason |
|------|--------|
| `src/agent/research-runner.ts` | IPC — `process.send` / `serialization: "advanced"`; Bun Shell has no IPC channel |
| `src/lib/editor.ts` | `unref()` detach for the GUI editor; `$` has no unref |
| `tools/pre-commit.ts` · `tools/agent-probe.ts` · `src/lib/rg.ts` · `src/lib/breaking-audit.ts` | `Bun.spawnSync` in blocking sync contexts; `$` is async-only. `node:child_process` is guard-banned (`BANNED_PACKAGES`) |
| `tools/protonpass-run.ts` · `tools/db-push-gate.ts` | True TTY fds via stdio inherit — `$` pipes stdout/stderr (child `isTTY=false`), which can alter prompts/colors on the secrets wrapper and the destructive schema gate. (`$` does pass stdin through — verified — but stdout TTY-ness differs.) |


**Enforced:** `scripts/audit-bun-native.ts` `SPAWN_KEEP_LIST` — any `Bun.spawn` / `Bun.spawnSync` call outside these files fails `bun:ci` (AST-based; comments and strings are ignored).

### Idioms (verified on Bun 1.4.0)

- **Capture + exit code:** `.nothrow().quiet()` → `{ exitCode, stdout, stderr }` (Buffers).
- **Live output (≈ `stdout: "inherit"`):** `$` without `.quiet()` streams to the parent **and** still returns captured Buffers — used by the cron jobs.
- **stdin input:** no `.stdin()` method, and the callable-options form `$`cmd`({…})` does **not** exist in 1.4.0. Prefer JS-object redirection (verified): `$`cmd ${args} < ${Buffer.from(value)}`` feeds stdin, an empty buffer closes it immediately, and `< ${new Response(body)}` / `> ${Bun.file(path)}` also work. The `printf "%s" ${value} | cmd ${args}` pipe remains as a fallback.
- **NUL-delimited output:** `stdout.toString().split("\0").filter(Boolean)`.
- **`.text()` / `.json()` throw on non-zero exit** — prefer `.nothrow()` unless the caller wants the exception.
- **`.cwd(path)` / `.env({…})` methods exist;** array interpolation escapes each element as its own argv token.

### More verified on Bun 1.4.0 (recipes for future flows)

- **Command substitution `$(...)`:** `$`echo rev=$(git rev-parse --short HEAD)`` inlines another command output into the script (verified; backtick substitution is NOT supported — use `$(...)`).
- **Line streaming `.lines()`:** `for await (const line of $`cat list.txt | grep ${q}`.lines())` — gotcha: a trailing newline yields a final `""` entry, so `if (line !== "")` or filter(Boolean) when parsing.
- **stdout to file `> ${Bun.file(path)}`:** verified — write command output straight to disk.
- **stdout to buffer `> ${Buffer}`:** verified — writes into the existing buffer; remaining bytes are left untouched (NUL-padded in a fresh alloc).
- **`.run()`:** streams to the parent and returns `{ stdout, stderr, exitCode }` on success, but **throws on non-zero** (like the default `$`) — it is NOT a `.nothrow()` replacement; cron jobs keep `.nothrow()`.
- **`$.escape(str)` / `$.braces(template)`:** statics verified — build shell-safe fragments or generate brace-expansion variants.
- **No timeout/signal API in 1.4.0:** hand-rolled `Promise.race` + `Bun.sleep` timeouts (serve.ts launchd probe) remain the pattern.

### Known behavior deltas vs the old spawns

- `serve.ts` launchd probe: the 2 s race no longer kills the child on timeout (Bun Shell has no kill handle on the raced promise); `launchctl list` hanging is pathological, so the race still returns `null`.
- `host-discover` s_client: stdin closes immediately via `< ${Buffer.alloc(0)}` (same as the old `stdin.end()`).

### Cross-references with the rest of Bun (verified 2026-08-23)

The shell layer is the fallback for things Bun has no native API for (`gh`,
`git`, `launchctl`, `open`, `bunx`, `pass-cli`, `rg`, `find`; `openssl` only
for the h2 test cert-gen in `SPAWN_KEEP_LIST`). Where Bun has a native API
(or a Node-compat one, e.g. `node:tls`) the repository migrates off shell.

| Bun API | Cross-reference with the shell/subprocess layer | Where |
|---------|--------------------------------------------------|-------|
| `Bun.file` / `Bun.write` | `$` redirection `> ${Bun.file(path)}` / `< ${Buffer}` (tested in `tests/shell-idioms.test.ts`); artifact reads/writes beside `$`-gathered data | `tools/snapshot-data-plane.ts`, `tools/github-rate-budget.ts` |
| `Bun.which` | Resolves binaries handed to `$` / `Bun.spawn` (`pass-cli`, editor, `bun`) | `tools/provision-fantasy402-vault.ts`, `src/lib/editor.ts`, `tools/pre-commit.ts` |
| `Bun.spawnSync` ↔ `$` | Sync/async split of the same subprocess story (blocking gates vs async shell) | `tools/pre-commit.ts`, `src/lib/rg.ts`, `src/lib/breaking-audit.ts` |
| `Bun.spawn` (keep-list) | IPC (`research-runner`), `unref()` (`editor`), true-TTY interactive (`protonpass`, `db-push-gate`) | `SPAWN_KEEP_LIST` in `scripts/audit-bun-native.ts` |
| `Bun.env` / `.env()` | Per-call env merge into `$` (undefined values dropped) | `scripts/deps-outdated.ts`, `src/partner/execution/demo-scenario-runner.ts` |
| `Bun.sleep` | The only `$` timeout mechanism — `Promise.race` races | `src/research/serve.ts` (launchd probe) |
| `Bun.cron` | In-process scheduler whose 7 jobs spawn via `$` | `scripts/cron-main.ts` |
| `Bun.CryptoHasher` | Digests `$`-captured output into evidence hashes | `src/partner/execution/demo-scenario-runner.ts` |
| `Bun.Glob` | Programmatic file matching vs shell globs in `$` templates | `src/research/serve.ts`, `src/calibration/watcher.ts` |
| `Bun.dns` | **Native replacement for `dig`** — `resolveCname/NS/TXT/MX` (shapes: `string[]`, `string[][]`, `[{priority,exchange}]`; absent CNAME rejects → `.catch(() => [])`); types lag in 1.4.0 → isolated cast + runtime-surface check | `src/domain/host-discover.ts` `probeDns`, `src/institutions/fonbet/connection.ts` |
| `node:tls` (Node compat) | `tls.connect().getPeerCertificate()` replaces `openssl s_client` + `x509` — leaf SANs (`subjectaltname`) with zero subprocess (probed 1.4.0) | `src/domain/host-discover.ts` `probeTlsSans` |
| `Bun.Terminal` (PTY) | The isTTY=true option the interactive keeps need (`$` pipes stdout/stderr) | not used — keep-list reasoning |
| `Bun.Transpiler.scanImports` + `ts` AST | The enforcement loop — guard runs `git ls-files -z` via `$`, reads via `Bun.file`, walks AST for spawn sites | `scripts/audit-bun-native.ts` |
| `Bun.fetch` | REST half of research transport — GitHub REST + `/rate_limit` (`readGitHubRateLimitWire`); `$`→`gh` only for auth (token fallback + auth-status probe) | `src/research/github-api.ts`, `src/research/gh.ts`, `src/research/github-rate-limit.ts` |
| `bun:sqlite` | Stores what `Bun.fetch`/`$` gathers | `src/research/cache.ts`, `src/institutions/event-store/*` |

## Why `Bun.$` over `Bun.spawn`

| Concern | `Bun.spawn` | `Bun.$` |
|---------|-------------|---------|
| Argument escaping | Manual array | Automatic per interpolated value |
| JSON stdout | Manual stream read | `.json()` or `parseGhStdout` after `.quiet()` |
| Non-zero exit | Check `exitCode` | `.nothrow()` → `{ exitCode, stdout, stderr }` |
| Shell injection | Your problem | Escaped by default ([security](https://bun.com/docs/runtime/shell#security-in-the-bun-shell)) |
| Cross-platform | Depends on `/bin/sh` | Bun's built-in shell |

## Import style

Docs use both forms; this repo uses the named import:

```typescript
import { $ } from "bun";

await $`gh auth token`.nothrow().quiet();
```

`Bun.$` is the same tag on the global — either works.

## `gh` CLI usage today (post Bun.fetch migration)

The research pipeline talks to GitHub REST via `Bun.fetch` (`github-api.ts`,
`github-search.ts`, `github-rate-limit.ts` -> `readGitHubRateLimitWire`). The
`gh` CLI survives for two calls: the **auth-token fallback** in
`src/research/github-network.ts` and the **auth-status health probe** in
`tools/snapshot-data-plane.ts` (`commandSucceeds(["gh", "auth", "status"])`):

```typescript
const { exitCode, stdout } = await $`gh auth token`.nothrow().quiet();
if (exitCode === 0) return stdout.toString().trim();
```

`src/research/gh.ts` is now a **rate-limit facade** (preflight + budget
helpers over the Bun.fetch rate reader) - it contains no `$` call. The old
`ghJson`/`ghText` subprocess runners were removed as dead code (everything
moved to `Bun.fetch`; code search is `githubApiJson("search/code?...")`).

## Security notes for this CLI

Bun escapes interpolated strings ([docs](https://bun.com/docs/runtime/shell#security-in-the-bun-shell)):

```typescript
// SAFE - token treated as one literal argument to gh
await $`gh auth token`.nothrow().quiet();
```

**Argument injection** still applies to the `Bun.fetch` search URLs built
from queries (`encodeURIComponent` is not a security boundary). Queries come
from fixed `dimensions.json` + static keyword lists, not user stdin - but if
you add interactive mode, validate inputs.

**Never** do:

```typescript
await $`bash -c "gh auth token ${userInput}"`; // hands off to system shell
```

## ShellError shape (throwing path)

When `.nothrow()` is not used and exit ≠ 0:

```typescript
catch (err) {
  err.exitCode  // number
  err.stdout    // Buffer
  err.stderr    // Buffer
}
```

## Other `$` features (not used here, available)

| Feature | Doc anchor | When you'd reach for it |
|---------|------------|-------------------------|
| `.env({ … })` | [environment variables](https://bun.com/docs/runtime/shell#environment-variables) | per-call env override |
| `.cwd(path)` | [working directory](https://bun.com/docs/runtime/shell#changing-the-working-directory) | run a subprocess from another directory |
| `.lines()` | [line-by-line](https://bun.com/docs/runtime/shell#reading-output-line-by-line) | stream large outputs (git log, paginated API) |
| `$.escape(str)` | [utilities](https://bun.com/docs/runtime/shell#escape-strings) | build raw fragments safely |
| Redirect to `Bun.file` | [redirection](https://bun.com/docs/runtime/shell#redirection) | capture subprocess output directly to disk |

## bunfig

[`bunfig.toml`](../bunfig.toml) sets `[run] shell = "bun"` so `bun run research` uses Bun Shell, not `/bin/sh`. See [run.shell](https://bun.com/docs/runtime/bunfig#run-shell-use-the-system-shell-or-buns-shell).

## Tests

Pure helpers tested in [`tests/gh.test.ts`](../tests/gh.test.ts):

- `isRateLimited` - stderr classification (moved to `github-errors.ts`)

Live GitHub access is covered by `bun run research`, not unit tests.

## Related docs

- [`docs/BUN_NATIVE.md`](BUN_NATIVE.md) — full API map
- [`docs/PLAN.md`](PLAN.md) — research pipeline design
