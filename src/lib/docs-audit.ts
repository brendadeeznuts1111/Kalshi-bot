/**
 * docs-audit.ts — verify repo docs render through Bun.markdown and have
 * unique native heading ids (the "docs are managed by Bun.markdown"
 * contract). Probe-verified (AGENT-PITFALLS §38): AGENT-PITFALLS.md
 * (2353 lines) renders via Bun.markdown.html with 78 headings, all slugs
 * unique — the machinery handles the repo's own docs.
 */
import { markdownHeadings } from "./markdown-headings.ts";

export type DocAudit = {
  path: string;
  bytes: number;
  headings: number;
  duplicateSlugs: string[];
  renderOk: boolean;
  renderError?: string;
  /** sha256 of the raw doc (content-addressed ETag source). */
  hash: string;
};

/**
 * Audit one markdown file: render via Bun.markdown.html (any throw = fail)
 * + extract native heading ids + detect duplicates.
 */
export async function auditDoc(absPath: string, relPath: string): Promise<DocAudit> {
  const text = await Bun.file(absPath).text();
  const hash = (() => {
    const h = new Bun.CryptoHasher("sha256");
    h.update(text);
    return h.digest("hex");
  })();
  let renderOk = true;
  let renderError: string | undefined;
  let headings: Array<{ slug: string }> = [];
  try {
    Bun.markdown.html(text);
    headings = markdownHeadings(text);
  } catch (e) {
    renderOk = false;
    renderError = String(e).slice(0, 120);
  }
  const seen = new Set<string>();
  const duplicateSlugs: string[] = [];
  for (const h of headings) {
    if (seen.has(h.slug)) duplicateSlugs.push(h.slug);
    seen.add(h.slug);
  }
  return {
    path: relPath,
    bytes: text.length,
    headings: headings.length,
    duplicateSlugs,
    renderOk,
    ...(renderError ? { renderError } : {}),
    hash,
  };
}

/** Audit every docs/*.md (the repo's own markdown). */
export async function auditAllDocs(root: string): Promise<DocAudit[]> {
  const out: DocAudit[] = [];
  for (const f of new Bun.Glob("*.md").scanSync({ cwd: root + "/docs", onlyFiles: true })) {
    out.push(await auditDoc(root + "/docs/" + f, "docs/" + f));
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}