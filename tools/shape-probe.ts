#!/usr/bin/env bun
/**
 * bun run shape:probe - full-shape runtime agreement (§169): the
 * committed tools/bun-shape.json must match the INSTALLED runtime.
 * A Bun upgrade or a stale shape file fails here, not later.
 * In-process only (no spawn, no network).
 *
 * S1 freshness pin: shape was generated for THIS runtime.
 * S2 every declared top-level VALUE exists at runtime.
 * S2b namespaces: live or type-only (informational, non-failing).
 * S3 every live top-level member is mapped in the shape.
 * S4 documented globals present.
 */
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const shape = await Bun.file(join(ROOT, "tools/bun-shape.json")).json();
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  - " + detail : "")); };

const liveKeys = Object.keys(Bun).sort();

// S1: shape file freshness vs the installed runtime.
check(
  "S1 shape pinned to runtime",
  shape.bunVersion === Bun.version && shape.bunRevision === Bun.revision,
  shape.bunVersion + "/" + (shape.bunRevision ?? "").slice(0, 9) + " (runtime " + Bun.version + "/" + Bun.revision.slice(0, 9) + ")"
);

// S2: declared top-level values (non-type, non-namespace, non-extension) exist.
const top = shape.members.filter((m: any) => !m.ns && !m.typeOnly && m.kind !== "namespace" && !m.extension);
const missing = top.filter((m: any) => (Bun as any)[m.name] === undefined);
check("S2 declared values exist at runtime", missing.length === 0, missing.length ? missing.map((m: any) => m.name).join(",") : "all " + top.length + " present");

// S2b: namespaces - live objects or type-only namespaces (informational).
const nss = shape.members.filter((m: any) => !m.ns && m.kind === "namespace");
const nsLive = nss.filter((m: any) => (Bun as any)[m.name] !== undefined).length;
const nsType = nss.filter((m: any) => (Bun as any)[m.name] === undefined).map((m: any) => m.name);
check("S2b namespaces live or type-only", true, nsLive + " live; type-only namespaces: " + (nsType.join(",") || "none"));

// S3: every live top-level member is mapped in the shape (extensions allowed).
const shapeNames = new Set(shape.members.filter((m: any) => !m.ns).map((m: any) => m.name));
const extras = liveKeys.filter((k) => !shapeNames.has(k));
check("S3 live members all in shape", extras.length === 0, extras.join(",") || "all " + liveKeys.length + " mapped");

// S4: documented globals present.
const docGlobals = ["fetch", "Request", "Response", "WebSocket", "Blob", "FormData", "Headers", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "crypto", "console", "performance", "structuredClone", "queueMicrotask", "atob", "btoa", "AbortController", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "navigator", "self"];
const absent = docGlobals.filter((g) => (globalThis as any)[g] === undefined);
check("S4 documented globals present", absent.length === 0, absent.join(",") || "all " + docGlobals.length + " present");

// S5: the bun:* reference module plane (bun.com/reference modules) is
// importable at runtime with its key exports (bun:bundle is types-only -
// not importable - by design, §175).
const moduleChecks: Array<[string, string]> = [
  ["bun:test", "expect"],
  ["bun:test", "expectTypeOf"],
  ["bun:sqlite", "Database"],
  ["bun:ffi", "dlopen"],
  ["bun:jsc", "jscDescribe"],
];
const modFails: string[] = [];
for (const [mod, key] of moduleChecks) {
  try {
    const m = await import(mod);
    if ((m as any)[key] === undefined) modFails.push(mod + "." + key);
  } catch {
    modFails.push(mod + " (import threw)");
  }
}
check("S5 bun:* reference modules importable + key exports", modFails.length === 0, modFails.join(",") || "all " + moduleChecks.length + " checks ok");

const failed = results.filter((r) => !r.pass);
console.log("shape:probe - " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
