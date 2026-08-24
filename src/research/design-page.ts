/**
 * design-page.ts — /design token inspector: the live consumer of the
 * design-system.css artifact (links it, never inlines) plus a server-rendered
 * walk of TOKENS, the component registry, and the design agent version.
 *
 * The page is an ENFORCED design surface: every color/radius rendered here
 * comes from TOKENS (design:check audits renderDesignPage()). Swatches use
 * the token values themselves as inline backgrounds — legal by definition.
 */
import { designAgent } from '../agent/design-agent.ts';
import { BRAND, DESIGN_SYSTEM_VERSION, TOKENS } from '../institutions/design-tokens.ts';
import { HQ_COMPONENTS } from '../institutions/hq-ui.ts';

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>\"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

/** True when a token value looks like a color (#hex or rgba()). */
function isColorValue(v: string): boolean {
  return /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(v) || /^rgba?\(/.test(v);
}

/** Flatten TOKENS to leaf rows; group by top-level section (color/space/radius/font). */
function tokenRows(): Array<{ group: string; path: string; value: string }> {
  const rows: Array<{ group: string; path: string; value: string }> = [];
  const walk = (obj: Record<string, unknown>, path: string): void => {
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? path + '.' + k : k;
      if (typeof v === 'string') {
        rows.push({ group: path.split('.')[0] || 'root', path: p, value: v });
      } else if (v && typeof v === 'object') {
        walk(v as Record<string, unknown>, p);
      }
    }
  };
  walk(TOKENS as unknown as Record<string, unknown>, '');
  return rows;
}

export function renderDesignPage(): string {
  const manifest = designAgent.manifest();
  const rows = tokenRows();
  const groups = [...new Set(rows.map((r) => r.group))];

  const tokenSections = groups
    .map((group) => {
      const body = rows
        .filter((r) => r.group === group)
        .map((r) => {
          const swatch = isColorValue(r.value)
            ? '<span class="swatch" style="background:' + r.value + '"></span>'
            : '';
          const mono = isColorValue(r.value) ? ' class="mono"' : '';
          return '<tr><td>' + swatch + esc(r.path) + '</td><td' + mono + '>' + esc(r.value) + '</td></tr>';
        })
        .join('');
      return '<section><h2>' + esc(group) + '</h2><table><tr><th>Token</th><th>Value</th></tr>' + body + '</table></section>';
    })
    .join('');

  const componentRows = Object.entries(HQ_COMPONENTS)
    .map(([name, version]) => '<tr><td>' + esc(name) + '</td><td class="mono">' + esc(version) + '</td></tr>')
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${BRAND.name} — design tokens</title>
<link rel="stylesheet" href="/design-system.css" />
<style>
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, \"SF Pro Text\", Segoe UI, sans-serif; padding: 2rem 2.5rem 4rem; }
header { border-bottom: 1px solid var(--line); padding-bottom: 1rem; margin-bottom: 1.5rem; }
header h1 { margin: 0; font-size: 1.2rem; letter-spacing: 0.04em; }
header h1 span { color: var(--acc); }
header p { color: var(--dim); font-size: 0.8rem; margin: 0.3rem 0 0; }
section { margin-bottom: 1.75rem; }
h2 { font-size: 0.95rem; margin: 0 0 0.6rem; }
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
th, td { text-align: left; padding: 0.35rem 0.6rem; border-bottom: 1px solid var(--line); }
th { color: var(--dim); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; }
td.mono { font-family: var(--mono); }
.swatch { display: inline-block; width: 0.7rem; height: 0.7rem; border-radius: 4px; border: 1px solid var(--line); margin-right: 0.5rem; vertical-align: middle; }
a { color: var(--acc); }
footer { color: var(--dim); font-size: 0.75rem; margin-top: 2rem; border-top: 1px solid var(--line); padding-top: 0.75rem; }
</style>
</head>
<body>
<header><h1>${BRAND.name} <span>design</span></h1><p>v${esc(DESIGN_SYSTEM_VERSION)} · manifest at <a href="/api/design">/api/design</a> · stylesheet at <a href="/design-system.css">/design-system.css</a> · self-audit <a href="/api/design/audit">/api/design/audit</a> · bundle trend <a href="/design/trend">/design/trend</a> · Bun: <a href="/bun/networking">networking</a> <a href="/bun/streams">streams</a> <a href="/bun/observability">observability</a> <a href="/bun/performance">performance</a></p></header>
<section><h2>Components</h2><table><tr><th>Component</th><th>Version</th></tr>${componentRows}</table></section>
${tokenSections}
<footer>Token inspector — every value rendered here is a TOKENS value (one vocabulary). Generated at request time from the design agent manifest.</footer>
</body>
</html>
`;
}
