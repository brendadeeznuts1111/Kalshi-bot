/**
 * Bun.which coverage (WH-surface, WH-pathOverride, WH-cwd, WH-longBin) on 1.4.0
 * (§9 rows; corrects the pasted proposal's cwd framing + long-path claim).
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTool(dir: string): string {
  mkdirSync(join(dir, "bin"), { recursive: true });
  const t = join(dir, "bin", "which-tool");
  writeFileSync(t, "#!/bin/sh\necho hi");
  chmodSync(t, 0o755);
  return t;
}

describe("Bun.which", () => {
  test("surface: absolute path or null (WH-surface)", () => {
    expect(typeof Bun.which).toBe("function");
    const ls = Bun.which("ls");
    expect(ls).toBeTypeOf("string");
    expect(ls!.startsWith("/")).toBe(true);
    expect(Bun.which("definitely-not-a-real-cmd-xyz-9")).toBeNull();
  });

  test("options.PATH replaces env PATH; empty PATH -> null (WH-pathOverride)", () => {
    expect(Bun.which("ls", { PATH: "/usr/local/bin:/usr/bin:/bin" })).toBe(Bun.which("ls"));
    expect(Bun.which("ls", { PATH: "" })).toBeNull();
  });

  test("cwd anchors relative-path COMMANDS (WH-cwd)", () => {
    const dir = mkdtempSync(join(tmpdir(), "wh-c-"));
    makeTool(dir);
    expect(Bun.which("./bin/which-tool", { cwd: dir })).toBe(join(dir, "bin", "which-tool"));
    expect(Bun.which("./bin/which-tool", { cwd: "/tmp" })).toBeNull();
    // cwd is NOT a search-dir addition for bare names
    expect(Bun.which("which-tool", { cwd: dir })).toBeNull();
  });

  test("cwd anchors relative PATH ENTRIES (WH-cwd)", () => {
    const dir = mkdtempSync(join(tmpdir(), "wh-p-"));
    makeTool(dir);
    expect(Bun.which("which-tool", { PATH: "bin", cwd: dir })).toBe(join(dir, "bin", "which-tool"));
    expect(Bun.which("which-tool", { PATH: "bin" })).toBeNull();
  });

  test("long BIN NAME throws 'bin path is too long'; long PATH returns null (WH-longBin)", () => {
    let msg = "";
    try { Bun.which("x".repeat(100000)); } catch (e: any) { msg = e?.message ?? ""; }
    expect(msg).toContain("bin path is too long");
    let v: string | null | undefined = undefined;
    try { v = Bun.which("ls", { PATH: "/usr/bin:" + "/x/".repeat(20000) }); } catch (e: any) { v = "THREW " + String(e?.message).slice(0, 40); }
    expect(v).toBeNull();
  });
});
