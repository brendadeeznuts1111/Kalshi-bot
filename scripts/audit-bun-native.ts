#!/usr/bin/env bun
/**
 * Guard exact Bun-native replacements without adding an ESLint dependency.
 *
 * Checks direct dependency declarations plus static/dynamic imports and
 * require() calls. Transitive dependencies are not blocked because application
 * code does not control their implementation.
 *
 * @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
 * @see https://bun.com/docs/runtime/child-process#spawn-a-process-bun-spawn
 * @see https://bun.com/docs/runtime/transpiler#scanimports
 * @see https://bun.com/docs/runtime/utils
 */
import { $ } from "bun";
import { join } from "node:path";
import ts from "typescript";

export const BANNED_PACKAGES = new Map<string, string>([
  ["wrap-ansi", "Bun.wrapAnsi()"],
  ["string-width", "Bun.stringWidth()"],
  ["strip-ansi", "Bun.stripANSI()"],
  ["escape-html", "Bun.escapeHTML()"],
  ["cli-table", "Bun.inspect.table()"],
  ["cli-table3", "Bun.inspect.table()"],
  ["cli-table2", "Bun.inspect.table()"],
  ["toml", "Bun.TOML.parse() / governed tomlStringify()"],
  ["@iarna/toml", "Bun.TOML.parse() / governed tomlStringify()"],
  ["@ltd/j-toml", "Bun.TOML.parse() / governed tomlStringify()"],
  // Node subprocess APIs -> Bun (blocking contexts: Bun.spawnSync; async: Bun.$)
  ["child_process", "Bun.spawnSync() / Bun.$ (Bun Shell)"],
  ["node:child_process", "Bun.spawnSync() / Bun.$ (Bun Shell)"],
  ["execa", "Bun.spawnSync() / Bun.$ (Bun Shell)"],
  // Bun 1.4 replaces-table (bun.com/blog/bun-v1.4): npm package -> native API
  ["cli-truncate", "Bun.sliceAnsi()"],
  ["concurrently", "bun run --parallel"],
  ["express", "Bun.serve"],
  ["fast-xml-parser", "Bun.XML.parse()"],
  ["json5", "Bun.JSON5.parse()"],
  ["jsonc-parser", "Bun.JSONC.parse()"],
  ["marked", "Bun.markdown.html()"],
  ["ndjson", "Bun.JSONL.parse()"],
  ["node-cron", "Bun.cron()"],
  ["node-pty", "Bun.Terminal"],
  ["npm-run-all", "bun run --parallel"],
  ["path-to-regexp", "Bun.serve path matching"],
  ["puppeteer", "Bun.WebView"],
  ["sirv", "Bun.serve routes { dir } (v1.4 static dir mount)"],
  ["compression", "CompressionStream (gzip/deflate/br/zstd)"],
  ["pako", "CompressionStream / DecompressionStream"],
  ["serve-static", "Bun.serve routes { dir } (v1.4 static dir mount)"],
  ["sharp", "Bun.Image"],
  ["slice-ansi", "Bun.sliceAnsi()"],
  ["tar", "Bun.Archive"],
  ["xml2js", "Bun.XML.parse()"],
]);

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

const IGNORED_PATH_SEGMENTS = new Set([
  ".audit-inbox", // vendored external repos dropped in for inspection - not our code
  ".bun-create",
  ".git",
  ".reasonix",
  "coverage",
  "node_modules",
  "vendor", // vendored third-party packages (file: deps) - not our code
]);

const IGNORED_PATH_PREFIXES = [
  "research/cache/",
  "research/evidence/",
  "research/exports/",
  "research/outputs/",
] as const;

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const transpilers = new Map<string, Bun.Transpiler>();

export interface GuardViolation {
  file: string;
  message: string;
}

function isIgnored(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized.split("/").some((segment) => IGNORED_PATH_SEGMENTS.has(segment))
    || IGNORED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function packageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    return specifier.split("/", 2).join("/");
  }
  return specifier.split("/", 1)[0] ?? specifier;
}

function npmAliasPackageName(specifier: unknown): string | null {
  if (typeof specifier !== "string" || !specifier.startsWith("npm:")) {
    return null;
  }

  const target = specifier.slice("npm:".length);
  if (target.startsWith("@")) {
    const slash = target.indexOf("/");
    if (slash < 0) return target;
    const version = target.indexOf("@", slash);
    return version < 0 ? target : target.slice(0, version);
  }

  const version = target.indexOf("@");
  return version < 0 ? target : target.slice(0, version);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function findManifestViolations(
  manifest: unknown,
  file = "package.json",
): GuardViolation[] {
  const root = asRecord(manifest);
  if (!root) {
    return [{ file, message: "manifest must contain a JSON object" }];
  }

  const violations: GuardViolation[] = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = asRecord(root[section]);
    if (!dependencies) continue;

    for (const [dependency, specifier] of Object.entries(dependencies)) {
      const replacement = BANNED_PACKAGES.get(dependency);
      if (replacement) {
        violations.push({
          file,
          message: `${section}.${dependency} duplicates ${replacement}`,
        });
      }

      const aliasTarget = npmAliasPackageName(specifier);
      const aliasReplacement = aliasTarget
        ? BANNED_PACKAGES.get(aliasTarget)
        : undefined;
      if (aliasTarget && aliasReplacement) {
        violations.push({
          file,
          message: `${section}.${dependency} aliases ${aliasTarget}; use ${aliasReplacement}`,
        });
      }
    }
  }
  return violations;
}

function sourceLoader(file: string): "js" | "jsx" | "ts" | "tsx" {
  if (file.endsWith(".tsx")) return "tsx";
  if (file.endsWith(".jsx")) return "jsx";
  if (file.endsWith(".ts") || file.endsWith(".mts") || file.endsWith(".cts")) return "ts";
  return "js";
}

function transpiler(loader: "js" | "jsx" | "ts" | "tsx"): Bun.Transpiler {
  const cached = transpilers.get(loader);
  if (cached) return cached;
  const created = new Bun.Transpiler({ loader });
  transpilers.set(loader, created);
  return created;
}

export function findSourceViolations(
  source: string,
  file = "source.ts",
): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const scannable = source.startsWith("#!")
    ? source.slice(source.indexOf("\n") + 1)
    : source;
  const imports = transpiler(sourceLoader(file)).scanImports(scannable);

  const sourceFile = ts.createSourceFile(
    file,
    scannable,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const inspectDeclaration = (node: ts.Node): void => {
    if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "Bun") {
      violations.push({
        file,
        message: "ambient/local namespace Bun shadows canonical bun-types declarations",
      });
    } else if (
      (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node))
      && node.name?.text === "Bun"
    ) {
      violations.push({
        file,
        message: "local Bun declaration shadows the canonical runtime/type namespace",
      });
    }
    ts.forEachChild(node, inspectDeclaration);
  };
  inspectDeclaration(sourceFile);

  for (const item of imports) {
    const dependency = packageName(item.path);
    const replacement = BANNED_PACKAGES.get(dependency);
    if (replacement) {
      violations.push({
        file,
        message: `${item.kind} imports ${dependency}; use ${replacement}`,
      });
    }
  }

  return violations;
}

/**
 * Bun.spawn / Bun.spawnSync keep-list - documented exceptions where Bun Shell
 * lacks the capability (no IPC channel, no unref) or the child needs the
 * parent's true TTY fds (Bun.$ pipes stdout/stderr, so child isTTY=false).
 * Any other file calling them is a guard violation (docs/BUN_SHELL.md).
 */
export const SPAWN_KEEP_LIST = new Set([
  "src/agent/research-runner.ts", // IPC (process.send) - Bun Shell has no channel
  "src/lib/editor.ts", // unref() detach for the long-lived GUI editor
  "tools/pre-commit.ts", // Bun.spawnSync in blocking sync gate
  "tools/agent-probe.ts", // Bun.spawnSync in blocking sync probe
  "src/lib/rg.ts", // Bun.spawnSync - sync audit helper (rg)
  "src/lib/breaking-audit.ts", // Bun.spawnSync - sync audit helper (rg via src/lib/rg.ts)
  "tools/db-push-gate.ts", // true TTY fds for interactive drizzle-kit prompt
  "tools/protonpass-run.ts", // true TTY fds for pass-cli agent prompts (secrets)
  "tests/lib/fetch-pool-h2.test.ts", // Bun.spawnSync openssl cert-gen in blocking test setup
  "scripts/build-design-system.ts", // async Bun.spawn for the CLI --metafile-md report
  "tools/design-check.ts", // async Bun.spawn to build the bundle for the size gate
  "src/research/serve.ts", // release-check action: Bun.spawn bun:release-watch --check (pipe capture)
  "src/institutions/signal-pipeline.ts", // runBunGate def: sub-second offline dep gates (dedupe/prune/audit)
  "src/lib/run-bun.ts", // runBunCommand: the shared Bun.which+spawn gate runner (pipe capture; §54)
  "scripts/watch-design-system.ts", // watcher rebuild: spawns the build on change
  "src/lib/design-budget.ts", // gitSnapshot: sync Bun.spawnSync git metadata for trend history
  "tools/design-audit-deps.ts", // bun audit subprocess (pipe capture)
  "tools/profile-all.ts", // profiler runner: spawns with stdio inherit
  "tools/deps-diff.ts", // bun pm diff subprocess (pipe capture)
  "tools/deps-report.ts", // dep gate runner (pipe capture)
]);

/** Flag Bun.spawn / Bun.spawnSync call sites in files outside SPAWN_KEEP_LIST. */
export function findSpawnSiteViolations(
  source: string,
  file = "source.ts",
): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const scannable = source.startsWith("#!")
    ? source.slice(source.indexOf("\n") + 1)
    : source;
  const sourceFile = ts.createSourceFile(
    file,
    scannable,
    ts.ScriptTarget.Latest,
    true, // setParentNodes: the keep-list check needs node.parent (call expression)
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "Bun"
      && (node.name.text === "spawn" || node.name.text === "spawnSync")
      && node.parent !== undefined
      && ts.isCallExpression(node.parent)
    ) {
      violations.push({
        file,
        message: `Bun.${node.name.text} outside SPAWN_KEEP_LIST - use Bun.$ where possible (docs/BUN_SHELL.md)`,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

async function trackedRepositoryFiles(root: string): Promise<string[]> {
  const { stdout, stderr, exitCode } = await $`git ls-files -z`.cwd(root).nothrow().quiet();
  if (exitCode !== 0) {
    throw new Error(`git ls-files failed: ${stderr.toString().trim() || `exit ${exitCode}`}`);
  }
  return stdout.toString().split("\0").filter(Boolean);
}

export async function auditRepository(
  root: string,
  files?: readonly string[],
): Promise<GuardViolation[]> {
  const violations: GuardViolation[] = [];
  const repositoryFiles = files ?? await trackedRepositoryFiles(root);

  for (const file of repositoryFiles) {
    if (isIgnored(file)) continue;

    if (file === "package.json" || file.endsWith("/package.json")) {
      const manifestFile = Bun.file(join(root, file));
      try {
        violations.push(...findManifestViolations(await manifestFile.json(), file));
      } catch (error) {
        violations.push({
          file,
          message: `cannot parse manifest: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      continue;
    }

    const dot = file.lastIndexOf(".");
    const extension = dot < 0 ? "" : file.slice(dot);
    if (!SOURCE_EXTENSIONS.has(extension)) continue;

    const sourceFile = Bun.file(join(root, file));
    if (!(await sourceFile.exists())) continue; // deleted-but-unstaged: normal transient state

    try {
      const source = await sourceFile.text();
      violations.push(...findSourceViolations(source, file));
      if (!SPAWN_KEEP_LIST.has(file)) {
        violations.push(...findSpawnSiteViolations(source, file));
      }
    } catch (error) {
      violations.push({
        file,
        message: `cannot scan source: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return violations.sort((a, b) =>
    a.file.localeCompare(b.file) || a.message.localeCompare(b.message)
  );
}

async function main(): Promise<void> {
  const root = join(import.meta.dir, "..");
  const violations = await auditRepository(root);

  // Runtime-surface probe: verify the installed binary exposes the APIs
  // this repo relies on (downgrade / broken install / canary regression
  // fails here, not later). See src/lib/runtime-surface.ts.
  const { runRuntimeSurfaceProbe, surfaceProbePasses } = await import("../src/lib/runtime-surface.ts");
  const surface = runRuntimeSurfaceProbe();
  const surfaceFail = surface.filter((c) => !c.ok);

  if (violations.length === 0 && surfaceFail.length === 0) {
    console.log("bun-native guard: ok");
    return;
  }

  if (surfaceFail.length > 0) {
    console.error(`bun-native guard: ${surfaceFail.length} runtime-surface failure(s)`);
    for (const c of surfaceFail) {
      console.error(`- ${c.name}: ${c.detail}`);
    }
  }
  if (violations.length > 0) {
    console.error(`bun-native guard: ${violations.length} violation(s)`);
    for (const violation of violations) {
      console.error(`- ${violation.file}: ${violation.message}`);
    }
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
