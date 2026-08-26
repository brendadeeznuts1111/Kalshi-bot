#!/usr/bin/env bun
/**
 * `bun run content:prune` — content pruning CLI (archive vs delete).
 *
 *   bun run content:prune              # dry-run: print the report only
 *   bun run content:prune -- --apply   # move to .trash/ + sidecars + changelog
 *   bun run content:prune -- --check   # gate mode: fail on broken manifest
 *   bun run content:prune -- --archive # also bundle removals into a .tar.gz (Bun.Archive)
 *   bun run content:prune -- --restore=content/posts/x.md  # recover from .trash
 *   bun run content:prune -- --dir=content/posts
 *   bun run content:prune -- --manifest=.data/manifest.json
 *
 * Decision matrix (src/lib/prune-content.ts): unreferenced+duplicate/stale
 * -> delete; unreferenced+large/significant -> archive; referenced+large ->
 * review; referenced -> keep. --apply moves files to .trash/<date>/ with a
 * .meta.json sidecar (originalPath/archivedAt/reason/size/hash/action/
 * performedBy) and appends a CONTENT_CHANGELOG.md entry.
 */
import { join } from "node:path";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  applyPrune,
  archiveRemovedFiles,
  changelogEntry,
  planPrune,
  restoreContent,
  scanDirectory,
  type PruneDecisionRow,
} from "../src/lib/prune-content.ts";

const root = join(import.meta.dir, "..");
const { values: pv } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    apply: { type: 'boolean' },
    check: { type: 'boolean' },
    archive: { type: 'boolean' },
    restore: { type: 'string' },
    dir: { type: 'string' },
    manifest: { type: 'string' },
  },
  strict: false,
  allowPositionals: true,
});
const apply = pv.apply === true;
const check = pv.check === true;
const archive = pv.archive === true;
const restorePath = typeof pv.restore === 'string' ? pv.restore : null;
const dir = typeof pv.dir === 'string' ? pv.dir : "content/posts";
const manifestPath = typeof pv.manifest === 'string'
  ? pv.manifest
  : ".data/manifest.json";
const changelogPath = join(root, "CONTENT_CHANGELOG.md");

let manifest: string[] = [];
const absManifest = join(root, manifestPath);
if (await Bun.file(absManifest).exists()) {
  manifest = (await Bun.file(absManifest).json()).files ?? [];
}

const files = await scanDirectory(root, dir, { hash: true });
const plan = planPrune(files, manifest);

console.log(plan.report);
// Restore mode: recover a pruned file from .trash (sidecar-driven).
if (restorePath) {
  const restored = await restoreContent(restorePath, root);
  if (restored) {
    console.log("restored -> " + restored);
    console.log("NOTE: .data/manifest.json was NOT rewritten — re-add the path if it should be active again.");
  } else {
    console.error("no .trash sidecar found for " + restorePath);
    process.exit(1);
  }
  process.exit(0);
}

console.log("manifest: " + manifestPath + " (" + manifest.length + " referenced)");
console.log("mode: " + (apply ? "APPLY" : check ? "CHECK" : "DRY-RUN"));

// Gate mode: the manifest must not reference missing files (a broken
// manifest silently defeats the prune decision matrix). The report itself
// is informational — delete/archive candidates are NOT a failure (they are
// the expected output; --apply is the explicit maintenance action).
if (check) {
  const missing = manifest.filter((p) => !existsSync(join(root, p)));
  if (missing.length > 0) {
    console.error("content:check FAIL — manifest references missing files:");
    for (const p of missing) console.error("  " + p);
    process.exit(1);
  }
  console.log("content:check ok — all " + manifest.length + " manifest files exist");
  process.exit(0);
}

if (!apply) process.exit(0);

const toMove = plan.rows.filter((r) => r.decision === "delete" || r.decision === "archive");
const moved: PruneDecisionRow[] = [];
for (const row of toMove) {
  const meta = await applyPrune(row, root);
  if (meta) moved.push(row);
  console.log((meta ? "moved  " : "skip   ") + row.decision + " " + row.file.path + (meta ? " -> " + meta.action : ""));
}

// Optional: bundle the removed files into ONE Bun.Archive tarball (gzip).
// Probe-verified: Archive.write(path, {path: Bun.file}, {compress:"gzip"})
// writes a real extractable tar.gz (AGENT-PITFALLS §26).
let archiveInfo: { path: string; bytes: number; entries: number } | null = null;
if (archive && moved.length > 0) {
  archiveInfo = await archiveRemovedFiles(moved, root);
  if (archiveInfo) {
    console.log("archive -> " + archiveInfo.path + " (" + archiveInfo.entries + " entries, " + archiveInfo.bytes + " B, gzip)");
  }
}

// Changelog append (create with a header on first use).
const entry = changelogEntry(moved, ".data/prune-report-" + new Date().toISOString().slice(0, 10) + ".json");
if (!existsSync(changelogPath)) {
  await Bun.write(changelogPath, "# CONTENT_CHANGELOG\n\nContent pruning history — see AGENT-PITFALLS §25.\n\n");
}
await Bun.write(changelogPath, await Bun.file(changelogPath).text() + entry);
console.log("changelog appended -> " + changelogPath);
console.log("removed " + moved.length + " file(s); kept " + (plan.rows.length - moved.length));
