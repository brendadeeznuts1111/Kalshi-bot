import { describe, expect, test } from "bun:test";
import { concatArrayBuffers } from "bun";

// Probe-locked Bun.concatArrayBuffers behavior on Bun 1.4.0 — see docs/BUN_MEDIA_METADATA.md.

describe("Bun.concatArrayBuffers (Bun 1.4.0)", () => {
  test("concatenates ArrayBuffers in order", () => {
    const a = new Uint8Array([1, 2, 3]).buffer;
    const b = new Uint8Array([4, 5]).buffer;
    const c = concatArrayBuffers([a, b]);
    expect(c.byteLength).toBe(5);
    expect(Array.from(new Uint8Array(c))).toEqual([1, 2, 3, 4, 5]);
  });

  test("accepts views (Uint8Array/Buffer) as inputs", () => {
    const c = concatArrayBuffers([new Uint8Array([7]), new Uint8Array([8])]);
    expect(Array.from(new Uint8Array(c))).toEqual([7, 8]);
    const b = concatArrayBuffers([Buffer.from("ab"), Buffer.from("c")]);
    expect(new TextDecoder().decode(b)).toBe("abc");
  });

  test("single and empty inputs", () => {
    expect(concatArrayBuffers([new Uint8Array([9]).buffer]).byteLength).toBe(1);
    expect(concatArrayBuffers([]).byteLength).toBe(0);
  });

  test("maxLength truncates the output", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    const b = new Uint8Array([9, 10]).buffer;
    expect(Array.from(new Uint8Array(concatArrayBuffers([a, b], 5)))).toEqual([1, 2, 3, 4, 5]);
    expect(concatArrayBuffers([a, b], 0).byteLength).toBe(0);
  });

  test("mixed part kinds compose into one buffer", () => {
    const out = concatArrayBuffers([new Uint8Array([1]).buffer, new Uint8Array([2]), Buffer.from([3])]);
    expect(Array.from(new Uint8Array(out))).toEqual([1, 2, 3]);
  });
});
