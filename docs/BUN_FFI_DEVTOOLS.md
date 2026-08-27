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

## 6. Deeper verification (live probes + compiled C dylib)

### bun:ffi full type coverage — ✅ (compiled `ffi-lib.dylib` via clang)

| Type | Function | Probe result |
| --- | --- | --- |
| `"i32"` | `add_i32(20, 22)` | `42` (number) |
| `"i64"` | `add_i64(9007199254740993n, 1n)` | `9007199254740994n` (**BigInt**) |
| `"f64"` / `"f32"` | `add_f64/f32(1.5, 2.25)` | `3.75` |
| `"bool"` | `is_even(4/5)` | `true` / `false` |
| `"u8"` + `"ptr"` arg | `last_byte(buf, 4)` | `40` |
| `"usize"` return | `strlen("hello")` | `5n` (**BigInt**) |
| `"ptr"` + `CString` | `strdup` / `new CString(ptr)` | `"hello-ffi"` |
| `"i64"` overflow | `strtoll("12345678901234567890")` | `9223372036854775807n` (LLONG_MAX — libc semantics) |

- **`buffer_length` byteOffset nuance:** with a `subarray(3, 7)` view (byteOffset 3,
  byteLength 4), the forwarded length is **4 (the view's byteLength)**, not the
  whole backing buffer.
- **❌ JS→C callbacks are NOT supported in 1.4.0.** `ffi.d.ts` maps
  `["callback"]: FFIType.pointer; // for now` — passing a JS function for a
  callback arg throws `"cannot convert argument to 'function'"` (probed with
  `qsort` + a JS comparator). `CFunction` exists at runtime but is a legacy
  leftover (not in the types; construction errors on a missing `ptr` field).
  If you need C callbacks, you need a native trampoline.

### Profiler outputs — real content verified

- `--cpu-prof`: valid Chrome DevTools JSON — keys `nodes, startTime, endTime,
  samples, timeDeltas` (probe: 388 samples, 3 nodes).
- `--cpu-prof-md`: real markdown report (773.7 ms / 100 samples / 1.0 ms
  interval; "Top 10: `work` 100.0%"; Hot Functions + Call Tree tables). Short
  workloads legitimately report "No samples collected."
- `--heap-prof-md`: "# Bun Heap Profile" with quick-search commands + Summary
  and top-allocation tables.

### `--no-orphans` — behaviorally verified (correct test)

The flag watches **its own parent**: kill the parent of a `--no-orphans` bun
process and bun exits and **kills its descendants** (probe: wrapper SIGKILL'd →
the bun child's `sleep` grandchild died; control without the flag → sleep
survived, orphaned). Killing the bun process itself does not exercise the
watcher.

### `.env` precedence (NODE_ENV + explicit files)

Verified order: `.env.local` > `.env.<NODE_ENV>` (e.g. `.env.production`
auto-loads under `NODE_ENV=production`) > `.env`. An explicit
`--env-file=<file>` **replaces** the auto-set (only that file loads — probe:
`BASE_ONLY` from `.env` became `undefined`).

**Docs:** https://bun.com/docs/runtime/ffi · https://bun.com/docs/runtime/run · `bun --help`
