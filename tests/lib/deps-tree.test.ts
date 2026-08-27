/**
 * deps-tree.test.ts — dependency-shape gate (bun pm ls --all, lockfile-consistent).
 *
 * Pins the package NAME SET of the full transitive tree (per bun.lock, not
 * node_modules). Fails when a package appears that is not allowlisted, or an
 * expected package disappears — i.e. unexpected dependency growth or loss.
 * Version bumps do NOT fail (names only): dependency HEALTH is covered by
 * `bun run deps:check` (dedupe/prune) and `bun run deps:scan` (bun audit).
 *
 * To change the shape deliberately (new dep): add the name to ALLOWED_NAMES
 * in the same change that adds the dependency.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

/** The pinned, allowlisted package-name set (2026-08-26, bun.lock v2). */
const ALLOWED_NAMES = new Set([
  "@factorywager/proton-pass",
  "@types/bun",
  "@types/node",
  "bun-types",
  "drizzle-orm",
  "@kalshi/brand",
  "pinnacle-novig-mlb",
  "pinnacle-novig-nba",
  "tennis-game-model",
  "tennis-tour-pinnacle-novig",
  "typescript",
  "undici-types",
  "zod",
]);

/** Parse `bun pm ls --all` tree output into package names (scoped names safe). */
export function parseDependencyTree(text: string): string[] {
  const names: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[├└│─\s]+/, "").trim();
    if (!line || line.includes("node_modules")) continue;
    const token = line.split(/\s+/)[0] ?? "";
    if (!token.includes("@")) continue;
    const name = token.slice(0, token.lastIndexOf("@"));
    if (name) names.push(name);
  }
  return names;
}

describe("dependency tree shape (bun pm ls --all, lockfile-pinned)", () => {
  test("no unexpected packages in the transitive tree", async () => {
    const proc = Bun.spawnSync(["bun", "pm", "ls", "--all"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode).toBe(0);
    const names = parseDependencyTree(proc.stdout.toString());
    const unexpected = names.filter((n) => !ALLOWED_NAMES.has(n));
    expect(unexpected).toEqual([]);
  });

  test("every pinned package is present (no unexpected removals)", async () => {
    const proc = Bun.spawnSync(["bun", "pm", "ls", "--all"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode).toBe(0);
    const names = parseDependencyTree(proc.stdout.toString());
    const missing = [...ALLOWED_NAMES].filter((n) => !names.includes(n));
    expect(missing).toEqual([]);
    expect(names.length).toBe(ALLOWED_NAMES.size);
  });

  test("parser handles scoped names and workspace members", () => {
    const sample = [
      "/repo node_modules",
      "├── @types/bun@1.4.0",
      "├── pinnacle-novig-mlb@workspace:alpha/pinnacle-novig-mlb",
      "└── zod@4.4.3",
    ].join("\n");
    expect(parseDependencyTree(sample)).toEqual([
      "@types/bun",
      "pinnacle-novig-mlb",
      "zod",
    ]);
  });
});
