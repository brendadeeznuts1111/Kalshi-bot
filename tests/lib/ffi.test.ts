import { describe, expect, test } from "bun:test";
import { dlopen } from "bun:ffi";

// Probe-locked bun:ffi "cstring" / "buffer_length" behavior on Bun 1.4.0 —
// see docs/BUN_FFI_DEVTOOLS.md §1. libc path is platform-specific; skip elsewhere.
const LIBC = process.platform === "darwin" ? "libc.dylib" : process.platform === "linux" ? "libc.so.6" : null;

describe.skipIf(!LIBC)("bun:ffi cstring / buffer_length (Bun 1.4.0)", () => {
  const libc = dlopen(LIBC!, {
    getenv: { args: ["cstring"], returns: "cstring" },
    memcpy: { args: ["ptr", "ptr", "buffer_length"], returns: "ptr" },
  });

  test("cstring return: JS string for a real pointer, null for NULL", () => {
    const home = libc.symbols.getenv("HOME");
    expect(typeof home).toBe("string");
    expect(home!.length).toBeGreaterThan(0);
    const missing = libc.symbols.getenv("KALSHI_FFI_DEFINITELY_MISSING_VAR");
    expect(missing).toBeNull();
  });

  test("buffer_length arg forwards the TypedArray byte length", () => {
    const src = new Uint8Array([65, 66, 67, 68]);
    const dst = new Uint8Array(8);
    libc.symbols.memcpy(dst, src, src);
    expect(Array.from(dst)).toEqual([65, 66, 67, 68, 0, 0, 0, 0]);
  });
});
