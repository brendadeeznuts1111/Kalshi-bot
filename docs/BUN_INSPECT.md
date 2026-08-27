# Bun.inspect, console.log & terminal-safe logging (probe-verified deep dive)

**Status:** probe-verified against **Bun 1.4.0** (repo baseline) — every claim below was
executed against the real runtime and cross-checked with the `bun-types` 1.4.0
declarations. Legend: ✅ works as claimed · ⚠️ works with different semantics ·
❌ not supported in 1.4.0 (ignored or phantom API).

This is the "power user" layer under `console.log`. Pair with
[`BUN_NATIVE.md`](BUN_NATIVE.md) (API map) and [`BUN_TECH_STACK.md`](BUN_TECH_STACK.md)
(baseline).

---

## 1. Architecture — console.log is powered by Bun.inspect

✅ True. `console.log`/`console.dir`/`console.table` route through Bun's object
formatter, and `Bun.inspect(value, options)` is the same formatter you can call
directly — `import { inspect } from "bun"` is literally the same function as
`Bun.inspect` (identity probe: `inspect === Bun.inspect` → `true`).

Two nuances the original guide got wrong:

- **Different default depths.** `console.log`'s default depth is **2**
  (`bun --help`: "--console-depth=<val> Set the default depth for console.log
  object inspection (default: 2)"). `Bun.inspect`'s default is much deeper —
  **≈9 nested levels** in 1.4.0 (probe: 9 levels printed fully, cut at 10). Do
  not assume one number applies to both.
- **Colors differ.** `Bun.inspect` defaults to `colors: false` and emits ANSI
  *whenever* you pass `colors: true` — even piped to a file. `console.log`
  colorizes based on the runtime's TTY/env decision (§7), not your inspect
  options.

## 2. Configuration layers (corrected)

The guide's three layers exist, but the environment variable does not:

| Layer | Verdict | How |
| ----- | ------- | --- |
| CLI flag | ✅ works, wins | `bun --console-depth 5 run script.ts` |
| `BUN_CONSOLE_DEPTH` env var | ❌ **phantom — no effect in 1.4.0** (probed) | — |
| `bunfig.toml [console]` | ✅ `depth` (and `colors` as TTY default) | `[console] depth = 4` |

**Precedence is just two levels: CLI flag > bunfig.** There is no env-var layer.
(`BUN_CONFIG_CONSOLE_DEPTH` was probed too — also dead.)

`[console]` keys — only two are real:

```toml
[console]
depth = 3   # ✅ honored (default for console.log, per --help: 2)
colors = true # ⚠️ TTY default only — does NOT force colors when piped; FORCE_COLOR wins (§7)
```

Everything else the original guide listed under `[console]` — `compact`, `sorted`,
`maxStringLength`, `breakLength`, `showHidden`, `getters`, `numericSeparator` —
is **ignored** (probed with all of them set: only `depth` took effect; the
others produced identical output with and without).

## 3. Bun.inspect options — verified reference

`bun-types` 1.4.0 declares `BunInspectOptions` with exactly **four** members:
`colors`, `depth`, `sorted`, `compact`. Probe results:

| Option | Verdict | Notes (probe evidence) |
| ------ | ------- | ---------------------- |
| `colors: boolean` | ✅ | Default `false`; `true` always emits ANSI, TTY-independent |
| `depth: number \| null` | ✅ | Default ≈9 (not 2 — §1). `null`/`Infinity` = unbounded. `depth: 1` → `[Object ...]` |
| `compact: boolean` | ✅ | `true` = one line; `false` = multi-line (the default look). ⚠️ a *number* behaves as truthy — no Node-style "group inner elements" (probe: `compact: 3` ≡ `compact: true`) |
| `sorted: boolean` | ✅ | `true` sorts keys alphabetically. ⚠️ a *comparator function* is ignored — treated as truthy, plain alphabetical sort applied (probe: reverse comparator still output `a, b`) |
| `maxArrayLength` | ❌ ignored | `maxArrayLength: 3` on `[1..8]` printed all 8. Default truncation at 100 is *hardcoded* (probe: 100 → full, 101 → `… 1 more items`) |
| `maxStringLength` | ❌ ignored | `maxStringLength: 5` printed all 12 chars. Default: **no truncation** — 100 000 chars printed in full (Node's 10 000 default does not apply) |
| `breakLength` | ❌ ignored | `breakLength: 8` vs `Infinity` → identical output; wrapping is fixed |
| `showHidden` | ❌ ignored | `false`/`true`/unset → identical. Bun shows non-enumerable props **and symbols by default** (differs from Node) |
| `getters` | ❌ ignored | `true`/`'get'`/`'set'`/`false` → identical. Accessors always render as `[Getter]` / `[Getter/Setter]`; **never evaluated** |
| `numericSeparator` | ❌ ignored | No underscores; Node-style separator not implemented |
| `stylize` | ⚠️ | Top-level `stylize` option is **ignored** ("overrides colors" is false). BUT `options.stylize` **is** handed to custom inspect methods and works — emitting ANSI only when `colors` is on (probe: `options.stylize('X','string')` with `colors:true` → `\x1b[32mX\x1b[39m`) |

## 4. Custom inspection — ✅ as claimed

`Bun.inspect.custom === Symbol.for("nodejs.util.inspect.custom")` (probe: `true`),
and both `Bun.inspect` and `console.log` honor the symbol:

```ts
class OddsCluster {
  constructor(public venue: string, public consensus: number) {}
  [Symbol.for("nodejs.util.inspect.custom")](depth: number, options: any, inspect: typeof Bun.inspect) {
    const stylize = options.stylize ?? ((s: string) => s);
    return `Cluster(${stylize(this.venue, "string")}, cons=${stylize(this.consensus.toFixed(3), "number")})`;
  }
}
```

Verified: this prints `Cluster(...)` from both `console.log` and `Bun.inspect`.
Pass `options` through to nested `inspect(this.inner, options)` calls to preserve
colors/depth.

## 5. Circular references — ✅ automatic

Self-referencing objects print `[Circular]` at the recursion point. No
configuration needed. Verified.

## 6. inspect.table — ✅ real (returns a string)

`Bun.inspect.table` (also on the named `inspect` export) exists and returns the
formatted table **as a string** — you must pass it to `console.log` yourself.
It respects `colors` (probe: `colors: true` emits ANSI) and takes table-specific
options; the object-inspect options do not apply.

```ts
const rows = clusters.map(c => ({ venue: c.venue, consensus: c.consensus }));
console.log(Bun.inspect.table(rows, { colors: Bun.enableANSIColors }));
```

## 7. Colors — the correct primitive: Bun.enableANSIColors

The original guide's `import { isTerminal } from "bun"` is **wrong — no such
export exists in 1.4.0** (probe: `typeof isTerminal === "undefined"`; also absent
from `bun-types`). The runtime truth is the documented boolean:

```ts
// Whether ANSI colors are enabled for stdin/stdout (used by console.log).
console.log(Bun.enableANSIColors); // boolean
```

Probed matrix (piped stdout):

| Context | `Bun.enableANSIColors` | Console output |
| ------- | ---------------------- | -------------- |
| piped, nothing set | `false` | plain |
| piped, `FORCE_COLOR=1` | `true` | colored (even with `[console] colors = false`) |
| piped, `FORCE_COLOR=0` | `false` | plain |
| piped, `NO_COLOR=1` | `false` | plain |
| piped, `[console] colors = true` | `false` | plain — bunfig colors is a **TTY default**, not a force |
| TTY (normal terminal) | `true` | colored |

So: `Bun.enableANSIColors` already folds in TTY detection, `FORCE_COLOR`,
`NO_COLOR`, and `[console] colors`. Use it — do not reimplement detection.
If you need raw fd checks: `process.stdout.isTTY` / `process.stdout.columns`
(`undefined` when piped). `stripANSI` is the inverse utility.

## 8. sliceAnsi — ✅ real, signature verified

`sliceAnsi(input, start?, end?, options?, ambiguousIsNarrow?)` — indices are
**visible column widths** (CJK/emoji-aware), ANSI codes are preserved and
re-opened at boundaries. Verified: `sliceAnsi("hello world", 0, 5)` → `"hello"`;
a colored input keeps its escape codes through the slice; `(str, 0, n, { ellipsis: "…" })`
counts the ellipsis **inside** the width budget and emits it inside active SGR
styles. `options` may be `string` (ellipsis shorthand), `boolean`
(`ambiguousIsNarrow`), or an options object (`{ ellipsis, ambiguousIsNarrow }`).
Negative indices count from the end (truncate-start:
`sliceAnsi(str, -max, undefined, { ellipsis: "…" })`).

## 9. Corrected logger — src/lib/logger.ts

[`src/lib/logger.ts`](../src/lib/logger.ts) implements the guide's "production
logger" idea with only the options that actually exist:

```ts
import { inspect, sliceAnsi } from "bun";

const width = process.stdout.columns ?? 80; // columns is undefined when piped
export function log(...args: unknown[]) {
  const raw = args.map(v => inspect(v, {
    colors: Bun.enableANSIColors, // not isTerminal — that export does not exist
    depth: 4,
    compact: false,
    sorted: true,
  })).join(" ");
  // truncate per line so multi-line inspect output is preserved
  console.log(raw.split("\n").map(line => sliceAnsi(line, 0, width, { ellipsis: "…" })).join("\n"));
}
```

Corrections vs the original guide: `isTerminal` → `Bun.enableANSIColors`;
`maxStringLength`/`maxArrayLength`/`breakLength`/`getters`/`numericSeparator`/
`stylize` dropped (ignored by 1.4.0); `sorted` is a boolean only; truncation is
per-line (not whole-string) so multi-line output stays readable.

## 10. Myth vs reality (quick table)

| Original guide claim | Reality on 1.4.0 |
| -------------------- | ---------------- |
| `BUN_CONSOLE_DEPTH` env var | ❌ phantom |
| Precedence CLI > env > bunfig | ⚠️ CLI > bunfig only; no env layer |
| `Bun.inspect` default depth 2 | ⚠️ ≈9; `console.log`'s default is 2 |
| `maxStringLength` default 10000 | ❌ never truncated |
| `getters: "get"/"set"` variants | ❌ ignored; always `[Getter/Setter]` |
| `numericSeparator` | ❌ ignored |
| `showHidden` toggles non-enumerables | ❌ ignored; shown by default |
| `stylize` overrides colors | ❌ top-level ignored; `options.stylize` works inside custom inspect |
| `isTerminal(process.stdout)` | ❌ no such export; use `Bun.enableANSIColors` |
| `[console]` accepts 8 keys | ⚠️ only `depth` (+ `colors` as TTY default) |
| `inspect.table` | ✅ real, returns a string, respects colors |
| `--console-depth` | ✅ real (default 2), wins over bunfig |
| `sliceAnsi` with ellipsis | ✅ real, signature `(input, start, end, options)` |
| custom `[inspect.custom]` symbol | ✅ real, honored by console.log + Bun.inspect |
| `[Circular]` | ✅ automatic |

## 11. Workarounds for the unsupported options

- **String/array truncation:** not available via inspect options. Either
  `sliceAnsi` the formatted output (§8), truncate the data before logging, or
  add a custom `[inspect.custom]` to the classes you log (§4).
- **Getter evaluation:** evaluate before logging —
  `log({ ...obj, computed: obj.value })`.
- **Global console depth:** `bun --console-depth N run …` or
  `[console] depth` in `bunfig.toml` (this repo pins `depth = 3`).
- **Color forcing:** `FORCE_COLOR=1` (wins over everything incl. `colors = false`);
  `NO_COLOR=1` disables.

**Docs:** guides https://bun.com/docs/runtime/bunfig (console) ·
https://bun.com/docs/api/utils (sliceAnsi, stripANSI) · reference
https://bun.com/reference/bun (`enableANSIColors`, `inspect`).
