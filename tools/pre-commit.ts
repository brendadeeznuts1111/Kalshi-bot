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
    script: "bun:breaking-audit",
    // Bun/runtime-surface files: any change to these can introduce v1.4
    // breakage (writeHeader, YAML 1.2, Temporal, node interpreter,
    // native addons, lock version). Runs the importable audit lib.
    paths: [
      "package.json",
      "bun.lock",
      "bunfig.toml",
      "src/lib/breaking-audit.ts",
      "tools/bun-breaking-audit.ts",
    ],
  },
  {
    script: "deps:check",
    // Lockfile health on the same manifest files: dedupe --check (no
    // duplicate versions) + prune --dry-run (no stale packages). Both
    // offline + sub-second.
    paths: ["package.json", "bun.lock", "bunfig.toml"],
  },
  {
    script: "licenses:gate",
    // License compliance on dependency + policy changes (§92-§94): a new
    // prod dep with a non-permissive license must fail the COMMIT, not
    // just the full `bun run check` (deps:check only dedupes/prunes).
    // Fires on the manifest files plus the policy/tooling itself —
    // ~10ms, offline.
    paths: [
      "package.json",
      "bun.lock",
      "config/licenses-allowlist.json",
      "config/audit-overrides.json",
      "tools/licenses-gate.ts",
      "tools/audit-overlay-update.ts",
      "src/lib/licenses-policy.ts",
    ],
  },
  {
    script: "design:check",
    // Every frontend module surface + design system: hardcoded colors/radii
    // outside TOKENS fail the commit (live pages must stay token-compliant),
    // and bundle-budget changes from the build pipeline are gated.
    paths: [
      "src/research/hq-app",
      "src/research/hq-view.ts", // renderHq() SSR template is an audited surface
      "src/research/design-page.ts", // /design token inspector (enforced surface)
      "src/institutions/design-tokens.ts",
      "src/institutions/hq-ui.ts",
      "src/agent/design-agent.ts",
      "src/lib/color", // kernel/palette changes affect the design-system bundle size
      "src/lib/design-budget.ts", // per-module budgets feed the gate
      "scripts/build-design-system.ts",
      "scripts/watch-design-system.ts",
      "public/partner-dashboard", // baked desk board (enforced surface, data allowlist)
      "src/partner/dashboard-data.ts", // the board's generator (template -> TOKENS)
      "playground", // dev sandbox surfaces are audited (reported only)
      "tools/design-check.ts",
    ],
  },
  {
    script: "assets:check",
    // Content-hashed image gate (§46): images referenced from markdown must
    // exist and match the hashed state — a missing/edited referenced asset
    // fails the commit (extend the content/docs check model to assets).
    paths: [
      "content", // posts + their referenced assets
      "docs",
      "src/lib/assets-audit.ts",
      "tools/assets-check.ts",
    ],
  },
  {
    script: "docs:check",
    // The repo's own docs must render through Bun.markdown with unique
    // native heading ids — a broken doc (render throw / duplicate slugs)
    // fails the commit (§38). Also re-checks when the audit tooling changes.
    paths: [
      "docs", // *.md render contract
      "src/lib/docs-audit.ts",
      "src/lib/markdown-headings.ts",
      "tools/docs-check.ts",
    ],
  },
  {
    script: "bun:blog-map",
    // Blog → repo mapping contract: the registry (.data/blog-map.json) must
    // stay in sync with the release-blog sub-headers. Offline run uses the
    // cached blog HTML; a new unmapped sub-header fails the commit until a
    // registry entry is added (§31). Tracker source changes also re-check.
    paths: [
      ".data/blog-map.json",
      "src/lib/blog-map.ts",
      "src/lib/blog-map-run.ts",
      "tools/bun-blog-map.ts",
    ],
  },
  {
    script: "content:check",
    // Content-plane prune gate (mirror of deps:check): manifest integrity
    // — every .data/manifest.json reference must exist, so the prune
    // decision matrix (delete/archive/review/keep) sees real files.
    // Dry-run report is informational; --apply is the explicit action.
    // (content:verify — hash drift — stays manual/watch-driven; committing
    // a drift intentionally is legitimate, e.g. a real content edit.)
    paths: [
      "content", // content files (add/remove/edit)
      ".data/manifest.json",
      "src/lib/prune-content.ts",
      "tools/prune-content-cli.ts",
      "tools/content-verify.ts",
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
      "src/research/hq-app/token-vars.css",
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
        // --parallel + --timings: 5.5x faster than --isolate (11.1s -> 2.0s,
        // measured on 1959 tests); --parallel implies --isolate.
        ["test", "--changed=HEAD", "--parallel", "--timings=.bun-test-timings.json", "--timeout", "15000", "--retry", "1"],
      );
      if (ok) return true;
      return runBatch("test (full fallback)", ["test", "--parallel", "--timings=.bun-test-timings.json", "--timeout", "15000", "--retry", "1"]);
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