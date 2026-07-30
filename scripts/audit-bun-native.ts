#!/usr/bin/env bun
/**
 * Guard exact Bun-native replacements without adding an ESLint dependency.
 *
 * Checks direct dependency declarations, static/dynamic imports, require()
 * calls, and direct console table usage. Transitive dependencies are not
 * blocked because application code does not control their implementation.
 *
 * @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
 * @see https://bun.com/docs/runtime/glob#quickstart
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

const IGNORED_PATH_PREFIXES = [
  ".bun-create/",
  ".git/",
  ".reasonix/",
  "coverage/",
  "node_modules/",
  "research/cache/",
  "research/evidence/",
  "research/exports/",
  "research/outputs/",
] as const;

const SOURCE_GLOB = new Bun.Glob("**/*.{ts,tsx,js,jsx,mjs,cjs}");
const MANIFEST_GLOB = new Bun.Glob("**/package.json");
const transpilers = new Map<string, Bun.Transpiler>();

export interface GuardViolation {
  file: string;
  message: string;
}

function isIgnored(path: string): boolean {
  return IGNORED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function packageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    return specifier.split("/", 2).join("/");
  }
  return specifier.split("/", 1)[0] ?? specifier;
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

    for (const dependency of Object.keys(dependencies)) {
      const replacement = BANNED_PACKAGES.get(dependency);
      if (replacement) {
        violations.push({
          file,
          message: `${section}.${dependency} duplicates ${replacement}`,
        });
      }
    }
  }
  return violations;
}

function sourceLoader(file: string): "js" | "jsx" | "ts" | "tsx" {
  if (file.endsWith(".tsx")) return "tsx";
  if (file.endsWith(".jsx")) return "jsx";
  if (file.endsWith(".ts")) return "ts";
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

  if (/\bconsole\s*\.\s*table\s*\(/u.test(scannable)) {
    violations.push({
      file,
      message: "console table prints directly; use Bun.inspect.table() and write the returned string",
    });
  }

  return violations;
}

export async function auditRepository(root: string): Promise<GuardViolation[]> {
  const violations: GuardViolation[] = [];

  for await (const file of MANIFEST_GLOB.scan({ cwd: root, onlyFiles: true })) {
    if (isIgnored(file)) continue;
    const manifestFile = Bun.file(join(root, file));
    try {
      violations.push(...findManifestViolations(await manifestFile.json(), file));
    } catch (error) {
      violations.push({
        file,
        message: `cannot parse manifest: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  for await (const file of SOURCE_GLOB.scan({ cwd: root, onlyFiles: true })) {
    if (isIgnored(file)) continue;
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
