#!/usr/bin/env bun
/**
 * Pre-commit gate (Bun-native).
 *
 * Installed via core.hooksPath -> .githooks/pre-commit (works in the
 * submodule layout where .git/hooks does not exist).
 *
 * Static gates run in parallel batches (bun run --parallel, prefixed output):
 *   - guard + typecheck
 *   - glossary:check + partners:validate
 * Tests run only for the diff (bun test --changed=HEAD, Bun 1.4 primitive),
 * with a full-suite fallback when changed-detection fails.
 * Conditional gates fire when their paths are staged. Protected artifact
 * deletions block the commit. SKIP_TEST_CHANGED=1 skips the test layer.
 *
 * Color: Bun.color('ansi') text + the inspect.table summary follow the docs:
 * NO_COLOR=1 disables, FORCE_COLOR=1|2|3 forces on (wins over NO_COLOR),
 * unset = auto (plain in non-TTY/CI).
 */
import { spawn } from "bun";
import { joinPath } from "../src/research/paths.ts";

const root = joinPath(import.meta.dir, "..");
const BUN = Bun.which("bun") ?? "bun";

// ── Color: Bun.color('ansi') is TTY-aware (empty when unsupported) ─────
const RESET = "\u001b[0m";
const paint = (color: string, text: string): string => {
  const ansi = Bun.color(color, "ansi");
  return ansi ? ansi + text + RESET : text;
};

// ── Gate definitions (data-driven) ─────────────────────────────────────
const STATIC_BATCH_1 = ["guard", "typecheck"] as const;
const STATIC_BATCH_2 = ["glossary:check", "partners:validate"] as const;

export const CONDITIONAL_GATES: ReadonlyArray<{ script: string; paths: readonly string[] }> = [
  {
    script: "partner:toml:validate",
    paths: [
      "config/partners.toml",
      "config/partners.example.toml",
      "src/partner/toml-config.ts",
      "tools/partner-toml.ts",
      "tests/partner/toml-config.test.ts",
    ],
  },
  {
    script: "colors:check",
    paths: [
      "src/lib/color",
      "src/lib/design-colors.ts",
      "scripts/generate-color-artifacts.ts",
      "public/colors.css",
      "public/registry/color-system.json",
      "docs/COLORS.md",
      "src/research/hq-app/color-vars.css",
    ],
  },
] as const;

export const PROTECTED_PATHS = [
  "research/audit-evidence",
  "research/reports/latest.md",
  "research/reports/latest.diff.md",
] as const;

/** A configured path matches a staged file when it is the file or a dir prefix. */
function pathMatches(configured: string, staged: string): boolean {
  if (staged === configured) return true;
  const dir = configured.replace(/\/+$/, "");
  return staged.startsWith(dir + "/");
}

/** Which conditional gates fire for the staged file set. */
export function resolveConditionalGates(staged: Iterable<string>): string[] {
  const files = new Set(staged);
  return CONDITIONAL_GATES.filter((gate) =>
    gate.paths.some((p) => [...files].some((s) => pathMatches(p, s))),
  ).map((gate) => gate.script);
}

/** Protected-path deletions that must block the commit. */
export function protectedDeletionViolations(deleted: Iterable<string>): string[] {
  return [...deleted].filter((d) =>
    PROTECTED_PATHS.some((p) => pathMatches(p, d)),
  );
}

// ── Runner ──────────────────────────────────────────────────────────────
async function runBatch(label: string, args: string[]): Promise<boolean> {
  process.stderr.write(paint("yellow", "pre-commit: " + label + "\n"));
  const proc = spawn([BUN, ...args], { cwd: root, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) {
    process.stderr.write(paint("red", "pre-commit: " + label + " FAILED (" + code + ")\n"));
  }
  return code === 0;
}

async function runScriptBatch(label: string, scripts: readonly string[]): Promise<boolean> {
  return runBatch(label, ["run", "--parallel", ...scripts]);
}

/** git stdout, or "" on failure (Bun.spawnSync, no shell interpolation). */
function gitOutput(args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return proc.exitCode === 0 ? new TextDecoder().decode(proc.stdout) : "";
}

function stagedPaths(): Set<string> {
  const out = gitOutput(["diff", "--cached", "--name-only", "--diff-filter=ACM"]);
  return new Set(out.split("\n").filter(Boolean));
}

/** Worktree + staged deletions under PROTECTED_PATHS (single source of truth). */
function deletedPaths(): string[] {
  const pathspec = ["--", ...PROTECTED_PATHS];
  const out = gitOutput(["diff", "--name-only", "--diff-filter=D", ...pathspec]);
  const cached = gitOutput(["diff", "--cached", "--name-only", "--diff-filter=D", ...pathspec]);
  return [...new Set([...out.split("\n"), ...cached.split("\n")])].filter(Boolean);
}

async function main(): Promise<void> {
  const started = Bun.nanoseconds();
  const steps: Array<{ label: string; ok: boolean; ms: number }> = [];
  let failed = false;

  const step = async (label: string, fn: () => Promise<boolean>): Promise<boolean> => {
    const t = Date.now();
    const ok = await fn();
    steps.push({ label, ok, ms: Date.now() - t });
    if (!ok) failed = true;
    return ok;
  };

  await step("guard + typecheck", () => runScriptBatch("guard + typecheck", STATIC_BATCH_1));

  if (Bun.env.SKIP_TEST_CHANGED === "1") {
    process.stderr.write(paint("yellow", "pre-commit: SKIP_TEST_CHANGED=1 — tests skipped (reason in commit msg)\n"));
  } else {
    await step("test --changed=HEAD", async () => {
      // --retry=1: defuses the known transient flake (ops/kalshi-rotate-key)
      // natively — bun retries failed tests once before reporting.
      const ok = await runBatch(
        "test --changed=HEAD",
        ["test", "--changed=HEAD", "--isolate", "--timeout", "15000", "--retry", "1"],
      );
      if (ok) return true;
      return runBatch("test (full fallback)", ["test", "--isolate", "--timeout", "15000", "--retry", "1"]);
    });
  }

  await step("glossary + partners", () => runScriptBatch("glossary + partners", STATIC_BATCH_2));

  const staged = stagedPaths();
  for (const script of resolveConditionalGates(staged)) {
    await step(script, () => runBatch(script, ["run", script]));
  }

  const violations = protectedDeletionViolations(deletedPaths());
  if (violations.length > 0) {
    failed = true;
    process.stderr.write(paint("red", "pre-commit: protected artifact deletions:\n"));
    for (const d of violations) process.stderr.write("  " + d + "\n");
    process.stderr.write("  fix fixtures or run: bun run artifacts:restore\n");
  }

  const ms = Math.round((Bun.nanoseconds() - started) / 1e6);
  if (failed) {
    const failedGates = steps.filter((s) => !s.ok).map((s) => s.label);
    const { inspectColor } = await import("../src/institutions/terminal-utils.ts");
    process.stderr.write("pre-commit: failed gates " + inspectColor(failedGates) + "\n");
  }
  process.stderr.write("pre-commit: summary\n");
  const summaryRows = steps.map((s) => ({
    gate: s.label,
    status: s.ok ? paint("green", "ok") : paint("red", "FAIL"),
    ms: s.ms,
  }));
  const force = Bun.env.FORCE_COLOR && Bun.env.FORCE_COLOR !== "0";
  const tableOptions = force ? { colors: true } : undefined;
  process.stderr.write(Bun.inspect.table(summaryRows, tableOptions) + "\n");
  if (failed) {
    process.stderr.write(paint("red", "pre-commit: FAILED (" + ms + "ms)\n"));
    process.exit(1);
  }
  process.stderr.write(paint("green", "pre-commit: ok (" + ms + "ms)\n"));
}

if (import.meta.main) await main();