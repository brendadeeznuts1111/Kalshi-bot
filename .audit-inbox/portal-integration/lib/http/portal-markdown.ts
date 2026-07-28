/**
 * Portal markdown pages — raw source + HTML shell.
 * @see https://bun.com/docs/runtime/markdown#bun-markdown-html
 */

const PAGES: Record<string, string> = {
  index: `# Registry\n\nFactoryWager package registry overview.\n`,
  ops: `# Ops\n\nOperations dashboard (tree, plays, rails).\n`,
  catalog: `# Catalog\n\nPlatform + account catalog.\n`,
  dod: `# DOD\n\nVisual-proof submission queue.\n`,
  health: `# Health\n\nService health probe.\n`,
  env: `# Env\n\nEnvironment + secret status (redacted).\n`,
  skills: `# Skills\n\nInstalled Kimi skills registry (name, description, last updated) with downloadable \`.skill\` packages when available.\n`,
  monitoring: `# Monitoring\n\nRegistry + integrity metrics.\n`,
};

export function portalMarkdownExists(slug: string): boolean {
  return slug in PAGES;
}

export function portalMarkdownRaw(slug: string): string {
  return PAGES[slug] ?? `# ${slug}\n\n(page not found)\n`;
}

export function renderPortalMarkdownPage(slug: string): string {
  const md = portalMarkdownRaw(slug);
  let bodyHtml: string;
  try {
    bodyHtml = Bun.markdown.html(md);
  } catch {
    bodyHtml = `<pre>${escapeHtml(md)}</pre>`;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(slug)} · FactoryWager</title>
  <link rel="stylesheet" href="/portal/style.css"/>
</head>
<body class="portal-md">
  <nav><a href="/portal/">Portal</a></nav>
  <main>${bodyHtml}</main>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
