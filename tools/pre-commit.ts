#!/usr/bin/env bun
/**
 * Pre-commit gate (Bun-native, replaces tools/pre-commit.sh).
 *
 * Installed via core.hooksPath -> .githooks/pre-commit (works in the
 * submodule layout where .git/hooks does not exist).
 *
 * Gates:
 *   - guard + typecheck in parallel (bun run --parallel semantics via spawn)
 *   - bun test --changed=HEAD (Bun 1.4 primitive: only tests touched by the
 *     diff; falls back to the full suite if changed-detection fails)
 *   - glossary:check + partners:validate
 *   - conditional partner-TTL + colors checks when those paths are staged
 *   - block deletion of protected committed artifacts
 *
 * Escape hatch: SKIP_TEST_CHANGED=1 skips the test layer (reason in commit msg).
 */
import { spawn } from "bun";

const root = Bun.$`git rev-parse --show-toplevel`.textSync().trim();
const RED = "\u001b[31m";
const GRN = "\u001b[32m";
const YLW = "\u001b[33m";
const RST = "\u001b[0m";

async function run(label: string, args: string[]): Promise<boolean> {
  process.stderr.write(`pre-commit: ${label}\n`);
  const proc = spawn(args, { cwd: root, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) process.stderr.write(`${RED}pre-commit: ${label} FAILED (${code})${RST}\n`);
  return code === 0;
}

async function runBunScript(label: string, script: string, extra: string[] = []): Promise<boolean> {
  return run(label, ["bun", "run", script, ...extra]);
}

async function stagedPaths(): Promise<Set<string>> {
  const out = Bun.$`git diff --cached --name-only --diff-filter=ACM`.textSync();
  return new Set(out.split("\n").filter(Boolean));
}

async function main(): Promise<void> {
  const started = Date.now();
  let failed = false;

  // guard + typecheck in parallel (independent, read-only)
  const [guardOk, typeOk] = await Promise.all([
    run("guard", ["bun", "run", "guard"]),
    run("typecheck", ["bun", "run", "typecheck"]),
  ]);
  if (!guardOk || !typeOk) failed = true;

  // changed tests (Bun 1.4): only tests touched by the diff
  if (Bun.env.SKIP_TEST_CHANGED === "1") {
    process.stderr.write(`${YLW}pre-commit: SKIP_TEST_CHANGED=1 — tests skipped (reason in commit msg)${RST}\n`);
  } else {
    const changed = await run("test --changed=HEAD", ["bun", "test", "--changed=HEAD", "--isolate", "--timeout", "15000"]);
    if (!changed) {
      const full = await run("test (full fallback)", ["bun", "test", "--isolate", "--timeout", "15000"]);
      if (!full) failed = true;
    }
  }

  if (!(await runBunScript("glossary:check", "glossary:check"))) failed = true;
  if (!(await runBunScript("partners:validate", "partners:validate"))) failed = true;

  const staged = await stagedPaths();
  const partnerPaths = ["config/partners.toml", "config/partners.example.toml", "src/partner/toml-config.ts", "tools/partner-toml.ts", "tests/partner/toml-config.test.ts"];
  if (partnerPaths.some((p) => staged.has(p))) {
    if (!(await runBunScript("partner:toml:validate", "partner:toml:validate"))) failed = true;
  }
  const colorPaths = ["src/lib/color/", "src/lib/design-colors.ts", "scripts/generate-color-artifacts.ts", "public/colors.css", "public/registry/color-system.json", "docs/COLORS.md", "src/research/hq-app/color-vars.css"];
  if (colorPaths.some((p) => [...staged].some((s) => s.startsWith(p.replace(/\/$/, "")) || s === p))) {
    if (!(await runBunScript("colors:check", "colors:check"))) failed = true;
  }

  // protected artifact deletions
  const protectedPaths = ["research/audit-evidence", "research/reports/latest.md", "research/reports/latest.diff.md"];
  const delOut = Bun.$`git diff --name-only --diff-filter=D -- research/audit-evidence research/reports/latest.md research/reports/latest.diff.md`.textSync().trim();
  const delCached = Bun.$`git diff --cached --name-only --diff-filter=D -- research/audit-evidence research/reports/latest.md research/reports/latest.diff.md`.textSync().trim();
  const deleted = [...new Set([...delOut.split("\n"), ...delCached.split("\n")])].filter(Boolean);
  if (deleted.length > 0) {
    process.stderr.write(`${RED}pre-commit: protected artifact deletions:${RST}\n`);
    for (const d of deleted) process.stderr.write(`  ${d}\n`);
    process.stderr.write(`  fix fixtures or run: bun run artifacts:restore\n`);
    failed = true;
  }

  const ms = Date.now() - started;
  if (failed) {
    process.stderr.write(`${RED}pre-commit: FAILED (${ms}ms)${RST}\n`);
    process.exit(1);
  }
  process.stderr.write(`${GRN}pre-commit: ok (${ms}ms)${RST}\n`);
}

await main();
