import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonFile, readJsonFileOr, writeJsonFile } from "../../src/lib/json-file.ts";

describe("JSON artifact IO (Bun.file().json() + Bun.write)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "json-file-test-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("writeJsonFile + readJsonFile roundtrip", async () => {
    const p = join(dir, "a.json");
    await writeJsonFile(p, { ok: true, n: 42 });
    expect(await readJsonFile<{ ok: boolean; n: number }>(p)).toEqual({ ok: true, n: 42 });
  });

  test("readJsonFileOr returns fallback when missing", async () => {
    expect(await readJsonFileOr(join(dir, "nope.json"), { fb: 1 })).toEqual({ fb: 1 });
  });

  test("readJsonFileOr returns fallback on corrupt JSON", async () => {
    const p = join(dir, "corrupt.json");
    await Bun.write(p, "{ not json");
    expect(await readJsonFileOr(p, "fb")).toBe("fb");
  });

  test("pretty output ends with a newline", async () => {
    const p = join(dir, "pretty.json");
    await writeJsonFile(p, { a: 1 });
    expect((await Bun.file(p).text()).endsWith("\n")).toBe(true);
  });
});
