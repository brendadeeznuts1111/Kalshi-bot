// @see https://bun.com/docs/runtime/markdown#options — headings autolink
/** Portal top navigation — SSOT for HTML dashboards and `.md` surfaces. */

export type PortalNavId =
  | 'home'
  | 'registry'
  | 'ops'
  | 'catalog'
  | 'dod'
  | 'health'
  | 'env'
  | 'monitoring'
  | 'wiki';

export type PortalNavItem = {
  id: PortalNavId;
  label: string;
  htmlHref: string;
  /** Markdown alternate; omitted for external-only links. */
  mdHref?: string;
  external?: boolean;
};

/** Stable nav order shared by every portal page. */
export const PORTAL_NAV_ITEMS: readonly PortalNavItem[] = [
  { id: 'home', label: 'Home', htmlHref: '/', mdHref: '/' },
  { id: 'registry', label: 'Registry', htmlHref: '/portal/', mdHref: '/portal/index.md' },
  { id: 'ops', label: 'Ops', htmlHref: '/portal/ops', mdHref: '/portal/ops.md' },
  { id: 'catalog', label: 'Catalog', htmlHref: '/portal/catalog', mdHref: '/portal/catalog.md' },
  { id: 'dod', label: 'DOD', htmlHref: '/portal/dod', mdHref: '/portal/dod.md' },
  { id: 'health', label: 'Health', htmlHref: '/portal/health', mdHref: '/portal/health.md' },
  { id: 'env', label: 'Env', htmlHref: '/portal/env', mdHref: '/portal/env.md' },
  { id: 'monitoring', label: 'Monitoring', htmlHref: '/monitoring', mdHref: '/monitoring.md' },
  {
    id: 'wiki',
    label: 'Wiki',
    htmlHref: 'https://wiki.factory-wager.com',
    external: true,
  },
] as const;

export type PortalMdSlug =
  | 'index'
  | 'ops'
  | 'catalog'
  | 'dod'
  | 'health'
  | 'env'
  | 'monitoring';

export const PORTAL_MD_SLUG_TO_NAV: Record<PortalMdSlug, PortalNavId> = {
  index: 'registry',
  ops: 'ops',
  catalog: 'catalog',
  dod: 'dod',
  health: 'health',
  env: 'env',
  monitoring: 'monitoring',
};

export function portalNavItem(id: PortalNavId): PortalNavItem {
  const item = PORTAL_NAV_ITEMS.find(n => n.id === id);
  if (!item) throw new Error(`unknown portal nav id: ${id}`);
  return item;
}

/** Inner HTML for `<nav class="topbar-nav">`. */
export function renderPortalNavHtml(activeId: PortalNavId, opts: { mdView?: boolean } = {}): string {
  const links = PORTAL_NAV_ITEMS.map(item => {
    const active = item.id === activeId ? ' active' : '';
    const href = opts.mdView && item.mdHref ? item.mdHref : item.htmlHref;
    const ext = item.external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${href}" class="nav-link${active}"${ext}>${item.label}</a>`;
  }).join('\n        ');
  return links;
}

/** Markdown nav line (GFM) for Bun.markdown autolinks. */
export function renderPortalNavMarkdown(activeId: PortalNavId): string {
  const parts = PORTAL_NAV_ITEMS.map(item => {
    const href = item.mdHref ?? item.htmlHref;
    const label = item.id === activeId ? `**${item.label}**` : item.label;
    return `[${label}](${href})`;
  });
  return parts.join(' · ');
}

export function parsePortalMdPath(pathname: string): PortalMdSlug | null {
  const m = pathname.match(/^\/portal\/([a-z-]+)\.md\/?$/);
  if (!m) return null;
  const slug = m[1] as PortalMdSlug;
  return slug in PORTAL_MD_SLUG_TO_NAV ? slug : null;
}
