// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { resolveEditorName } from "../../src/lib/editor.ts";

describe("resolveEditorName", () => {
  test("PATTERN_EDITOR env wins, case-insensitive", () => {
    expect(resolveEditorName({ PATTERN_EDITOR: "vscode" }, (_bin: string) => null)).toBe("vscode");
    expect(resolveEditorName({ PATTERN_EDITOR: "subl" }, (_bin: string) => null)).toBe("subl");
    expect(resolveEditorName({ PATTERN_EDITOR: "VSCODE" }, (_bin: string) => null)).toBe("vscode");
  });

  test("falls back to Bun.which auto-detect when env unset", () => {
    expect(resolveEditorName({}, (bin: string) => (bin === "code" ? "/usr/local/bin/code" : null))).toBe("vscode");
    expect(resolveEditorName({}, (bin: string) => (bin === "subl" ? "/usr/local/bin/subl" : null))).toBe("subl");
  });

  test("invalid env value does not override detection", () => {
    expect(resolveEditorName({ PATTERN_EDITOR: "nano" }, (bin: string) => (bin === "code" ? "/bin/code" : null))).toBe("vscode");
  });

  test("undefined when nothing detected (system default)", () => {
    expect(resolveEditorName({}, (_bin: string) => null)).toBeUndefined();
  });
});
