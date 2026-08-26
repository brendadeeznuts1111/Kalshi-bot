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
});
