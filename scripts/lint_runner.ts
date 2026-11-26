#!/usr/bin/env bun
/**
 * Dual-mode `bun lint [flags] [files, directories, or globs]` runner.
 *
 * - Delegates directly to native `bun lint` when running on a Bun binary that ships it
 *   (or when `BUN_LINT_BIN` / `$HOME/.bun-canary/bin/bun` provides it).
 * - On stable Bun `1.4.5` (no built-in `bun lint`), expands `[files, directories, or globs]`
 *   via `Bun.Glob` and runs `bun check --no-script`, with explicit diagnostics for `--doctor`
 *   and canary-only flags (`--fix`, `init`).
 *
 * @file scripts/lint_runner.ts
 */

import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const GLOB_META_RE = /[*?[\]{}]/;
const CANARY_ONLY_FLAGS = new Set([
  "--fix",
  "--fix-suggestions",
  "--fix-dangerously",
]);

function isExecutable(bin: string): boolean {
  try {
    accessSync(bin, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function hasNativeBunLint(bin: string): boolean {
  try {
    const res = Bun.spawnSync([bin, "lint", "--no-script", "--help"], {
      cwd: "/tmp",
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    if (res.exitCode !== 0) return false;
    const out = `${res.stdout.toString("utf8")}${res.stderr.toString("utf8")}`;
    return out.includes("Usage: bun lint");
  } catch {
    return false;
  }
}

function resolveNativeBunLintBin(): string | null {
  const candidates = [
    process.env.BUN_LINT_BIN?.trim(),
    join(homedir(), ".bun-canary", "bin", "bun"),
    Bun.which("bun-canary") ?? undefined,
    process.execPath,
  ].filter((c): c is string => Boolean(c));
  const seen = new Set<string>();
  for (const bin of candidates) {
    if (seen.has(bin)) continue;
    seen.add(bin);
    if (isExecutable(bin) && hasNativeBunLint(bin)) return bin;
  }
  return null;
}

const args = process.argv.slice(2);
const nativeBin = resolveNativeBunLintBin();

if (args.includes("--doctor")) {
  console.log(
    JSON.stringify(
      {
        bunVersion: Bun.version,
        platform: `${process.platform}/${process.arch}`,
        nativeLint: nativeBin !== null,
        resolvedBin: nativeBin,
        fallback: "bun check --no-script",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (nativeBin !== null) {
  const res = Bun.spawnSync([nativeBin, "lint", "--no-script", ...args], {
    cwd: process.cwd(),
    stdio: ["inherit", "inherit", "inherit"],
  });
  process.exit(res.exitCode ?? 1);
}

if (args[0] === "init" || args.some((a) => CANARY_ONLY_FLAGS.has(a))) {
  const bad =
    args[0] === "init" ? "init" : args.find((a) => CANARY_ONLY_FLAGS.has(a))!;
  console.error(
    `[lint] '${bad}' requires native 'bun lint' (Bun canary / 1.5+); installed Bun ${Bun.version} falls back to 'bun check --no-script'. Set BUN_LINT_BIN or install $HOME/.bun-canary/bin/bun.`,
  );
  process.exit(2);
}

const forwarded: string[] = [];
for (const arg of args) {
  if (arg.startsWith("-") || !GLOB_META_RE.test(arg) || existsSync(arg)) {
    forwarded.push(arg);
    continue;
  }
  const glob = new Bun.Glob(arg);
  const matches: string[] = [];
  for (const match of glob.scanSync({ cwd: process.cwd(), onlyFiles: true })) {
    if (match.startsWith("node_modules/") || match.startsWith(".git/"))
      continue;
    matches.push(match);
  }
  if (matches.length === 0) {
    console.error(`[lint] Glob pattern "${arg}" matched 0 files.`);
    process.exit(1);
  }
  forwarded.push(...matches.sort());
}

const proc = Bun.spawnSync(
  [process.execPath, "check", "--no-script", ...forwarded],
  {
    cwd: process.cwd(),
    stdio: ["inherit", "inherit", "inherit"],
  },
);
process.exit(proc.exitCode ?? 1);
