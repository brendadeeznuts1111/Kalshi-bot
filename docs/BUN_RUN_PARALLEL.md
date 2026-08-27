# bun run --parallel — verified usage (Bun 1.4.0)

**Source:** `bun run --help` + hermetic probes on 1.4.0 (temp package, no repo
side effects). The repo itself has 329 root scripts (many `scope:task` shaped),
so these are the practical forms.

## 1. Run multiple scripts concurrently — ✅

```sh
bun run --parallel build test
```

Verified: Foreman-style prefixed output (`<script> | line`), scripts run
concurrently (probe: a 0.4 s sleep script and a 0.2 s script both finished in
~0.5 s wall). `--sequential` is the non-concurrent sibling.

## 2. Glob-matched script names — ✅ works on 1.4.0

```sh
bun run --parallel "build:*"
```

Verified: `bun run --parallel "a:*"` ran `a:one` and `a:two` concurrently.
Keep the quotes — an unquoted `*` is shell-expanded by the current directory.

## 3. Every workspace package — ✅

```sh
bun run --parallel --filter '*' build
```

`--filter <pattern>` (help: "Run a script in all workspace packages matching
the pattern") targets **packages** — `'*'` = all. Verified on this repo:
`--filter '*' test` ran the `test` script in all four alpha packages (56
tests, 0 fail). `--workspaces` is the un-filtered sibling. `--elide-lines=N`
caps per-package output (default 10).

## 4. Keep going on failure — ✅ continues, ⚠️ exit code is the failure code

```sh
bun run --parallel --no-exit-on-error --filter '*' test
```

Help: "Continue running other scripts when one fails". Verified: a failing
script (`exit 3`) did **not** stop a sibling script — both ran, but the
overall exit was **3**, not 0. So for CI: `--no-exit-on-error` keeps the run
going (useful for a survey) but you still gate on the non-zero exit; don't
treat it as "ignore failures".

## 5. Summary

| Claim | Verdict |
| --- | --- |
| `--parallel` runs scripts concurrently | ✅ (Foreman output) |
| `"build:*"` globs script names | ✅ |
| `--filter '*'` runs in every workspace package | ✅ |
| `--no-exit-on-error` keeps going after a failure | ✅ |
| `--no-exit-on-error` → exit 0 | ⚠️ no — exit is the failure code |

**Docs:** https://bun.com/docs/runtime/run · `bun run --help`
