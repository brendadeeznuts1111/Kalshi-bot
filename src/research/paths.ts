// @see https://bun.com/docs/runtime/module-resolution#import-meta
/** Bun-native path join (no node:path). */
export function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/");
}

export const ROOT = joinPath(import.meta.dir, "../..");
export const RESEARCH_ROOT = joinPath(ROOT, "research");
export const CACHE_DIR = joinPath(RESEARCH_ROOT, "cache");
export const CACHE_DB = joinPath(CACHE_DIR, "cache.db");
export const OUTPUT_DIR = joinPath(RESEARCH_ROOT, "outputs");
export const REPORT_DIR = joinPath(RESEARCH_ROOT, "reports");
export const PATTERNS_DIR = joinPath(RESEARCH_ROOT, "patterns");

/** Committed audit evidence (JSONL) — one file per repo, not per run. */
export const AUDIT_EVIDENCE_DIR = joinPath(RESEARCH_ROOT, "audit-evidence");

/** Ephemeral per-run audit bundles (manifest, findings wire, rotor-ingest). */
export const AUDIT_EXPORT_DIR = joinPath(RESEARCH_ROOT, "exports", "audit");

export function auditEvidenceSlug(fullName: string): string {
  return fullName.replace("/", "__").toLowerCase();
}

/** Repo-relative path for committed evidence JSONL. */
export function auditEvidenceRelPath(fullName: string): string {
  return joinPath("research/audit-evidence", `${auditEvidenceSlug(fullName)}.jsonl`);
}

export function auditEvidenceAbsPath(fullName: string): string {
  return joinPath(AUDIT_EVIDENCE_DIR, `${auditEvidenceSlug(fullName)}.jsonl`);
}
