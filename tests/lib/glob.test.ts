import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listFiles, listFilesAsync } from "../../src/lib/glob.ts";

describe("Bun.Glob helpers", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "glob-test-"));
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "a.json"), "{}");
    await writeFile(join(dir, "b.jsonl"), "{}");
    await writeFile(join(dir, "c.ts"), "");
    await writeFile(join(dir, "sub", "d.json"), "{}");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("listFiles matches *.json non-recursively and sorts", () => {
    expect(listFiles("*.json", { cwd: dir })).toEqual(["a.json"]);
  });

  test("listFiles supports brace alternation", () => {
    expect(listFiles("*.{json,jsonl}", { cwd: dir })).toEqual(["a.json", "b.jsonl"]);
  });

  test("listFilesAsync recurses with **", async () => {
    const files = await listFilesAsync("**/*.json", { cwd: dir });
    expect(files).toContain("a.json");
    expect(files).toContain(join("sub", "d.json"));
  });

  test("Bun.Glob.match tests a single string (direct API)", () => {
    expect(new Bun.Glob("*.json").match("x.json")).toBe(true);
    expect(new Bun.Glob("*.json").match("x.jsonl")).toBe(false);
    expect(new Bun.Glob("**/*.ts").match("src/lib/glob.ts")).toBe(true);
  });

  test("globstar **/* matches ROOT-level files too (Bun-specific, probe-verified)", () => {
    // Unlike git's globstar (which needs a separate '*.ts' for root
    // files), Bun's '**/*.ts' matches both 'index.ts' AND 'src/index.ts'.
    expect(new Bun.Glob("**/*.ts").match("index.ts")).toBe(true);
    expect(new Bun.Glob("**/*.ts").match("a/b/c/index.ts")).toBe(true);
    expect(new Bun.Glob("**/*.ts").match("index.js")).toBe(false);
    // Alternation + character classes compose with globstar.
    expect(new Bun.Glob("**/*.{ts,js}").match("a/b/x.js")).toBe(true);
    expect(new Bun.Glob("[ab].ts").match("a.ts")).toBe(true);
    expect(new Bun.Glob("[ab].ts").match("c.ts")).toBe(false);
  });
});
