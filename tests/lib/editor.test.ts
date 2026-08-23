// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { parseOpenTarget, resolveEditor } from "../../src/lib/editor.ts";

describe("resolveEditor", () => {
  test("PATTERN_EDITOR friendly name maps to family CLI", () => {
    const e = resolveEditor({ PATTERN_EDITOR: "vscode" }, (bin) => (bin === "code" ? "/bin/code" : null));
    expect(e).toEqual({ name: "code", family: "vscode", binary: "/bin/code" });
    const s = resolveEditor({ PATTERN_EDITOR: "subl" }, (bin) => (bin === "subl" ? "/bin/subl" : null));
    expect(s).toEqual({ name: "subl", family: "subl", binary: "/bin/subl" });
  });

  test("PATTERN_EDITOR custom CLI -> unknown family when on PATH", () => {
    const e = resolveEditor({ PATTERN_EDITOR: "neovim" }, (bin) => (bin === "neovim" ? "/bin/nvim" : null));
    expect(e).toEqual({ name: "neovim", family: "unknown", binary: "/bin/nvim" });
  });

  test("auto-detect in order: code, cursor, windsurf, codium, subl", () => {
    expect(resolveEditor({}, (bin) => (bin === "code" ? "/bin/code" : null))?.name).toBe("code");
    expect(resolveEditor({}, (bin) => (bin === "cursor" ? "/bin/cursor" : null))?.name).toBe("cursor");
    expect(resolveEditor({}, (bin) => (bin === "subl" ? "/bin/subl" : null))?.name).toBe("subl");
  });

  test("null when no editor on PATH and no env", () => {
    expect(resolveEditor({}, () => null)).toBeNull();
  });

  test("env-named editor missing on PATH -> null (no silent fallback)", () => {
    expect(resolveEditor({ PATTERN_EDITOR: "code" }, () => null)).toBeNull();
  });
});

describe("parseOpenTarget", () => {
  test("path only", () => {
    expect(parseOpenTarget("src/a.ts")).toEqual({ path: "src/a.ts" });
  });

  test("path:line", () => {
    expect(parseOpenTarget("src/a.ts:42")).toEqual({ path: "src/a.ts", line: 42 });
  });

  test("path:line:column", () => {
    expect(parseOpenTarget("src/a.ts:42:7")).toEqual({ path: "src/a.ts", line: 42, column: 7 });
  });

  test("ripgrep-style path:line:column: rest", () => {
    expect(parseOpenTarget("src/a.ts:12:3: const x = 1")).toEqual({ path: "src/a.ts", line: 12, column: 3 });
  });
});
