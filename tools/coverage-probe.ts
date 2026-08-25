#!/usr/bin/env bun
/**
 * `bun run coverage:probe` — bun test --coverage semantics (§161): the
 * table, [test] coverage default, coverageSkipTestFiles, and threshold
 * enforcement (number + object form). Self-contained fixtures in
 * scratch/cov; spawns bun test children.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

const C = "scratch/cov";
await Bun.write(C + "/mod.ts", 'export function covered() { return 1; }\nexport function uncovered() { return 2; }\n');
await Bun.write(C + "/mod.test.ts", 'import { test, expect } from "bun:test";\nimport { covered } from "./mod.ts";\ntest("covers one function", () => { expect(covered()).toBe(1); });\n');
const run = (args: string[], cwd = process.cwd()) => Bun.spawnSync(["bun", "test", ...args], { cwd, stdout: "pipe", stderr: "pipe" });

// P1: --coverage prints the table with correct funcs/lines percentages.
const basic = run(["mod.test.ts", "--coverage"], C);
const out = (basic.stdout?.toString() ?? "") + (basic.stderr?.toString() ?? "");
check("P1 coverage table + percentages", basic.exitCode === 0 && out.includes("% Funcs") && out.includes("% Lines") && out.includes("50.00") && out.includes("100.00"), "funcs=50 lines=100");

// P2: threshold number form enforces (exit 1 below, 0 above).
await Bun.write(C + "/bunfig.toml", "[test]\ncoverageThreshold = 1.0\n");
const t10 = run(["mod.test.ts", "--coverage"], C);
await Bun.write(C + "/bunfig.toml", "[test]\ncoverageThreshold = 0.1\n");
const t01 = run(["mod.test.ts", "--coverage"], C);
check("P2 threshold enforcement", t10.exitCode === 1 && t01.exitCode === 0, "1.0->" + t10.exitCode + " 0.1->" + t01.exitCode);

// P3: object form { lines, functions }.
await Bun.write(C + "/bunfig.toml", "[test]\ncoverageThreshold = { lines = 0.1, functions = 0.1 }\n");
const tObj = run(["mod.test.ts", "--coverage"], C);
check("P3 threshold object form", tObj.exitCode === 0, "exit=" + tObj.exitCode);

// P4: [test] coverage = true enables coverage WITHOUT the flag.
await Bun.write(C + "/bunfig.toml", "[test]\ncoverage = true\n");
const auto = run(["mod.test.ts"], C);
check("P4 [test] coverage=true auto-enables", auto.exitCode === 0 && ((auto.stdout?.toString() ?? "") + (auto.stderr?.toString() ?? "")).includes("% Funcs"), "");

// P5: test files excluded from the report by default.
const table = ((basic.stdout?.toString() ?? "") + (basic.stderr?.toString() ?? "")).split("Uncovered Line")[1] ?? "";
check("P5 coverageSkipTestFiles default", !table.includes("mod.test.ts"), "");

await Bun.write(C + "/bunfig.toml", "");
const failed = results.filter((r) => !r.pass);
console.log("coverage:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
