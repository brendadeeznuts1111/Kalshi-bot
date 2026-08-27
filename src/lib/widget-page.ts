/**
 * widget-page.ts — shared token-built widget shell for the Bun capability
 * deep-dive pages (/bun/networking, /bun/streams, /bun/observability,
 * /bun/performance). Audited design surfaces: only token values + data.
 */
import { BRAND, DESIGN_SYSTEM_VERSION } from '../institutions/design-tokens.ts';

export type WidgetRow = { cells: string[]; cls?: string };

export function widgetTable(headers: string[], rows: WidgetRow[]): string {
  // scope="col": column headers must name their column (1.3.1); the wrap
  // div gives narrow viewports a one-axis scroll surface (1.4.10 reflow —
  // data tables are the documented two-dimensional exception).
  const head = headers.map((h) => '<th scope="col">' + esc(h) + '</th>').join('');
  const body = rows
    .map((r) =>
      '<tr' + (r.cls ? ' class="' + r.cls + '"' : '') + '>' + r.cells.map((c) => '<td>' + c + '</td>').join('') + '</tr>',
    )
    .join('');
  return '<div class="tablewrap"><table><tr>' + head + '</tr>' + body + '</table></div>';
}

export const W_VERIFIED = '<span class="badge ok">verified</span>';
export const W_CORRECTED = '<span class="badge bad">corrected</span>';
export const W_NOTE = '<span class="badge warn">note</span>';
export const W_MARKETING = '<span class="badge dim">marketing</span>';

export type WidgetSection = {
  heading: string;
  html: string;
};

export type WidgetPage = {
  title: string;
  subtitle: string;
  badges: string[];
  sections: WidgetSection[];
  footer?: string;
  links?: string[];
};

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>\"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

export function renderWidgetPage(p: WidgetPage): string {
  const badges = p.badges.map((b) => '<span class="badge dim">' + esc(b) + '</span>').join(' ');
  const sections = p.sections
    .map((s, i) => '<section><h2>' + esc(String(i + 1) + ' · ' + s.heading) + '</h2>' + s.html + '</section>')
    .join('');
  const links = (p.links ?? []).map((l) => '<a href="' + esc(l) + '">' + esc(l) + '</a>').join(' · ');
  return '<!DOCTYPE html>' +
    '<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<title>' + esc(BRAND.name) + ' — ' + esc(p.title) + '</title>' +
    '<link rel="stylesheet" href="/design-system.css" />' +
    '<style>' +
    'body { margin: 0; background: var(--bg); color: var(--fg); font: 0.875rem/1.5 -apple-system, "SF Pro Text", Segoe UI, sans-serif; padding: 2rem 2.5rem 4rem; }' +
    'a:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }' +
    '.skip { position: absolute; left: -9999px; }' +
    '.skip:focus { left: 1rem; top: 1rem; z-index: 10; background: var(--panel); color: var(--fg); padding: 0.5rem 0.75rem; border: 1px solid var(--acc); }' +
    '.tablewrap { overflow-x: auto; }' +
    '@media (max-width: 480px) { body { padding: 1rem; } }' +
    '@media print { .skip { display: none; } body { background: #fff; color: #000; padding: 0; } a { color: #000; } }' +
    'header { border-bottom: 1px solid var(--line); padding-bottom: 1rem; margin-bottom: 1.5rem; }' +
    'header h1 { margin: 0; font-size: 1.25rem; letter-spacing: 0.04em; }' +
    'header h1 span { color: var(--acc); }' +
    'header p { color: var(--dim); font-size: 0.8rem; margin: 0.3rem 0 0; }' +
    'section { margin-bottom: 2rem; }' +
    'h2 { font-size: 1rem; margin: 0 0 0.6rem; }' +
    'table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }' +
    'div.prose table { display: block; max-width: 100%; width: max-content; overflow-x: auto; }' +
    'th, td { text-align: left; padding: 0.45rem 0.65rem; border-bottom: 1px solid var(--line); vertical-align: top; }' +
    'th { color: var(--dim); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; }' +
    'tr.tot td { border-top: 2px solid var(--line); }' +
    'code { font-family: var(--mono); font-size: 0.8rem; color: var(--acc); }' +
    'pre { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 0.8rem 1rem; overflow-x: auto; font-family: var(--mono); font-size: 0.8rem; }' +
    'ul { margin: 0.4rem 0; padding-left: 1.2rem; }' +
    'li { margin: 0.25rem 0; }' +
    'a { color: var(--acc); }' +
    'footer { color: var(--dim); font-size: 0.75rem; margin-top: 2rem; border-top: 1px solid var(--line); padding-top: 0.75rem; }' +
    '</style></head><body>' +
    '<a class="skip" href="#main">Skip to content</a>' +
    '<header><h1>' + esc(BRAND.name) + ' <span>· ' + esc(p.title) + '</span></h1>' +
    '<p>' + esc(p.subtitle) + ' · Bun ' + esc(Bun.version) + ' · design v' + esc(DESIGN_SYSTEM_VERSION) + '</p>' +
    '<p>' + badges + (links ? ' · ' + links : '') + '</p></header>' +
    '<main id="main">' +
    sections +
    '</main>' +
    (p.footer ? '<footer>' + p.footer + '</footer>' : '') +
    '</body></html>';
}
