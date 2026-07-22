// @see https://bun.com/docs/runtime/utils#bun-openineditor
import { existsSync } from "node:fs";
import { PATTERNS_DIR, joinPath } from "../research/paths.ts";
import { fileUrlToAbsPath } from "../research/bun-native.ts";
import { patternReportBasename, type FilePatternSlice, type PatternReport } from "./pattern-extract.ts";

export type PatternEditorTarget = {
  path: string;
  line?: number;
  column?: number;
  source: "clone" | "report";
};

/** Resolve local clone path when REPO_CLONE_ROOT is set (owner/repo checkout). */
export function resolveClonedRepoFile(fullName: string, filePath: string): string | null {
  const root = Bun.env.REPO_CLONE_ROOT?.trim();
  if (!root) return null;
  const slash = fullName.indexOf("/");
  if (slash <= 0) return null;
  const owner = fullName.slice(0, slash);
  const repo = fullName.slice(slash + 1);
  if (!repo) return null;
  const normalized = filePath.replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return null;
  const abs = joinPath(root, owner, repo, normalized);
  return existsSync(abs) ? abs : null;
}

export function patternReportPath(dimension: string): string {
  return joinPath(PATTERNS_DIR, `${patternReportBasename(dimension)}.md`);
}

export function resolvePatternEditorTarget(
  fullName: string,
  file: FilePatternSlice,
): PatternEditorTarget | null {
  const cloned = resolveClonedRepoFile(fullName, file.path);
  if (cloned) {
    return {
      path: cloned,
      line: file.excerptLine,
      source: "clone",
    };
  }
  return null;
}

export function openPatternEditorTarget(target: PatternEditorTarget): void {
  const opts: { line?: number; column?: number } = {};
  if (target.line !== undefined) opts.line = target.line;
  if (target.column !== undefined) opts.column = target.column;
  Bun.openInEditor(target.path, Object.keys(opts).length ? opts : undefined);
}

export function openPatternReport(dimension: string, line?: number): void {
  openPatternEditorTarget({ path: patternReportPath(dimension), line, source: "report" });
}

/** Open best available target after `agent patterns` — clone file when present, else report markdown. */
export function openPatternExcerpt(report: PatternReport, repoFilter?: string): PatternEditorTarget {
  const repo =
    report.repos.find((r) => r.fullName === repoFilter) ??
    report.repos.find((r) => r.files.some((f) => f.fetchOk && f.excerpt)) ??
    report.repos[0];

  if (repo) {
    const file = repo.files.find((f) => f.fetchOk && f.excerpt) ?? repo.files.find((f) => f.fetchOk);
    if (file) {
      const cloned = resolvePatternEditorTarget(repo.fullName, file);
      if (cloned) {
        openPatternEditorTarget(cloned);
        return cloned;
      }
    }
  }

  const reportTarget: PatternEditorTarget = {
    path: patternReportPath(report.dimension),
    source: "report",
  };
  openPatternEditorTarget(reportTarget);
  return reportTarget;
}

/** Open report from a file:// URL (e.g. import.meta.url of the writer module). */
export function openFileUrlInEditor(url: string | URL, line?: number): void {
  openPatternEditorTarget({
    path: fileUrlToAbsPath(url),
    line,
    source: "report",
  });
}
