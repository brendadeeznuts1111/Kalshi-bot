/**
 * Bun.file / Bun.write I/O coverage (FI-surface, BW-write, §9) on 1.4.0.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Bun.file / Bun.write", () => {
  test("Bun.file surface: name/size/type/exists/text/stat/slice (FI-surface)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "file-"));
    const f = join(dir, "hello.txt");
    writeFileSync(f, "Hello, World!");
    const bf = Bun.file(f);
    expect(bf.name!.split("/").pop()).toBe("hello.txt");
    expect(bf.size).toBe(13);
    expect(bf.type).toBe("text/plain;charset=utf-8");
    expect(await bf.exists()).toBe(true);
    expect(await bf.text()).toBe("Hello, World!");
    expect((await bf.arrayBuffer()).byteLength).toBe(13);
    expect(typeof bf.lastModified).toBe("number");
    const st = await bf.stat();
    expect(st.isFile()).toBe(true);
    expect(st.size).toBe(13);
    expect(await bf.slice(0, 5).text()).toBe("Hello");
  });

  test("Bun.write returns byte count and overwrites a BunFile (BW-write)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wr-"));
    const w = join(dir, "w.txt");
    expect(await Bun.write(w, "abc")).toBe(3);
    expect(await Bun.write(w, "old")).toBe(3);
    expect(await Bun.write(Bun.file(w), "xyz")).toBe(3);
    expect(await Bun.file(w).text()).toBe("xyz");
  });
});