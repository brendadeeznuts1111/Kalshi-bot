# Bun-native API grounding

This project uses **zero runtime npm dependencies**. Every capability maps to a Bun builtin or Node stdlib (`node:util` for `parseArgs` only).

**Rule:** before adding any package, check the [Bun API map](#bun-api-map) below — the runtime almost certainly already provides it.

Canonical URLs: [Bun docs index](https://bun.com/docs/llms.txt) — use the [@see links](#canonical-see-links) table below (standalone repo; monorepo `bun tools/bun-doc-refs.ts` is optional).

Deep dive: [`BUN_SHELL.md`](BUN_SHELL.md) (`Bun.$` patterns)

## Bun API map

| Capability | Runtime utility | Used in |
|------------|-----------------|---------|
| Subprocess / `gh` calls | `Bun.$` + `.json()` / `.text()` via `.nothrow().quiet()` | [`gh.ts`](../src/research/gh.ts) |
| Preflight `gh` on PATH | `Bun.which("gh")` | [`preflight.ts`](../src/research/preflight.ts) |
| Config load | `Bun.file(…).json()` | [`discover.ts`](../src/research/discover.ts) |
| Artifact write | `Bun.write` | [`io.ts`](../src/research/io.ts), [`report.ts`](../src/research/report.ts) |
| CLI JSON stdout | `Bun.write(Bun.stdout, …)` | [`cli.ts`](../src/research/cli.ts) |
| Env overrides | `Bun.env` (`RESEARCH_*`) | [`cli.ts`](../src/research/cli.ts) |
| Package-root paths | `import.meta.dir` | [`paths.ts`](../src/research/paths.ts) |
| CLI entry guard | `import.meta.main` + `#!/usr/bin/env bun` | [`cli.ts`](../src/research/cli.ts) |
| Embedded cache + run history | `bun:sqlite` + `Bun.hash` | [`cache.ts`](../src/research/cache.ts) |
| Rate-limit backoff | `Bun.sleep` | [`gh.ts`](../src/research/gh.ts) |
| Bounded concurrency | [`pool.ts`](../src/research/pool.ts) | [`cli.ts`](../src/research/cli.ts), [`inspect.ts`](../src/research/inspect.ts) |
| Scheduled research | OS-level `Bun.cron` | [`scheduled.ts`](../src/research/scheduled.ts), [`schedule-cli.ts`](../src/research/schedule-cli.ts) |
| Audit digests | `Bun.CryptoHasher("sha3-256")` | [`audit-adapter.ts`](../src/research/audit-adapter.ts), [`export-audit.ts`](../src/research/export-audit.ts) |
| GitHub URL SSOT | `BunURLPattern` + `URLPattern` ([v1.3.4+](https://bun.com/blog/bun-v1.3.4#urlpattern-api)) | [`patterns.ts`](../src/research/patterns.ts) |
| Report browser | `Bun.serve` routes + `Bun.file` | [`serve.ts`](../src/research/serve.ts), [`views.ts`](../src/research/views.ts) |
| Agent dashboard | `Bun.serve` + optional headless `Bun.WebView` | [`dashboard.ts`](../src/agent/dashboard.ts), [`docs/DASHBOARD.md`](../docs/DASHBOARD.md) |
| Agent CLI | `Bun.WebView` capture + dashboard client | [`cli.ts`](../src/agent/cli.ts), [`docs/AGENT.md`](../docs/AGENT.md) |
| Terminal reports | `Bun.markdown.ansi` | [`report-term.ts`](../src/agent/report-term.ts) |
| CLI flags | `parseArgs` from `node:util` | [`cli.ts`](../src/research/cli.ts) |
| Unit tests | `bun:test` + `mock.module()` | [`tests/`](../tests/) |
| Test coverage | `[test] coverage` in `bunfig.toml` | [`bunfig.toml`](../bunfig.toml) |

### Canonical `@see` links

| API | Doc |
|-----|-----|
| `Bun.$` | https://bun.com/docs/runtime/shell#getting-started |
| `Bun.which` | https://bun.com/docs/runtime/utils#bun-which |
| `Bun.file` | https://bun.com/docs/runtime/file-io#reading-files-bun-file |
| `Bun.write` | https://bun.com/docs/runtime/file-io#writing-files-bun-write |
| `Bun.env` | https://bun.com/docs/runtime/environment-variables |
| `Bun.hash` | https://bun.com/docs/runtime/hashing#bun-hash |
| `bun:sqlite` | https://bun.com/docs/runtime/sqlite |
| `Bun.sleep` | https://bun.com/docs/runtime/utils#bun-sleep |
| `import.meta.dir` | https://bun.com/docs/runtime/module-resolution#import-meta |
| `import.meta.main` | https://bun.com/docs/runtime/utils#bun-main |
| `bun:test` | https://bun.com/docs/test/index#run-tests |
| `mock.module` | https://bun.com/docs/test/mocks |
| `Bun.cron` | https://bun.com/docs/runtime/cron |
| `Bun.CryptoHasher` | https://bun.com/docs/runtime/hashing#bun-cryptohasher |
| `URLPattern` | https://bun.com/blog/bun-v1.3.4#urlpattern-api |
| `Bun.serve` | https://bun.com/docs/runtime/http/server#basic-setup |
| `Bun.WebView` | https://bun.com/docs/runtime/webview#new-bun-webview-options |
| `Bun.markdown.ansi` | https://bun.com/docs/runtime/markdown#ansi-terminal-output |

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

## Testing

Colocated under [`tests/`](../tests/):

| File | Covers |
|------|--------|
| `gate.test.ts` | popularity gate |
| `score.test.ts` | weighted scoring |
| `detect.test.ts` | detector pure functions |
| `gh.test.ts` | rate-limit + JSON parse helpers |
| `cache.test.ts` | sqlite cache + run storage |
| `patterns.test.ts` | `BunURLPattern` GitHub SSOT |
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
```

Integration (live `gh`) is `bun run research` only.

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
