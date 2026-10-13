/**
 * Bun ANSI primitives + statusLine via src/research/terminal-out.ts (the
 * canonical Bun-utils consumer - direct Bun.stringWidth/sliceAnsi/wrapAnsi/
 * stripANSI calls, pitfalls 31).
 */
import { describe, expect, test } from "bun:test";
import { brandCell, brandMark, padDisplay, statusLine, wrapDisplay } from "../../src/research/terminal-out.ts";

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
    expect(Bun.stripANSI(spen)).toBe("SPEN");
  });

  test("wrapDisplay wraps at column width (Bun.wrapAnsi)", () => {
    // trim:false keeps the wrapped space on its own line (terminal-out
    // choice; matches Bun.wrapAnsi's default trim behavior).
    expect(wrapDisplay("hello world", 5)).toBe("hello\n \nworld");
  });

  test("brandMark composes Bun.color with the brand palette", () => {
    // Bun.color(input, "ansi") detects color depth from the ENVIRONMENT
    // (COLORTERM/TERM), not from isatty — so in a piped/CI harness it still
    // returns an escape. brandMark wraps only when it is non-empty, and falls
    // back to plain text otherwise. Assert both branches from the real value
    // instead of hardcoding a TTY assumption that does not hold.
    const tennisGreen = Bun.color("#27AE60", "ansi") ?? "";
    // "ansi" respects the environment (empty under NO_COLOR / no TERM), so the
    // mark is plain there and brand-escaped everywhere else. Both are valid;
    // what must hold is that the visible text survives either way.
    expect(Bun.stripANSI(brandMark("ok", "ok"))).toBe("ok");

    const mark = brandMark("ok", "ok");
    if (tennisGreen) {
      expect(mark).toBe(tennisGreen + "ok" + RESET);
      expect(Bun.stripANSI(mark)).toBe("ok");
    } else {
      expect(mark).toBe("ok");
    }
  });

  test("Bun.inspect.custom renders inside Bun.inspect.table cells", () => {
    const sym = Bun.inspect.custom;
    const rows = [{ name: "a", status: { [sym]() { return "[[OK]]"; } } }];
    const table = Bun.inspect.table(rows, ["name", "status"]);
    expect(table).toContain("[[OK]]");
  });

  test("brandCell: colors follow the Bun.color environment detection", () => {
    const cell = brandCell("pass", "pass");
    // `colors: false` is the documented "render plain" path and is stable.
    expect(Bun.inspect(cell, { colors: false } as never)).toBe("pass");
    // `colors: true` renders plain only when Bun.color(x,'ansi') is empty
    // (no COLORTERM/TERM support). Otherwise the brand escape is present —
    // compare against what Bun.color actually returns here. "pass" maps to
    // the tennis-green palette key (COLORS.tennis = #27AE60).
    const tennis = Bun.color("#27AE60", "ansi") ?? "";
    const rendered = Bun.inspect(cell, { colors: true } as never);
    expect(rendered).toBe(tennis ? tennis + "pass" + RESET : "pass");
    expect(Bun.stripANSI(rendered)).toBe("pass");
    // And the raw/meta surface is intact for table rendering.
    expect(cell.raw).toBe("pass");
    expect(cell.semantic).toBe("pass");
  });

  test("brandCell renders in a Bun.inspect.table cell with meta", () => {
    const cell = brandCell("ok", "pass", { dur: 5 });
    const table = Bun.inspect.table([{ name: "a", status: cell }], ["name", "status"], { colors: false } as never);
    expect(table).toContain("ok");
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
    expect(Bun.stripANSI(coloredPrefix).length).toBe(Bun.stripANSI(plainPrefix).length);
  });
});