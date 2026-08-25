#!/usr/bin/env bun
/**
 * `bun run version:probe` — the runtime version pin (§159). Every gate in
 * this suite was verified against a SPECIFIC Bun build; if the runtime
 * moves, the pins may be stale. This gate FAILS on any version/revision
 * change so the whole suite demands re-verification instead of silently
 * drifting.
 */
const PINNED_VERSION = "1.4.0";
const PINNED_REVISION = "34cbb9a40";
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

check("P1 runtime version matches pin", Bun.version === PINNED_VERSION, Bun.version + " (pinned " + PINNED_VERSION + ")");
check("P2 revision matches pin", Bun.revision.startsWith(PINNED_REVISION), Bun.revision.slice(0, 9) + " (pinned " + PINNED_REVISION + ")");
check("P3 bun --version agrees", Bun.spawnSync(["bun", "--version"]).stdout?.toString().trim() === PINNED_VERSION, String(Bun.spawnSync(["bun", "--version"]).stdout?.toString().trim()));

const failed = results.filter((r) => !r.pass);
console.log("version:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: runtime moved — RE-VERIFY ALL GATES against " + PINNED_VERSION + " (" + PINNED_REVISION + ")" : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
