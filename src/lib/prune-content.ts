/**
 * prune-content.ts — content pruning decision framework (archive vs delete).
 *
 * The pasted "archive vs delete" doc, probe-corrected (AGENT-PITFALLS §25):
 *   - `Bun.rename` DOES NOT EXIST — use node:fs `renameSync`.
 *   - `ensureDirectory` is NOT a Bun/node API — `mkdirSync(path, { recursive: true })`.
 *   - renameSync on a missing file throws ENOENT (check existsSync first).
 *   - Sidecar metadata write/read roundtrip verified (Bun.write + Bun.file).
 *   - File hashes in sidecars use hashContent (CryptoHasher sha256, §24).
 *
 * Decision matrix (codified):
 *   unreferenced + duplicate/stale              -> delete
 *   unreferenced + historically significant    -> archive
 *   referenced + large + rarely used           -> review
 *   referenced                                 -> keep
 *   generated / rebuildable (thumbnails, dist) -> delete
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { hashContent } from "./content-pipeline.ts";

export type PruneDecision = "delete" | "archive" | "review" | "keep";

export type FileRecord = {
  path: string;      // repo-relative, e.g. "content/posts/old.md"
  absPath: string;
  size: number;
  /** Present when a duplicate content hash was computed (delete category). */
  hash?: string;
  /** Timestamp of the file mtime (ISO). */
  mtime: string;
};

export type PruneThresholds = {
  /** Files over this size (bytes) are candidates for archive/review. */
  largeBytes: number;
  /** Unreferenced files older than this many days are stale -> delete. */
  staleDays: number;
};

export const DEFAULT_THRESHOLDS: PruneThresholds = {
  largeBytes: 100 * 1024 * 1024, // 100 MB
  staleDays: 90,
};

export type PruneDecisionRow = {
  file: FileRecord;
  decision: PruneDecision;
  reason: string;
};

export type PrunePlan = {
  rows: PruneDecisionRow[];
  report: string;
};

const esc = (v: unknown): string => String(v ?? "").replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
);

const isStale = (mtimeIso: string, staleDays: number): boolean => {
  const ageMs = Date.now() - new Date(mtimeIso).getTime();
  return ageMs > staleDays * 24 * 60 * 60 * 1000;
};

/** Group file records by content hash to detect duplicates. */
function duplicateGroups(files: FileRecord[]): Map<string, FileRecord[]> {
  const byHash = new Map<string, FileRecord[]>();
  for (const f of files) {
    if (!f.hash) continue;
    const list = byHash.get(f.hash) ?? [];
    list.push(f);
    byHash.set(f.hash, list);
  }
  const dups = new Map<string, FileRecord[]>();
  for (const [h, list] of byHash) if (list.length > 1) dups.set(h, list);
  return dups;
}

/**
 * Classify files against the manifest + thresholds (pure — the decision
 * matrix; no IO beyond the caller-provided records).
 */
export function planPrune(
  files: FileRecord[],
  manifest: string[],
  thresholds: PruneThresholds = DEFAULT_THRESHOLDS,
  opts?: { historicallySignificant?: (f: FileRecord) => boolean },
): PrunePlan {
  const rows: PruneDecisionRow[] = [];
  const manifestSet = new Set(manifest);
  const dups = duplicateGroups(files);

  for (const file of files) {
    const referenced = manifestSet.has(file.path);
    const isDup = !!dups.get(file.hash ?? "")?.some((d) => d.path !== file.path);
    const big = file.size > thresholds.largeBytes;

    if (referenced) {
      if (big) rows.push({ file, decision: "review", reason: "referenced but large (" + file.size + " B)" });
      else rows.push({ file, decision: "keep", reason: "referenced in manifest" });
      continue;
    }
    // Unreferenced: duplicate or stale -> delete; big -> archive; else keep
    // (young, unreferenced files stay until they age or get referenced).
    if (isDup) {
      rows.push({ file, decision: "delete", reason: "unreferenced duplicate (hash " + file.hash!.slice(0, 12) + ")" });
    } else if (isStale(file.mtime, thresholds.staleDays)) {
      rows.push({ file, decision: "delete", reason: "unreferenced + stale (mtime " + file.mtime.slice(0, 10) + ")" });
    } else if (big || opts?.historicallySignificant?.(file)) {
      rows.push({ file, decision: "archive", reason: big ? "unreferenced + large (" + file.size + " B)" : "historically significant" });
    } else {
      rows.push({ file, decision: "keep", reason: "unreferenced but young — keep for now" });
    }
  }

  const report = buildReport(rows);
  return { rows, report };
}

export function buildReport(rows: PruneDecisionRow[]): string {
  const by = (d: PruneDecision) => rows.filter((r) => r.decision === d);
  const line = (r: PruneDecisionRow) => "- " + r.decision + " " + r.file.path + " (" + r.file.size + " B) — " + r.reason;
  return [
    "# Content Prune Report",
    "",
    "Generated " + new Date().toISOString(),
    "",
    "## Summary",
    "- delete: " + by("delete").length,
    "- archive: " + by("archive").length,
    "- review: " + by("review").length,
    "- keep: " + by("keep").length,
    "",
    "## delete",
    ...by("delete").map(line),
    "## archive",
    ...by("archive").map(line),
    "## review",
    ...by("review").map(line),
    "## keep",
    ...by("keep").map(line),
    "",
  ].join("\n");
}

/** Changelog entry for one prune run (the doc's CONTENT_CHANGELOG.md shape). */
export function changelogEntry(rows: PruneDecisionRow[], reportPath: string): string {
  const by = (d: PruneDecision) => rows.filter((r) => r.decision === d);
  return [
    "## " + new Date().toISOString().slice(0, 10) + " – Content Prune",
    "- Deleted " + by("delete").length + " unreferenced file(s): " + by("delete").map((r) => r.file.path).join(", "),
    "- Archived " + by("archive").length + " file(s): " + by("archive").map((r) => r.file.path).join(", "),
    "- Reason: codified decision matrix (AGENT-PITFALLS §25).",
    "- Report: " + reportPath,
    "",
  ].join("\n");
}

export type ArchiveMeta = {
  originalPath: string;
  archivedAt: string;
  reason: string;
  size: number;
  hash?: string;
  action: "archived" | "deleted";
  performedBy: string;
};

/**
 * Move a file to .trash/<date>/<dir>/ + write <name>.meta.json sidecar.
 * renameSync (NOT Bun.rename — it does not exist) + mkdirSync recursive
 * (NOT ensureDirectory — not an API). Skips when already gone.
 */
export async function applyPrune(
  row: PruneDecisionRow,
  root: string,
  performedBy = "prune-script",
): Promise<ArchiveMeta | null> {
  if (!existsSync(row.file.absPath)) return null;
  const dateDir = new Date().toISOString().slice(0, 10);
  const relDir = dirname(row.file.path);
  const name = row.file.path.split("/").pop()!;
  const destDir = join(root, ".trash", dateDir, relDir);
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, name);
  renameSync(row.file.absPath, dest);
  const meta: ArchiveMeta = {
    originalPath: row.file.path,
    archivedAt: new Date().toISOString(),
    reason: row.reason,
    size: row.file.size,
    ...(row.file.hash ? { hash: row.file.hash } : {}),
    action: row.decision === "archive" ? "archived" : "deleted",
    performedBy,
  };
  await Bun.write(dest + ".meta.json", JSON.stringify(meta, null, 2));
  return meta;
}

/**
 * Bundle already-removed files into one Bun.Archive tarball (gzip).
 * Probe-verified (AGENT-PITFALLS §26): Bun.Archive.write(path, {
 *   "entry/path": Bun.file(abs) }, { compress: "gzip" }) writes a real
 * tar.gz; new Bun.Archive(bytes).extract(dir) round-trips it. The returned
 * path is recorded in the prune signal/changelog — one artifact per prune
 * run instead of loose .trash copies when --archive is used.
 */
export async function archiveRemovedFiles(
  rows: PruneDecisionRow[],
  root: string,
): Promise<{ path: string; bytes: number; entries: number } | null> {
  const moved = rows.filter((r) => r.decision === "delete" || r.decision === "archive");
  if (moved.length === 0) return null;
  const dateDir = new Date().toISOString().slice(0, 10);
  const trashDir = join(root, ".trash", dateDir);
  mkdirSync(trashDir, { recursive: true });
  const outPath = join(trashDir, "prune-" + dateDir + ".tar.gz");
  // PROBE-CORRECTED (§26): Archive.write with a Bun.file VALUE writes an
  // empty payload (structurally valid tar, 0-byte entries — verified). Only
  // string / Uint8Array / Blob values round-trip. Read bytes first.
  const data: Record<string, Blob> = {};
  for (const row of moved) {
    const abs = join(trashDir, row.file.path);
    if (!existsSync(abs)) continue;
    const bytes = await Bun.file(abs).bytes();
    data[row.file.path] = new Blob([bytes]);
  }
  if (Object.keys(data).length === 0) return null;
  await Bun.Archive.write(outPath, data, { compress: "gzip" });
  const bytes = (await Bun.file(outPath).stat()).size;
  return { path: outPath, bytes, entries: Object.keys(data).length };
}

/**
 * Restore a pruned file from .trash using its metadata sidecar.
 * Scans .trash/<date>/<dir>/<name>.meta.json for originalPath === target;
 * when found, renames the archived file back to originalPath and removes
 * the sidecar. Returns the restored path or null.
 */
export async function restoreContent(targetPath: string, root: string): Promise<string | null> {
  const trashDir = join(root, ".trash");
  if (!existsSync(trashDir)) return null;
  const entries = readdirSync(trashDir, { recursive: true }) as unknown as string[];
  const sidecars = entries.filter((e) => e.endsWith(".meta.json"));
  for (const sc of sidecars) {
    const scAbs = join(trashDir, sc);
    let meta: { originalPath?: string };
    try {
      meta = JSON.parse(await Bun.file(scAbs).text());
    } catch {
      continue;
    }
    if (meta.originalPath !== targetPath) continue;
    const archivedAbs = scAbs.slice(0, -".meta.json".length);
    if (!existsSync(archivedAbs)) return null;
    mkdirSync(dirname(join(root, targetPath)), { recursive: true });
    renameSync(archivedAbs, join(root, targetPath));
    // remove the sidecar (the file is back in the active tree)
    rmSync(scAbs, { force: true });
    return targetPath;
  }
  return null;
}

/** Scan a directory (recursive) into FileRecords with mtime + optional hash. */
export async function scanDirectory(
  root: string,
  dir: string,
  opts?: { hash?: boolean },
): Promise<FileRecord[]> {
  // Bun.Glob (native) replaces the recursive readdirSync walk — onlyFiles
  // skips directories, so no manual statSync.isDirectory() recursion.
  const out: FileRecord[] = [];
  for (const rel of new Bun.Glob('**/*').scanSync({ cwd: join(root, dir), onlyFiles: true })) {
    if (rel.split('/').includes('.trash')) continue;
    const abs = join(root, dir, rel);
    const st = statSync(abs);
    const rec: FileRecord = {
      path: relative(root, abs),
      absPath: abs,
      size: st.size,
      mtime: st.mtime.toISOString(),
    };
    if (opts?.hash) rec.hash = hashContent(await Bun.file(abs).bytes());
    out.push(rec);
  }
  return out;
}

export { esc };
