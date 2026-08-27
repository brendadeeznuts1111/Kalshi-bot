# bun:ffi types & dev-tooling flags — probe-verified (Bun 1.4.0)

**Source:** `bun --help` / `bun run --help` · live probes (libc FFI, .env,
profiler files) · Legend: ✅ verified · ❌ not on 1.4.0 · ⚠️ nuance · 📋 internal.

## 1. bun:ffi — `cstring` & `buffer_length` — ✅ live-verified via libc

```ts
const libc = dlopen("libc.dylib", {
  getenv: { args: ["cstring"], returns: "cstring" },
  memcpy: { args: ["ptr", "ptr", "buffer_length"], returns: "ptr" },
});
```

| Type | Claim | Probe |
| --- | --- | --- |
| `"cstring"` return | Native JS string, or `null` when the pointer is NULL | `getenv("HOME")` → `"/Users/nolarose"`; `getenv(<missing>)` → **`null`** ✅ |
| `"buffer_length"` arg | Forwards a TypedArray's byte length alongside its pointer | `memcpy(dst, src, src)` (3rd arg `"buffer_length"`) copied exactly 4 bytes (src.byteLength) ✅ |

`"buffer_length"` is used as an *argument type*: pass a TypedArray and Bun
passes its `.byteLength` by value — no pointer/length mismatch.
JIT unboxing ("hot call sites compile directly into C calls, primitives via
registers") is 📋 internal JSC codegen — not observable from the API.

## 2. Profiler flags — ✅ all four verified

| Flag | Verified behavior |
| --- | --- |
| `--cpu-prof` | Writes `CPU.<ts>.<pid>.0.001.cpuprofile` (Chrome DevTools format) |
| `--cpu-prof-md` | Writes `CPU.<ts>.<pid>.0.001.md` ("grep-friendly" markdown; trivial scripts → "No samples collected.") |
| `--heap-prof` | Writes `Heap.<ts>.<pid>.0.001.heapprofile` |
| `--heap-prof-md` | Prints "Heap profile written to: …/Heap.<ts>.<pid>.0.001.md" |

❌ **`BUN_CPU_PROFILE=1` does not exist on 1.4.0** — the env var is absent from
the binary's strings and setting it wrote no profile. The flags are the way.

## 3. Process flags — ✅

- **`--no-orphans`** — in help ("Exit when the parent process dies, and on
  exit kill every descendant"). ⚠️ "across Linux, macOS, and Windows": Linux
  (PR_SET_PDEATHSIG) and macOS (kqueue) are documented in this repo's bunfig;
  **Windows not verifiable here** 📋.
- **`--no-env-file`** — ✅ live-verified: a `.env` with `SECRET_FROM_ENV`
  loads by default, but is **not** loaded with `bun --no-env-file` (probe:
  value → `undefined`). Not shown in `--help` (the positive
  `--env-file=<file>` form is) — but the flag works.
- **bunfig `env = false`** — ✅ live-verified: a top-level
  `env = false` in `bunfig.toml` disables automatic `.env` loading (probe:
  value → `undefined`). ⚠️ NOT the table form — `[env] enable = false` does
  nothing on 1.4.0; the key is top-level `env`.

## 4. Terminal demo styling (blog) — ⚠️ presentation detail

The runtime's `--parallel` output format is verified (Foreman-style
`<label> | line` prefixes, per-script labels). The CSS specifics (monospace
columns, dimmed pipes, per-label color classes) are the **blog demo's**
presentation — the runtime emits plain prefixed lines; label colors appear on
TTY only. Not a runtime API.

## 5. Summary

| Claim | Verdict |
| --- | --- |
| `"cstring"` return (string | null on NULL) | ✅ live-verified |
| `"buffer_length"` arg (forwards byte length) | ✅ live-verified |
| JIT unboxing | 📋 internal |
| `--cpu-prof` / `--cpu-prof-md` | ✅ (files written) |
| `--heap-prof` / `--heap-prof-md` | ✅ (files written) |
| `BUN_CPU_PROFILE=1` env toggle | ❌ not on 1.4.0 |
| `--no-orphans` | ✅ (Windows 📋) |
| `--no-env-file` | ✅ (works; undocumented in help) |
| bunfig `env = false` | ✅ top-level key (not `[env] enable`) |
| Prefixed `--parallel` headers | ✅ (CSS styling = blog demo) |

**Docs:** https://bun.com/docs/runtime/ffi · https://bun.com/docs/runtime/run · `bun --help`
