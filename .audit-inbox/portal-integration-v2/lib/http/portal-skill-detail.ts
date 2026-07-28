/**
 * Portal skill detail — server-rendered `/portal/skills/<name>` page.
 * Body markdown renders through Bun.markdown.html with the shared
 * PORTAL_MARKDOWN_PARSER feature set; all dynamic text is HTML-escaped.
 * @see https://bun.com/docs/runtime/markdown#bun-markdown-html
 */

import type { SkillDetail } from './skills-catalog.ts';

/** GFM-ish parser flags shared by portal markdown surfaces. */
export const PORTAL_MARKDOWN_PARSER = {
  tables: true,
  strikethrough: true,
  tasklists: true,
  tagfilter: true,
  autolinks: true,
  headingIds: true,
} as const;

function mdToHtml(md: string): string {
  try {
    return Bun.markdown.html(md, PORTAL_MARKDOWN_PARSER);
  } catch {
    try {
      return Bun.markdown.html(md);
    } catch {
      return `<pre>${escapeHtml(md)}</pre>`;
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function resourcesSummary(d: SkillDetail): string {
  const { scripts, references, assets } = d.resources;
  if (!scripts && !references && !assets) return '—';
  return `${scripts}s · ${references}r · ${assets}a`;
}

function validationBlock(d: SkillDetail): string {
  if (!d.validation.length) return '<p class="skill-ok">✓ passes skill-creator checks</p>';
  const items = d.validation.map(w => `<li>⚠ ${escapeHtml(w)}</li>`).join('');
  return `<ul class="skill-warnings">${items}</ul>`;
}

function filesTable(d: SkillDetail): string {
  if (!d.files.length) return '<p class="skill-dim">No files found.</p>';
  const rows = d.files
    .map(
      f =>
        `<tr><td class="mono">${escapeHtml(f.path)}</td><td class="mono bytes">${fmtBytes(f.bytes)}</td></tr>`
    )
    .join('');
  return `<table class="skill-files"><thead><tr><th>File</th><th>Bytes</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function pageShell(title: string, main: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)} · FactoryWager</title>
  <link rel="stylesheet" href="/portal/style.css"/>
  <style>
    .skill-detail { max-width: 960px; margin: 0 auto; padding: 24px; }
    .skill-head { background: var(--surface, #161b22); border: 1px solid var(--border, #30363d); border-radius: 8px; padding: 20px; margin-bottom: 24px; }
    .skill-head h1 { margin: 0 0 8px; font-size: 24px; font-family: 'JetBrains Mono', monospace; }
    .skill-head .desc { color: var(--text-dim, #8b949e); margin: 0 0 12px; }
    .skill-meta { display: flex; flex-wrap: wrap; gap: 16px; font-size: 13px; color: var(--text-dim, #8b949e); }
    .skill-meta b { color: var(--text, #e6edf3); font-weight: 600; }
    .skill-warnings { background: rgba(210,153,34,.12); border: 1px solid rgba(210,153,34,.4); border-radius: 6px; padding: 12px 12px 12px 32px; margin: 0 0 24px; font-size: 13px; }
    .skill-ok { color: #3fb950; font-size: 13px; margin: 0 0 24px; }
    .skill-files { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px; }
    .skill-files th, .skill-files td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border, #30363d); }
    .skill-files th { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--text-dim, #8b949e); }
    .mono { font-family: 'JetBrains Mono', monospace; }
    .bytes { color: var(--text-dim, #8b949e); }
    .skill-dim { color: var(--text-dim, #8b949e); font-size: 13px; }
    .skill-body { line-height: 1.6; }
    .skill-body img { max-width: 100%; }
    .pkg-section { background: var(--surface, #161b22); border: 1px solid var(--border, #30363d); border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; }
    .pkg-section h2 { margin: 0 0 8px; font-size: 16px; }
    .pkg-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .pkg-row input { padding: 6px 10px; border: 1px solid var(--border, #30363d); border-radius: 4px; background: var(--bg, #0d1117); color: var(--text, #e6edf3); font-size: 13px; width: 260px; }
    .pkg-row button { padding: 6px 14px; border-radius: 4px; border: 1px solid var(--accent, #58a6ff); background: transparent; color: var(--accent, #58a6ff); cursor: pointer; font-size: 13px; }
    .pkg-row button:hover { background: var(--accent-glow, rgba(88,166,255,.12)); }
    .pkg-result { margin-top: 10px; font-size: 13px; }
    .pkg-link { font-size: 13px; padding: 3px 10px; border-radius: 4px; border: 1px solid var(--accent, #58a6ff); color: var(--accent, #58a6ff); text-decoration: none; }
  </style>
</head>
<body class="portal-md">
  <nav><a href="/portal/">Portal</a> · <a href="/portal/skills">Skills</a></nav>
  <main class="skill-detail">${main}</main>
</body>
</html>`;
}

/** Full detail page for one skill (caller has already null-checked). */
export function renderSkillDetailPage(d: SkillDetail, hasPackage: boolean): string {
  const pkgLink = hasPackage
    ? `<a class="pkg-link" href="/skills/${encodeURIComponent(d.name)}.skill">.skill ↓</a>`
    : '';
  const head = `<section class="skill-head">
  <h1>${escapeHtml(d.name)}</h1>
  <p class="desc">${escapeHtml(d.description) || '—'}</p>
  <div class="skill-meta">
    <span>updated <b>${escapeHtml(d.updatedAt.slice(0, 10))}</b></span>
    <span>lines <b>${d.lineCount}</b></span>
    <span>resources <b>${resourcesSummary(d)}</b></span>
    <span>files <b>${d.files.length}</b></span>
    ${pkgLink}
  </div>
</section>`;

  const pkgSection = `<section class="pkg-section">
  <h2>Package</h2>
  <div class="pkg-row">
    <input id="pkg-token" type="password" placeholder="Publish token (Bearer)" autocomplete="off"/>
    <button id="pkg-btn" type="button">Package ${escapeHtml(d.name)}.skill</button>
  </div>
  <div id="pkg-result" class="pkg-result"></div>
</section>
<script>
  const btn = document.getElementById('pkg-btn');
  const out = document.getElementById('pkg-result');
  btn.addEventListener('click', async () => {
    const token = document.getElementById('pkg-token').value.trim();
    out.textContent = 'Packaging…';
    try {
      const res = await fetch('/api/skills/${encodeURIComponent(d.name)}/package', {
        method: 'POST',
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      out.innerHTML = '✓ <span class="mono">' + data.name + '.skill</span> · ' +
        data.bytes + ' bytes · sha256 <span class="mono">' + data.sha256.slice(0, 16) + '…</span>' +
        ' · <a class="pkg-link" href="/skills/${encodeURIComponent(d.name)}.skill">download</a>';
    } catch (err) {
      out.textContent = '⚠ ' + (err && err.message ? err.message : String(err));
    }
  });
</script>`;

  const main = `${head}
${validationBlock(d)}
${pkgSection}
<h2>Files</h2>
${filesTable(d)}
<h2>SKILL.md</h2>
<div class="skill-body">${mdToHtml(d.bodyMarkdown)}</div>`;
  return pageShell(`${d.name} · Skills`, main);
}

/** 404 page for unknown/invalid skill names. */
export function renderSkillNotFoundPage(name: string): string {
  return pageShell(
    'Skill not found',
    `<section class="skill-head"><h1>Not found</h1>
<p class="desc">No skill named <span class="mono">${escapeHtml(name)}</span>. <a href="/portal/skills">Back to Skills</a></p></section>`
  );
}
