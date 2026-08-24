#!/usr/bin/env bun
/**
 * `bun run ffi:probe` — probe Bun's FFI surface (the "we don't even need
 * to spawn" claim, verified): dlopen() a real system library, call C
 * functions directly from JS — no Bun.spawn, no CLI subprocess.
 *
 * Probe-verified (AGENT-PITFALLS §27):
 *   - `Bun.ffi` (namespace) does NOT exist — the module is `bun:ffi`.
 *   - `dlopen("libSystem.B.dylib", { getpid })()` returns a real pid.
 *   - `dlopen("libz.dylib", { zlibVersion })()` -> "1.2.12" via CString.
 *   - FFIType surface: i32/u32/ptr + CFunction/JSCallback for callbacks.
 * Why not adopted in the gates: FFI adds a native surface (platform .dylib
 * names, ABI) for zero gain over the spawn keep-list (runBunGate). It IS
 * the escape hatch if a spawn-free path is ever required.
 */
import { dlopen, CString, FFIType } from "bun:ffi";

console.log("ffi:probe — bun " + Bun.version);
console.log("FFIType:", Object.values(FFIType).join(", "));

try {
  const libSystem = dlopen("libSystem.B.dylib", {
    getpid: { args: [], returns: "i32" },
    getuid: { args: [], returns: "i32" },
    getgid: { args: [], returns: "i32" },
  });
  console.log("libSystem.B.dylib: getpid", libSystem.symbols.getpid(), "· getuid", libSystem.symbols.getuid(), "· getgid", libSystem.symbols.getgid());
} catch (e) {
  console.log("libSystem dlopen FAILED:", String(e).slice(0, 120));
  process.exit(1);
}

try {
  const libz = dlopen("libz.dylib", {
    zlibVersion: { args: [], returns: "ptr" },
  });
  const ptr = libz.symbols.zlibVersion();
  console.log("libz.dylib: zlibVersion ->", CString(ptr));
} catch (e) {
  console.log("libz dlopen FAILED:", String(e).slice(0, 120));
  process.exit(1);
}
console.log("ffi:probe ok — native calls from JS, no spawn");
