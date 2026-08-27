/**
 * pty.ts — Bun.Terminal PTY pin for the alpha:cluster styled renderer (§197).
 *
 * Hosts the styled (markdown.ansi) renderer inside a genuine pseudo-terminal so
 * the true TTY output can be captured even when the CLI's own stdout is piped.
 * Captured stdout resolves color mode to NONE (§211) — without a PTY the styled
 * path is suppressed by the caller gate (§205) and the ANSI a real terminal
 * user would see can never be recorded. `--pty-pin` fixes exactly that.
 *
 * Bun.Terminal reality on 1.4.0 (probe-grounded; see docs/BUN_TERMINAL.md):
 *   - `new Bun.Terminal(...)` opens a PTY and throws "Failed to open PTY" on
 *     environments that deny PTY allocation (sandboxes, captured CI, no
 *     controlling terminal). This module never throws from the open attempt —
 *     it returns `{ unavailable }` with the reason (D13 / AGENT-PITFALLS §17).
 *   - the `exit` callback's exitCode is a PTY lifecycle status (0 = clean EOF,
 *     1 = read error), NOT the subprocess exit code — use `proc.exited`
 *     (bun-types comment on TerminalOptions.exit).
 *   - `Terminal` implements AsyncDisposable (`await using`), but `close()` is
 *     used here for deterministic ordering after capture.
 *
 * Boundary rules are encoded as independent consts (PTY_DEFAULT_* / PTY_EOF_BOUND_MS
 * / ptyBounds / ptyFailureReason) instead of inline decision chains, so each
 * boundary is testable in isolation and the guard functions stay flat.
 *
 * @see https://bun.com/reference/bun/Terminal
 */
export interface PtyRenderOptions {
  /** Terminal columns. @default 80 */
  cols?: number;
  /** Terminal rows. @default 24 */
  rows?: number;
  /** Environment for the child that renders inside the PTY. @default process.env */
  env?: Record<string, string | undefined>;
}

export type PtyOpen = { terminal: Bun.Terminal } | { unavailable: string };

/** Boundary rule: capture is complete once the PTY stream closes (EOF after
 * the child flushes); this bounds the wait for environments with unusual
 * callback ordering. */
export const PTY_EOF_BOUND_MS = 500;

/** Boundary rule: default PTY geometry when the caller does not specify it. */
export const PTY_DEFAULT_COLS = 80;
export const PTY_DEFAULT_ROWS = 24;

/** Boundary rule: a thrown error becomes the `unavailable` reason. */
export function ptyFailureReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Independent boundary consts: PTY geometry from options, defaults when unset. */
export function ptyBounds(opts: { cols?: number; rows?: number }): { cols: number; rows: number } {
  return { cols: opts.cols ?? PTY_DEFAULT_COLS, rows: opts.rows ?? PTY_DEFAULT_ROWS };
}

/**
 * Open a Bun.Terminal PTY without throwing. Returns the terminal on success,
 * or the failure reason (e.g. "Failed to open PTY") when the environment
 * denies PTY allocation. Callers MUST check which variant came back.
 */
export function tryOpenTerminal(cols = PTY_DEFAULT_COLS, rows = PTY_DEFAULT_ROWS): PtyOpen {
  try {
    const terminal = new Bun.Terminal({ cols, rows });
    return { terminal };
  } catch (err) {
    return { unavailable: ptyFailureReason(err) };
  }
}

/** True iff a Bun.Terminal PTY can be opened in this environment. */
export function ptyAvailable(): boolean {
  return "terminal" in tryOpenTerminal();
}

/**
 * Render `md` with Bun.markdown.ansi inside a genuine Bun.Terminal PTY and
 * return the captured bytes — what a real terminal user sees, even when the
 * caller's stdout is piped. Returns `{ unavailable }` (never throws) when the
 * environment denies PTY allocation.
 *
 * The child (`process.execPath -e …`) writes the styled output to stdout
 * connected to the PTY slave, so TTY auto-detection (`Bun.color(hex, "ansi")`
 * etc.) and any tty-gated rendering run as on a real terminal.
 */
export async function renderStyledInPty(
  md: string,
  opts: PtyRenderOptions = {},
): Promise<{ ansi: string } | { unavailable: string }> {
  const { cols, rows } = ptyBounds(opts);
  const childEnv = opts.env ?? process.env;
  const chunks: Uint8Array[] = [];
  let exitFired = false;
  let resolveExit: (() => void) | null = null;
  const exitDone = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  let terminal: Bun.Terminal;
  try {
    terminal = new Bun.Terminal({
      cols,
      rows,
      data: (_term, data) => {
        chunks.push(data);
      },
      exit: () => {
        exitFired = true;
        resolveExit?.();
      },
    });
  } catch (err) {
    return { unavailable: ptyFailureReason(err) };
  }

  const childCode =
    "const md = " + JSON.stringify(md) + ";\nprocess.stdout.write(Bun.markdown.ansi(md));";
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([process.execPath, "-e", childCode], {
      terminal,
      env: childEnv,
    });
  } catch (err) {
    terminal.close();
    return { unavailable: "spawn into PTY failed: " + ptyFailureReason(err) };
  }

  await proc.exited;
  // Boundary rule: the `exit` callback fires when the PTY stream closes (EOF
  // after the child flushed) — wait for it so no tail bytes are lost, bounded
  // by PTY_EOF_BOUND_MS for environments with unusual callback ordering.
  await Promise.race([exitDone, Bun.sleep(PTY_EOF_BOUND_MS)]);
  terminal.close();
  return { ansi: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8") };
}
