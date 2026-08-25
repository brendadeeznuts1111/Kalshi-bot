#!/usr/bin/env bun
/**
 * Colorized dependency outdated report (bun update visual language).
 *
 *   bun run deps:outdated
 *   bun run deps:outdated -- --json
 *
 * Uses `bun outdated` + Bun.color via paintSemverChange (red major / yellow minor / green patch).
 *
 * @see https://bun.com/docs/pm/cli/update#visual-indicators
 * @see https://bun.com/docs/runtime/color
 * @see https://bun.com/docs/runtime/environment-variables#configuring-bun
 */
import { $ } from "bun";
import { paintSemverChange, type SemverChange } from "../src/lib/color/index.ts";

type OutdatedRow = {
  package: string;
  current: string;
  update: string;
  latest: string;
  workspace?: string;
};

// Version core + comparisons come from the shared SSOT
// (src/lib/semver.ts — Bun.semver, normalize-first rule §121-§123).
import { semverCore } from "../src/lib/semver.ts";

/**
 * Classify bump from current → target.
 * Segment comparison via semverCore (numeric core); same-core diffs that are
 * still version changes (prerelease/build metadata, e.g. 2.1.0-beta.1 → 2.1.0)
 * fall through to Bun.semver.order for a correct verdict (patch-level).
 */
export function classifySemverChange(current: string, target: string): SemverChange {
  const a = semverCore(current);
  const b = semverCore(target);
  if (!a || !b) return "unknown";
  if (b[0] !== a[0]) return "major";
  if (b[1] !== a[1]) return "minor";
  if (b[2] !== a[2]) return "patch";
  // Same numeric core — prerelease/build metadata may still differ.
  return Bun.semver.order(current, target) === 0 ? "same" : "patch";
}

/**
 * Parse `bun outdated` table text (ASCII table with | separators).
 * Stable enough for operator TTY; --json uses structured path when available.
 */
export function parseOutdatedTable(text: string): OutdatedRow[] {
  const rows: OutdatedRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes("|") || line.includes("---") || /Package/i.test(line)) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    // Package | Current | Update | Latest  OR  + Workspace
    if (cells.length < 4) continue;
    const [pkg, current, update, latest] = cells;
    if (!pkg || !current || !latest) continue;
    if (pkg === "Package") continue;
    rows.push({
      package: pkg
        .replace(/\s*\((dev|peer|optional)\)\s*$/i, "")
        .replace(/\s+(dev|peer|optional)$/i, "")
        .trim(),
      current,
      update: update || current,
      latest,
    });
  }
  return rows;
}

async function runBunOutdated(): Promise<string> {
  const { stdout, stderr, exitCode } = await $`bun outdated`.env({ ...Bun.env, NO_COLOR: "1" }).nothrow().quiet();
  const outText = stdout.toString();
  const errText = stderr.toString();
  // bun outdated exits 0 with empty table or non-zero when outdated — accept both
  if (exitCode !== 0 && !outText.includes("Package")) {
    throw new Error(errText.trim() || `bun outdated exited ${exitCode}`);
  }
  return outText;
}

async function main() {
  const json = Bun.argv.includes("--json");
  const preferLatest = Bun.argv.includes("--latest");

  const text = await runBunOutdated();
  const rows = parseOutdatedTable(text);

  if (json) {
    const enriched = rows.map((r) => {
      const target = preferLatest ? r.latest : r.update;
      return {
        ...r,
        target,
        change: classifySemverChange(r.current, target),
      };
    });
    console.log(JSON.stringify({ schemaVersion: 1, packages: enriched }, null, 2));
    return;
  }

  if (!rows.length) {
    console.log(paintSemverChange("patch", "All dependencies within range (bun outdated empty)."));
    console.log("  Tip: bun update -i     interactive · bun update -i -r  monorepo workspaces");
    return;
  }

  console.log("Outdated packages  (color = major/minor/patch vs target)\n");
  console.log(
    "  " +
      "Package".padEnd(28) +
      "Current".padEnd(12) +
      "Update".padEnd(12) +
      "Latest".padEnd(12) +
      "Bump",
  );
  console.log("  " + "─".repeat(72));

  for (const r of rows) {
    const target = preferLatest ? r.latest : r.update;
    const change = classifySemverChange(r.current, target);
    const bump = paintSemverChange(change, change.padEnd(8));
    console.log(
      "  " +
        r.package.padEnd(28) +
        r.current.padEnd(12) +
        r.update.padEnd(12) +
        r.latest.padEnd(12) +
        bump,
    );
  }

  console.log("\n  Legend: " +
    paintSemverChange("major", "major") + "  " +
    paintSemverChange("minor", "minor") + "  " +
    paintSemverChange("patch", "patch"));
  console.log("  Next:   bun update -i          # interactive (□/■ selection)");
  console.log("          bun update -i -r       # all workspaces");
  console.log("          bun update --latest    # ignore range caps");
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
