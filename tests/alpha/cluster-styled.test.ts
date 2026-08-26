// alpha:cluster --styled renders ANSI via the grounded markdown.ansi surface (§9 MD-ansi).
import { describe, expect, test } from "bun:test";
import { $ } from "bun";

describe("alpha:cluster --styled", () => {
  test("styled summary contains ANSI escapes", async () => {
    const proc = await $`bun run alpha:cluster -- --styled`.quiet().nothrow();
    const out = proc.stdout.toString();
    expect(out).toContain("\x1b[");
    expect(out).toContain("clusters");
  });

  test("default output has no ANSI escapes", async () => {
    const proc = await $`bun run alpha:cluster`.quiet().nothrow();
    expect(proc.stdout.toString()).not.toContain("\x1b[");
  });
});