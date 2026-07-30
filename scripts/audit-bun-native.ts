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
import { join } from "node:path";

export const BANNED_PACKAGES = new Map<string, string>([
  ["wrap-ansi", "Bun.wrapAnsi()"],
  ["string-width", "Bun.stringWidth()"],
  ["strip-ansi", "Bun.stripANSI()"],
  ["escape-html", "Bun.escapeHTML()"],
  ["cli-table", "Bun.inspect.table()"],
  ["cli-table3", "Bun.inspect.table()"],
  ["cli-table2", "Bun.inspect.table()"],
  ["toml", "Bun.TOML.parse() / Bun.TOML.stringify()"],
  ["@iarna/toml", "Bun.TOML.parse() / Bun.TOML.stringify()"],
  ["@ltd/j-toml", "Bun.TOML.parse() / Bun.TOML.stringify()"],
]);

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

const IGNORED_PATH_SEGMENTS = new Set([
  ".bun-create",
  ".git",
  ".reasonix",
  "coverage",
  "node_modules",
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

async function trackedRepositoryFiles(root: string): Promise<string[]> {
  const proc = Bun.spawn(["git", "ls-files", "-z"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`git ls-files failed: ${(await stderr).trim() || `exit ${exitCode}`}`);
  }
  return (await stdout).split("\0").filter(Boolean);
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

    try {
      const source = await Bun.file(join(root, file)).text();
      violations.push(...findSourceViolations(source, file));
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

  if (violations.length === 0) {
    console.log("bun-native guard: ok");
    return;
  }

  console.error(`bun-native guard: ${violations.length} violation(s)`);
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.message}`);
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
