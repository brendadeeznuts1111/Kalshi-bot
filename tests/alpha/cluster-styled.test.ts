// alpha:cluster --styled renders ANSI via the grounded markdown.ansi surface (§9 MD-ansi,
// §205 caller-gate: NO_COLOR/FORCE_COLOR=0 suppress, FORCE_COLOR=1 forces).
import { describe, expect, test } from "bun:test";
import { $ } from "bun";

describe("alpha:cluster --styled", () => {
  test("styled summary contains ANSI escapes when color is forced (FORCE_COLOR=1)", async () => {
    const proc = await $`bun run alpha:cluster -- --styled`.env({ ...process.env, FORCE_COLOR: "1", NO_COLOR: "" }).quiet().nothrow();
    const out = proc.stdout.toString();
    expect(out).toContain("\x1b[");
    expect(out).toContain("clusters");
  });

  test("NO_COLOR=1 suppresses ANSI from the styled path (caller gate, §205)", async () => {
    const proc = await $`bun run alpha:cluster -- --styled`.env({ ...process.env, NO_COLOR: "1" }).quiet().nothrow();
    expect(proc.stdout.toString()).not.toContain("\x1b[");
  });

  test("default output has no ANSI escapes", async () => {
    const proc = await $`bun run alpha:cluster`.quiet().nothrow();
    expect(proc.stdout.toString()).not.toContain("\x1b[");
  });

  test("--verbose cluster labels use the consensus RGB gradient (styledRGB, §235)", async () => {
    // kalshi pocket consensus ~0.30 -> t=0 -> [255,60,40] red; FORCE_COLOR=3 with
    // NO_COLOR cleared lets Bun.color('ansi') auto-pick 16m for the tuple.
    const proc = await $`bun run alpha:cluster -- --styled --verbose`.env({ ...process.env, FORCE_COLOR: "3", NO_COLOR: "", TERM: "xterm" }).quiet().nothrow();
    const out = proc.stdout.toString();
    expect(out).toContain("\x1b[38;2;255;60;40m0\x1b[0m"); // loose cluster label, red
    expect(out).toContain("\x1b[38;2;101;162;64m2\x1b[0m"); // tight cluster label, green
  });
});
