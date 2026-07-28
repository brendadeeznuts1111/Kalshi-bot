// @see https://bun.com/docs/runtime/markdown#bun-markdown-html — Bun.markdown.html
// @see https://bun.com/docs/runtime/markdown#options — headings ids + autolink
import {
  type PortalEnvStatusPayload,
  buildPortalEnvStatus,
} from './portal-env-status.ts';
import {
  type PortalMdSlug,
  PORTAL_MD_SLUG_TO_NAV,
  portalNavItem,
  renderPortalNavHtml,
} from './portal-nav.ts';

export const PORTAL_MARKDOWN_PARSER = {
  tables: true,
  strikethrough: true,
  tasklists: true,
  tagFilter: true,
  autolinks: true,
  headings: { ids: true, autolink: true },
} as const;

const PAGE_TITLES: Record<PortalMdSlug, string> = {
  index: 'Factory Registry',
  ops: 'Operations',
  catalog: 'Catalog',
  dod: 'DOD Queue',
  health: 'Health',
  env: 'Environment',
  monitoring: 'Monitoring',
};

function escCell(s: string): string {
  return s.replace(/\|/g, '\\|');
}

function statusMark(ok: boolean): string {
  return ok ? '✓' : '✗';
}

export function buildEnvStatusMarkdown(data: PortalEnvStatusPayload): string {
  const lines: string[] = [
    '# Environment',
    '',
    `Generated: \`${data.generated}\``,
    '',
    '## Critical secrets',
    '',
    'Required for server operations.',
    '',
    '| Status | Variable | Description | Actual |',
    '| --- | --- | --- | --- |',
  ];

  for (const row of data.critical) {
    lines.push(
      `| ${statusMark(row.set)} | \`${row.key}\` | ${escCell(row.desc)} | ${row.actual ?? '—'} |`
    );
  }

  lines.push('', '## Optional configuration', '', '| Status | Variable | Description | Actual | Default |', '| --- | --- | --- | --- | --- |');
  for (const row of data.optional) {
    lines.push(
      `| ${statusMark(row.match)} | \`${row.key}\` | ${escCell(row.desc)} | ${row.actual || '—'} | ${row.default ?? '—'} |`
    );
  }

  lines.push('', '## Content-Type handling', '', '| Status | Scenario | Default | Our value | Expected |', '| --- | --- | --- | --- | --- |');
  for (const row of data.contentType) {
    lines.push(
      `| ${statusMark(row.match)} | ${escCell(row.scenario)} | ${escCell(row.default)} | ${escCell(row.our)} | ${escCell(row.expected)} |`
    );
  }

  return lines.join('\n');
}

function stubMarkdown(slug: PortalMdSlug): string {
  if (slug === 'env') return buildEnvStatusMarkdown(buildPortalEnvStatus());

  const sections: Record<Exclude<PortalMdSlug, 'env'>, string[]> = {
    index: [
      '# Factory Registry',
      '',
      'R2-backed package index served from `public/registry/registry.json` or live SQLite.',
      '',
      '## APIs',
      '',
      '- [`/api/registry`](/api/registry) — package index JSON',
      '- [`/portal/`](/portal/) — interactive registry UI',
    ],
    ops: [
      '# Operations',
      '',
      'Live ops summary, prediction widgets, and routing proof surfaces.',
      '',
      '## APIs',
      '',
      '- [`/api/operations/summary`](/api/operations/summary)',
      '- [`/portal/ops/`](/portal/ops/) — dashboard UI',
    ],
    catalog: [
      '# Catalog',
      '',
      'Account catalog from SQLite.',
      '',
      '## APIs',
      '',
      '- [`/api/catalog`](/api/catalog)',
      '- [`/portal/catalog/`](/portal/catalog/)',
    ],
    dod: [
      '# DOD Queue',
      '',
      'Definition-of-done submission queue.',
      '',
      '## APIs',
      '',
      '- [`/api/dod`](/api/dod)',
      '- [`/portal/dod/`](/portal/dod/)',
    ],
    health: [
      '# Health',
      '',
      'Compact system health from `/health` and registry artifacts.',
      '',
      '## Endpoints',
      '',
      '- [`/health`](/health) — JSON health',
      '- [`/health/pre`](/health/pre) — HTML preformatted',
      '- [`/portal/health/`](/portal/health/) — dashboard UI',
    ],
    monitoring: [
      '# Monitoring',
      '',
      'Registry + ops metrics dashboard.',
      '',
      '## Endpoints',
      '',
      '- [`/api/monitoring`](/api/monitoring) — JSON',
      '- [`/monitoring`](/monitoring) — HTML table dashboard',
    ],
  };
  return sections[slug].join('\n');
}

export function portalMarkdownSource(slug: PortalMdSlug): string {
  return stubMarkdown(slug);
}

export function renderPortalMarkdownPage(slug: PortalMdSlug): string {
  const activeId = PORTAL_MD_SLUG_TO_NAV[slug];
  const title = PAGE_TITLES[slug];
  const markdown = portalMarkdownSource(slug);
  const body = Bun.markdown.html(markdown, PORTAL_MARKDOWN_PARSER);
  const nav = renderPortalNavHtml(activeId, { mdView: true });
  const htmlView = portalNavItem(activeId).htmlHref;

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} · FactoryWager</title>
  <link rel="alternate" type="text/markdown" href="/portal/${slug === 'index' ? 'index' : slug}.md" />
  <link rel="stylesheet" href="/portal/style.css" />
  <style>
    .portal-md { max-width: 960px; margin: 0 auto; padding: 24px; }
    .portal-md h1, .portal-md h2, .portal-md h3 { scroll-margin-top: 72px; }
    .portal-md h1 a, .portal-md h2 a, .portal-md h3 a {
      color: inherit; text-decoration: none;
    }
    .portal-md h1 a:hover, .portal-md h2 a:hover, .portal-md h3 a:hover { color: var(--accent); }
    .portal-md table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
    .portal-md th, .portal-md td {
      text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border);
    }
    .portal-md th { color: var(--text-dim); font-size: 11px; text-transform: uppercase; }
    .portal-md code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    .portal-md p { margin: 12px 0; color: var(--text-dim); line-height: 1.5; }
    .view-toggle { font-size: 12px; margin-left: auto; }
    .view-toggle a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <h1 class="logo"><span class="logo-icon">■</span> ${title}</h1>
      <nav class="topbar-nav" aria-label="Primary">
        ${nav}
      </nav>
      <div class="topbar-status view-toggle">
        <a href="${htmlView}">HTML view</a>
      </div>
    </div>
  </header>
  <main class="portal-md">${body}</main>
</body>
</html>`;
}

/** Raw markdown bytes for `text/markdown` responses (Accept: text/markdown). */
export function portalMarkdownRaw(slug: PortalMdSlug): string {
  return portalMarkdownSource(slug);
}
