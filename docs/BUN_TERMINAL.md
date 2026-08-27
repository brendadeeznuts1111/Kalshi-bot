# Bun.Terminal — PTY class (probe-grounded 1.4.0)

**Reference:** [Bun.Terminal class](https://bun.com/reference/bun/Terminal) · **Guide:** [runtime utils](https://bun.com/docs/runtime/utils) · **Bun-native map:** [`BUN_NATIVE.md`](BUN_NATIVE.md) D13

`Bun.Terminal` is a pseudo-terminal (PTY) for spawning interactive terminal programs. It is the
sanctioned replacement for `node-pty` (guard mapping in [`scripts/audit-bun-native.ts`](../scripts/audit-bun-native.ts)).

## API surface (bun-types@1.4.0)

`new Bun.Terminal({ cols = 80, rows = 24, name = "xterm-256color", data?, exit?, drain? })` — `Terminal` implements `AsyncDisposable` (`await using`).

| Member | Signature | Notes |
| ------ | --------- | ----- |
| `write(data)` | `(string \| BufferSource) => number` | bytes accepted; overflow is buffered and flushed later — `drain` fires once flushed; **do not re-send any part of `data` based on the return value** (types comment) |
| `resize(cols, rows)` | `(number, number) => void` | SIGWINCH semantics for the slave |
| `setRawMode(enabled)` | `(boolean) => void` | input passed through without processing |
| `ref()` / `unref()` | `() => void` | keep / allow event-loop exit |
| `close()` | `() => void` | |
| `[Symbol.asyncDispose]()` | `() => Promise<void>` | `await using` (BUN_DISPOSE) |
| `closed` | `readonly boolean` | |
| `inputFlags` / `outputFlags` / `localFlags` / `controlFlags` | `number` get/set | raw termios `c_iflag` / `c_oflag` / `c_lflag` / `c_cflag`; reads return 0 when closed, sets return boolean |

`TerminalOptions`: `cols`, `rows`, `name` (terminal type), `data(terminal, data: Uint8Array)` (received output), `exit(terminal, exitCode, signal)` (PTY stream close), `drain(terminal)` (buffered write flushed).

## Gotchas (probe-verified)

1. **`exit`'s `exitCode` is a PTY lifecycle status, NOT the subprocess exit code** — 0 = clean EOF, 1 = read error; `signal` is always `null` (reserved). Use `proc.exited` / the spawn `onExit` callback for process exit info (bun-types comment; honored in `renderStyledInPty`).
2. **"Failed to open PTY" under capture** — environments that deny PTY allocation throw on construction (repo D13, AGENT-PITFALLS §17). Probe evidence in this DSH harness: `python3 pty.openpty()` → `OSError: out of pty devices`; `script -q /dev/null …` → `openpty: Operation not permitted`; `tty` → `not a tty`. The API itself is fine on a real terminal; the harness simply has no PTY device. Never assume availability — see [`src/alpha/cluster/pty.ts`](../src/alpha/cluster/pty.ts) `tryOpenTerminal()`.
3. **`Bun.executable` does NOT exist on 1.4.0** (`undefined` probe) — use `process.execPath` (resolves to the bun binary) to self-spawn a `bun -e` child into the PTY.
4. **`Bun.stringWidth` is not shipped** — its declaration is commented out in bun-types, blocked on [oven-sh/bun#8329](https://github.com/oven-sh/bun/issues/8329). Width handling stays in `src/research/terminal-out.ts` (`Bun.sliceAnsi` + `padDisplay`/`statusLine`).
5. **Color is the CALLER's decision** (§205) — `Bun.markdown.ansi(md)` emits ANSI regardless of TTY/`NO_COLOR`/`FORCE_COLOR` once called (probe: plain vs `{colors:false}` vs `{colors:true}` — ANSI everywhere; only `colors:false` strips it). `Bun.color(hex, "ansi")` DOES auto-detect: `""` when piped, escapes under `FORCE_COLOR`. This is why `--styled` gates on `resolveColorMode` and why the PTY pin must run the renderer as a child inside a real PTY.

## Wire-in: `alpha:cluster --pty-pin` (§197)

`src/alpha/cluster/pty.ts` + `tools/alpha-cluster-cli.ts` `--pty-pin`: renders the styled markdown summary
(`Bun.markdown.ansi`) inside a genuine `Bun.Terminal` PTY and prints the captured bytes — the exact output
a real terminal user sees, even when the CLI's stdout is piped (captured stdout resolves color mode to
NONE, §211, so without the pin `--styled | tee` silently degrades to the plain table).

- `tryOpenTerminal(cols?, rows?)` → `{ terminal } | { unavailable }` — never throws; the unavailable reason is e.g. `"Failed to open PTY"`.
- `ptyAvailable()` → boolean — environment probe for test gating.
- `renderStyledInPty(md, { cols?, rows?, env? })` → `Promise<{ ansi } | { unavailable }>` — spawns `process.execPath -e` with `{ terminal }`, collects `data` chunks, awaits `proc.exited` + the PTY `exit` callback (bounded by `Bun.sleep(500)`), closes, returns UTF-8 capture.
- CLI: `--pty-pin` implies the styled renderer; on `{ unavailable }` it prints `alpha:cluster: --pty-pin unavailable (<reason>) — falling back` to stderr and degrades to the normal gated path (exit 0).
- Tests: [`tests/alpha/cluster-pty.test.ts`](../tests/alpha/cluster-pty.test.ts) — unavailable-path assertions always run; PTY-dependent assertions are `describe.skipIf(!ptyAvailable())` (repo pattern), so they activate on any machine with a real PTY.

## Verification status

- Class presence + "Failed to open PTY" reality: probe-grounded on 1.4.0 (see gotcha 2).
- Full happy-path PTY capture: NOT runnable in this harness (PTY denied) — test-locked and skipIf-gated; evidence to collect on a real terminal (`bun test tests/alpha/cluster-pty.test.ts` with a TTY).
- `Bun.markdown.ansi` / `Bun.color(hex, "ansi")` semantics: probe-verified (gotcha 5).

## @see

- Reference: https://bun.com/reference/bun/Terminal
- Guide: https://bun.com/docs/runtime/utils
- Type source: `node_modules/bun-types/bun.d.ts` (`class Terminal`, `interface TerminalOptions`).
