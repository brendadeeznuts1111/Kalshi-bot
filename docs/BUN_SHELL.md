# Bun Shell (`Bun.$`) — deep reference

Canonical entry: [bun.com/docs/runtime/shell](https://bun.com/docs/runtime/shell#getting-started)

GitHub traffic is hybrid:

| Path | Transport |
|------|-----------|
| Repo search (discover) | [`github-search.ts`](../src/research/github-search.ts) — `Bun.fetch` + ETag cache |
| Inspect REST + code search + repo file contents | [`github-api.ts`](../src/research/github-api.ts) — `Bun.fetch` |
| Rate-limit preflight + legacy `gh` helpers | [`gh.ts`](../src/research/gh.ts) / [`github-rate-limit.ts`](../src/research/github-rate-limit.ts) — `Bun.$` → `gh` |

No `Bun.spawn`, no `execa`, no Octokit. Token resolution still uses `gh auth token` when `GH_TOKEN` / `GITHUB_TOKEN` are unset.

Canonical `Bun.$` entry: [bun.com/docs/runtime/shell#getting-started](https://bun.com/docs/runtime/shell#getting-started)

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

await $`gh ${args}`.nothrow().quiet();
```

`Bun.$` is the same tag on the global — either works.

## Pattern used in `gh.ts`

### 1. `.nothrow().quiet()` — explicit exit handling

Default `$` throws on non-zero exit ([error handling](https://bun.com/docs/runtime/shell#error-handling)). For retry logic we need `exitCode` and `stderr` without catching:

```typescript
const { exitCode, stdout, stderr } = await $`gh ${args}`.nothrow().quiet();

if (exitCode === 0) {
  return parseGhStdout<T>(stdout);
}
```

- `.quiet()` — suppress live stdout/stderr during batch research runs
- `.nothrow()` — never throw; inspect `exitCode` yourself

Alternative (throwing path):

```typescript
try {
  return await $`gh ${args}`.json(); // .text()/.json() imply .quiet()
} catch (err) {
  // ShellError: err.exitCode, err.stdout, err.stderr (Buffers)
}
```

We prefer `.nothrow()` so rate-limit retries don't rely on exception types.

### 2. Array interpolation — dynamic `gh` argv

```typescript
const args = ["search", "repos", query, "--json", "fullName", "--limit", "30"];
await $`gh ${args}`.nothrow().quiet();
```

Bun expands `args` as separate argv tokens — equivalent to `gh search repos "kalshi bot" --json fullName --limit 30`. Each element is escaped individually.

### 3. `.json()` vs manual parse

| `gh` output | Use |
|-------------|-----|
| `gh search … --json field1,field2` | `.json()` or `parseGhStdout` after `.quiet()` |
| `gh api … --jq .login` | `.text()` only (plain string, not JSON) |

This research CLI only uses `--json` fields, so `parseGhStdout` is sufficient after `.nothrow()`.

### 4. Rate-limit backoff

```typescript
// @see https://bun.com/docs/runtime/utils#bun-sleep
if (isRateLimited(stderr.toString()) && attempt < retries - 1) {
  await Bun.sleep(2000 * (attempt + 1));
  continue;
}
```

Code search (`gh search code`) hits secondary limits first — backoff is linear, concurrency capped in [`pool.ts`](../src/research/pool.ts).

## Security notes for this CLI

Bun escapes interpolated strings ([docs](https://bun.com/docs/runtime/shell#security-in-the-bun-shell)):

```typescript
// SAFE — query treated as one literal argument to gh
await $`gh ${["search", "repos", maliciousQuery, "--json", "fullName"]}`.nothrow().quiet();
```

**Argument injection** still applies: a malicious repo name passed as `repo:owner/name` in code search could confuse `gh`. Our queries come from fixed `queries.json` + static keyword lists, not user stdin — but if you add interactive mode, validate inputs.

**Never** do:

```typescript
await $`bash -c "gh search repos ${userInput}"`; // hands off to system shell
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
| `.env({ … })` | [environment variables](https://bun.com/docs/runtime/shell#environment-variables) | `GH_TOKEN` override per call |
| `.cwd(path)` | [working directory](https://bun.com/docs/runtime/shell#changing-the-working-directory) | run gh from a git worktree |
| `.lines()` | [line-by-line](https://bun.com/docs/runtime/shell#reading-output-line-by-line) | stream large `gh api` paginated output |
| `$.escape(str)` | [utilities](https://bun.com/docs/runtime/shell#escape-strings) | build raw fragments safely |
| Redirect to `Bun.file` | [redirection](https://bun.com/docs/runtime/shell#redirection) | cache gh output directly to disk |

## bunfig

[`bunfig.toml`](../bunfig.toml) sets `[run] shell = "bun"` so `bun run research` uses Bun Shell, not `/bin/sh`. See [run.shell](https://bun.com/docs/runtime/bunfig#run-shell-use-the-system-shell-or-buns-shell).

## Tests

Pure helpers tested in [`tests/gh.test.ts`](../tests/gh.test.ts):

- `isRateLimited` — stderr classification
- `parseGhStdout` — JSON parse + empty stdout

Live `gh` integration is covered by `bun run research`, not unit tests.

## Related docs

- [`docs/BUN_NATIVE.md`](BUN_NATIVE.md) — full API map
- [`docs/PLAN.md`](PLAN.md) — research pipeline design
