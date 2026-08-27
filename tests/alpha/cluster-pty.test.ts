// Bun.Terminal PTY pin (§197): alpha:cluster --pty-pin hosts the styled
// (markdown.ansi) renderer inside a genuine PTY so the true TTY output is
// captured even when stdout is piped. Environment reality (D13 / AGENT-PITFALLS
// §17): sandboxes and captured CI deny PTY allocation ("Failed to open PTY") —
// the module degrades to { unavailable } and the PTY-dependent assertions are
// skipIf-gated (repo pattern: tests/bun-docs-index.test.ts).
import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { ptyAvailable, ptyBounds, ptyFailureReason, renderStyledInPty, tryOpenTerminal, PTY_DEFAULT_COLS, PTY_DEFAULT_ROWS, PTY_EOF_BOUND_MS } from "../../src/alpha/cluster/pty.ts";

describe("Bun.Terminal PTY pin (§197)", () => {
  test("tryOpenTerminal never throws: a live PTY or a documented reason", () => {
    const opened = tryOpenTerminal();
    if ("terminal" in opened) {
      expect(opened.terminal.closed).toBe(false);
    } else {
      expect(opened.unavailable.length).toBeGreaterThan(0);
      expect(opened.unavailable.toLowerCase()).toContain("pty");
    }
    expect(typeof ptyAvailable()).toBe("boolean");
  });

  test("ptyAvailable agrees with tryOpenTerminal", () => {
    expect(ptyAvailable()).toBe("terminal" in tryOpenTerminal());
  });

  describe.skipIf(!ptyAvailable())("when a PTY is available", () => {
    test("renderStyledInPty captures the ANSI-styled markdown", async () => {
      const r = await renderStyledInPty("# Odds consensus\n\n**24** prints · **3** clusters");
      expect("ansi" in r).toBe(true);
      if ("ansi" in r) {
        expect(r.ansi).toContain(String.fromCharCode(27) + "[");
        expect(r.ansi).toContain("Odds consensus");
        expect(r.ansi).toContain("24");
      }
    });

    test("renderStyledInPty renders even under NO_COLOR (markdown.ansi emits once called, §205)", async () => {
      const r = await renderStyledInPty("**hello**", { env: { ...process.env, NO_COLOR: "1" } });
      expect("ansi" in r).toBe(true);
      if ("ansi" in r) {
        expect(r.ansi).toContain("hello");
      }
    });
  });
});

describe("boundary rules as independent consts", () => {
  test("ptyBounds: geometry defaults when unset, explicit values pass through", () => {
    expect(ptyBounds({})).toEqual({ cols: PTY_DEFAULT_COLS, rows: PTY_DEFAULT_ROWS });
    expect(ptyBounds({ cols: 120, rows: 40 })).toEqual({ cols: 120, rows: 40 });
    expect(ptyBounds({ cols: 0 })).toEqual({ cols: 0, rows: PTY_DEFAULT_ROWS }); // explicit zero respected
    expect(ptyBounds({ rows: 0 })).toEqual({ cols: PTY_DEFAULT_COLS, rows: 0 });
    expect(ptyBounds({ cols: -5 })).toEqual({ cols: -5, rows: PTY_DEFAULT_ROWS }); // passthrough, validation is Bun's
    expect(ptyBounds({ rows: 40 })).toEqual({ cols: PTY_DEFAULT_COLS, rows: 40 }); // unset cols -> default
  });

  test("ptyFailureReason: Error -> message; anything else -> String()", () => {
    expect(ptyFailureReason(new Error("Failed to open PTY"))).toBe("Failed to open PTY");
    expect(ptyFailureReason("boom")).toBe("boom");
    expect(ptyFailureReason(null)).toBe("null");
    expect(ptyFailureReason(undefined)).toBe("undefined");
    expect(ptyFailureReason({})).toBe("[object Object]");
  });

  test("capture-completion boundary: PTY_EOF_BOUND_MS is the bounded safety net", () => {
    expect(PTY_EOF_BOUND_MS).toBe(500);
  });

  test("tryOpenTerminal: default and explicit geometry agree on the environment outcome", () => {
    const geom = ptyBounds({ cols: 100, rows: 30 });
    const def = tryOpenTerminal();
    const explicit = tryOpenTerminal(geom.cols, geom.rows);
    if ("terminal" in def) {
      expect("terminal" in explicit).toBe(true);
      expect(def.terminal.closed).toBe(false);
    } else if ("unavailable" in def && "unavailable" in explicit) {
      expect(explicit.unavailable).toBe(def.unavailable); // same environment, same reason
      expect(explicit.unavailable.length).toBeGreaterThan(0);
    }
  });
});

describe("alpha:cluster --pty-pin", () => {
  test("exits 0: pinned ANSI output, or a graceful fallback note when no PTY is available", async () => {
    const proc = await $`bun run alpha:cluster -- --pty-pin`.quiet().nothrow();
    expect(proc.exitCode).toBe(0);
    const out = proc.stdout.toString();
    const err = proc.stderr.toString();
    if (ptyAvailable()) {
      expect(out).toContain(String.fromCharCode(27) + "[");
      expect(out).toContain("Odds consensus");
    } else {
      expect(err).toContain("--pty-pin unavailable");
      expect(err).toContain("falling back");
      expect(out).toContain("prints");
    }
  });
});
