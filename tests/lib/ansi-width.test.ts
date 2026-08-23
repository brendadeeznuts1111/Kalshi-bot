/**
 * Bun ANSI primitives + statusLine via src/research/terminal-out.ts (the
 * canonical Bun-utils consumer - direct Bun.stringWidth/sliceAnsi/wrapAnsi/
 * stripANSI calls, pitfalls 31).
 */
import { describe, expect, test } from "bun:test";
import { brandMark, padDisplay, plainDisplay, statusLine, wrapDisplay } from "../../src/research/terminal-out.ts";

const GREEN = "\u001b[38;2;204;230;77m";
const RESET = "\u001b[0m";
const spen = GREEN + "SPEN" + RESET;

describe("terminal-out (Bun ANSI primitives)", () => {
  test("padDisplay pads to the VISIBLE width (Bun.stringWidth)", () => {
    expect(padDisplay("SPEN", 10)).toBe("SPEN      ");
    expect(padDisplay(spen, 10)).toBe(spen + " ".repeat(6)); // ANSI ignored
  });

  test("padDisplay truncates by visible cells with ellipsis (Bun.sliceAnsi)", () => {
    const truncated = padDisplay("unicorn", 4);
    expect(truncated).toBe("uni…"); // 3 visible + ellipsis at width 4
  });

  test("plainDisplay strips ANSI (Bun.stripANSI)", () => {
    expect(plainDisplay(spen)).toBe("SPEN");
  });

  test("wrapDisplay wraps at column width (Bun.wrapAnsi)", () => {
    // trim:false keeps the wrapped space on its own line (terminal-out
    // choice; matches Bun.wrapAnsi's default trim behavior).
    expect(wrapDisplay("hello world", 5)).toBe("hello\n \nworld");
  });

  test("brandMark composes Bun.color auto-TTY with the brand palette", () => {
    // Non-TTY: Bun.color(key, 'ansi') returns '' so the mark is PLAIN.
    const plain = brandMark("ok", "ok");
    expect(plain).toBe("ok");
    // The palette SSOT drives the color; ansi-16m always emits, so verify
    // the same brand hex maps to the tennis green escape.
    const tennisGreen = Bun.color("#27AE60", "ansi-16m");
    expect(tennisGreen).toBe("\u001b[38;2;39;174;96m");
  });

  test("Bun.inspect.custom renders inside Bun.inspect.table cells", () => {
    const sym = Bun.inspect.custom;
    const rows = [{ name: "a", status: { [sym]() { return "[[OK]]"; } } }];
    const table = Bun.inspect.table(rows, ["name", "status"]);
    expect(table).toContain("[[OK]]");
  });
});

describe("statusLine (defaulted columns)", () => {
  test("aligns marks of different widths to the same column", () => {
    expect(statusLine("ok", "a")).toBe("  ok      a");
    expect(statusLine("WARN", "b")).toBe("  WARN    b");
    expect(statusLine("ok", "a").indexOf("a")).toBe(statusLine("WARN", "b").indexOf("b"));
  });

  test("detail appended after label with colon", () => {
    expect(statusLine("GAP", "name", "detail here")).toMatch(/name: detail here$/);
  });

  test("ANSI-colored marks align by VISIBLE width (escape bytes are invisible)", () => {
    const colored = statusLine(GREEN + "ok" + RESET, "b");
    const plain = statusLine("ok", "a");
    const toLabel = (s: string) => s.slice(0, s.indexOf(s.includes("a") ? "a" : "b") + (s.includes("a") ? 0 : 0));
    // Visible prefix widths match; string indexes differ (escape bytes).
    const coloredPrefix = colored.slice(0, colored.indexOf("b"));
    const plainPrefix = plain.slice(0, plain.indexOf("a"));
    expect(plainDisplay(coloredPrefix).length).toBe(plainDisplay(plainPrefix).length);
  });
});