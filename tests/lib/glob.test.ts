import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globMatch, listFiles, listFilesAsync } from "../../src/lib/glob.ts";

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

  test("globMatch tests a single string", () => {
    expect(globMatch("*.json", "x.json")).toBe(true);
    expect(globMatch("*.json", "x.jsonl")).toBe(false);
    expect(globMatch("**/*.ts", "src/lib/glob.ts")).toBe(true);
  });
});
