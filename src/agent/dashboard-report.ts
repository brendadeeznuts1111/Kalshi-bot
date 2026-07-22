// @see https://bun.com/docs/runtime/markdown#ansi-terminal-output
import { dimensionArtifactBasename } from "../research/dimensions.ts";
import { REPORT_DIR, joinPath } from "../research/paths.ts";

export async function readDimensionReportMarkdown(dimension: string): Promise<string | null> {
  const base = dimensionArtifactBasename(dimension);
  const file = Bun.file(joinPath(REPORT_DIR, `${base}.md`));
  if (!(await file.exists())) return null;
  const text = (await file.text()).trim();
  return text.length > 0 ? text : null;
}

export async function readDimensionDiffMarkdown(dimension: string): Promise<string | null> {
  const base = dimensionArtifactBasename(dimension);
  const file = Bun.file(joinPath(REPORT_DIR, `${base}.diff.md`));
  if (!(await file.exists())) return null;
  const text = (await file.text()).trim();
  return text.length > 0 ? text : null;
}

export async function readBlueprintMarkdown(): Promise<string | null> {
  const file = Bun.file(joinPath(REPORT_DIR, "architecture-blueprint.md"));
  if (!(await file.exists())) return null;
  const text = (await file.text()).trim();
  return text.length > 0 ? text : null;
}

/** Server-rendered markdown for dashboard workspace (full-width HTML). */
export function renderMarkdownBody(markdown: string): string {
  const html = Bun.markdown.html(markdown);
  return `<article class="markdown-body">${html}</article>`;
}
