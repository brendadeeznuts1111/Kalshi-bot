/**
 * Bun.mmap surface coverage (MM-surface, MM-liveWrite, MM-liveRead, MM-offsetSize,
 * MM-shared, MM-empty, MM-missing, MM-close) on 1.4.0 (§9 rows).
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Bun.mmap", () => {
  test("surface: plain Uint8Array, length = file size, slice reads offsets (MM-surface)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mmap-"));
    const p = join(dir, "d.bin");
    writeFileSync(p, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const m = Bun.mmap(p);
    expect(typeof Bun.mmap).toBe("function");
    expect(m instanceof Uint8Array).toBe(true);
    expect(m.length).toBe(8);
    expect(m.constructor.name).toBe("Uint8Array");
    expect(m.buffer instanceof ArrayBuffer).toBe(true);
    expect(m[0]).toBe(1);
    expect(Array.from(m.slice(2, 5))).toEqual([3, 4, 5]);
  });

  test("writes go THROUGH to the file (MM-liveWrite)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mmap-w"));
    const p = join(dir, "w.bin");
    writeFileSync(p, new Uint8Array([1, 2, 3]));
    const m = Bun.mmap(p);
    m[0] = 99;
    m[1] = 42;
    expect(Array.from(readFileSync(p))).toEqual([99, 42, 3]);
  });

  test("external writes visible; appends after mapping NOT seen (MM-liveRead)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mmap-r"));
    const p = join(dir, "r.bin");
    writeFileSync(p, new Uint8Array([1, 2, 3]));
    const m = Bun.mmap(p);
    writeFileSync(p, new Uint8Array([7, 8, 9]));
    expect(Array.from(m)).toEqual([7, 8, 9]);
    appendFileSync(p, new Uint8Array([4, 5]));
    expect(m.length).toBe(3);
    expect(Array.from(m)).toEqual([7, 8, 9]);
  });

  test("offset/size window; size clamped to file size minus offset (MM-offsetSize)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mmap-o"));
    const p = join(dir, "o.bin");
    writeFileSync(p, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const m = Bun.mmap(p, { offset: 2, size: 4 });
    expect(m.length).toBe(4);
    expect(Array.from(m)).toEqual([3, 4, 5, 6]);
    const m2 = Bun.mmap(p, { offset: 1, size: 1000 });
    expect(m2.length).toBe(7);
  });

  test("shared:false = MAP_PRIVATE: view mutation NOT written back (MM-shared)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mmap-p"));
    const p = join(dir, "p.bin");
    writeFileSync(p, new Uint8Array([10, 20, 30]));
    const m = Bun.mmap(p, { shared: false });
    m[0] = 111;
    expect(Array.from(readFileSync(p))).toEqual([10, 20, 30]);
    expect(m[0]).toBe(111);
  });

  test("empty file throws EINVAL; missing file throws ENOENT (MM-empty, MM-missing)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mmap-e"));
    const ep = join(dir, "e.bin");
    writeFileSync(ep, new Uint8Array(0));
    let code = "";
    try { Bun.mmap(ep); } catch (e: any) { code = e?.code ?? ""; }
    expect(code).toBe("EINVAL");
    let code2 = "";
    try { Bun.mmap(join(dir, "nope.bin")); } catch (e: any) { code2 = e?.code ?? ""; }
    expect(code2).toBe("ENOENT");
  });

  test("close = set the array to null; no throw (MM-close)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mmap-c"));
    const p = join(dir, "c.bin");
    writeFileSync(p, new Uint8Array([1, 2, 3]));
    let m: Uint8Array<ArrayBuffer> | null = Bun.mmap(p);
    expect(m!.length).toBe(3);
    m = null;
    expect(m).toBeNull();
  });
});