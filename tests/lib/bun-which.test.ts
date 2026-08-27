// Bun.which semantics — probe-verified (§42): { PATH } replaces env PATH,
// cwd resolves relative PATH entries, missing -> null.
// @see https://bun.com/docs/runtime/utils#bun-which
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBunCommand } from "../../src/lib/run-bun.ts";

describe("Bun.which", () => {
  test("resolves a system bin and returns null for missing", () => {
    const ls = Bun.which("ls");
    expect(typeof ls).toBe("string");
    expect(ls!.endsWith("/ls")).toBe(true);
    expect(Bun.which("definitely-not-a-real-bin-xyz")).toBeNull();
  });

  test("{ PATH } REPLACES the env PATH (include system dirs yourself)", () => {
    const dir = join(tmpdir(), "which-test-" + process.pid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mytool"), "#!/bin/sh\necho hi\n");
    chmodSync(join(dir, "mytool"), 0o755);
    expect(Bun.which("mytool", { PATH: dir })).toBe(join(dir, "mytool"));
    expect(Bun.which("ls", { PATH: dir })).toBeNull(); // env PATH replaced
    expect(Bun.which("ls", { PATH: dir + ":/bin:/usr/bin" })).toBe("/bin/ls");
    rmSync(dir, { recursive: true, force: true });
  });

  test("cwd resolves relative PATH entries", () => {
    const dir = join(tmpdir(), "which-test-" + process.pid);
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "sub", "mytool"), "#!/bin/sh\necho hi\n");
    chmodSync(join(dir, "sub", "mytool"), 0o755);
    const r = Bun.which("mytool", { cwd: dir, PATH: "./sub" });
    expect(r).not.toBeNull();
    expect(r!.endsWith("mytool")).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("runBunCommand path option", () => {
  test("accepts a PATH override for bin resolution", async () => {
    // system bun is still findable when we include its dirs
    const bunDir = join(process.execPath, "..");
    const r = await runBunCommand(["--version"], { path: bunDir + ":/bin:/usr/bin:/usr/local/bin" });
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toMatch(/^1\./);
  });
});