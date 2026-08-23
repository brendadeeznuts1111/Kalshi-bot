// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { confirmYes, readLine } from "../../src/lib/readline.ts";

async function* sourceOf(...lines: string[]): AsyncIterable<string> {
  for (const l of lines) yield l;
}

describe("readLine", () => {
  test("reads a line and trims it", async () => {
    expect(await readLine(undefined, { source: sourceOf("  hello  ") })).toBe("hello");
  });

  test("writes the prompt without a newline", async () => {
    let written = "";
    await readLine("prompt>", { source: sourceOf("x"), write: (t) => { written += t; } });
    expect(written).toBe("prompt>");
  });

  test("returns empty on EOF", async () => {
    expect(await readLine("p", { source: sourceOf() })).toBe("");
  });
});

describe("confirmYes", () => {
  test("accepts y/yes case-insensitively", async () => {
    expect(await confirmYes("q", { source: sourceOf("y") })).toBe(true);
    expect(await confirmYes("q", { source: sourceOf("YES") })).toBe(true);
  });

  test("rejects anything else", async () => {
    expect(await confirmYes("q", { source: sourceOf("n") })).toBe(false);
    expect(await confirmYes("q", { source: sourceOf("") })).toBe(false);
  });
});
