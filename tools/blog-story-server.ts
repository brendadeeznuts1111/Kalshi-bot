#!/usr/bin/env bun
/**
 * blog:story — serve the Bun 1.4 release blog as a living story page.
 *
 * Bun-native, zero npm deps. Reads the cached blog HTML (research/cache/
 * bun-blog.html — same bytes the repo's blog:codeblocks-check consumes),
 * parses the RENDERED article in document order (headings, paragraphs,
 * code blocks, tables, images, videos, benchmark details), pairs every
 * shiki code block 1:1 with the blog:codeblocks-check ledger
 * (research/outputs/blog-codeblocks-check.json — PASS/PARTIAL/FAIL/SKIP
 * per block from the repo's strict bun-types typecheck), and serves:
 *
 *   GET /            the story page (dark theme, TOC, all code blocks)
 *   GET /api/story   JSON story model (sections + blocks)
 *   GET /api/blocks  every code block with ledger status
 *   POST /api/run    execute a ts/js block via `bun -e` (timeout, /tmp cwd)
 *
 * Flags: --port=<n> (default 3456)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const HTML_PATH = join(ROOT, 'research/cache/bun-blog.html');
const LEDGER_PATH = join(ROOT, 'research/outputs/blog-codeblocks-check.json');

const flags = Bun.argv.slice(2);
const port = Number((flags.find((f) => f.startsWith('--port=')) ?? '').slice('--port='.length) || Bun.env.PORT || 3456);

// ---------------------------------------------------------------- data load
const html = readFileSync(HTML_PATH, 'utf8');

function loadPayload(): any {
  const m = html.match(/<script[^>]*id="__bun_data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('__bun_data payload not found in ' + HTML_PATH);
  return JSON.parse(m[1]!);
}
const payload = loadPayload();
const meta = payload.meta ?? {};

type AstNode = { $$mdtype?: string; name?: string; attributes?: Record<string, any>; children?: any[] };

/** Walk the RSC AST: clean heading titles (text + inline Code, no badges/anchors). */
function buildHeadingMap(): Map<string, { level: number; title: string; since: Array<{ verb: string; version: string }> }> {
  const map = new Map<string, { level: number; title: string; since: Array<{ verb: string; version: string }> }>();
  const textOf = (n: any): string => {
    if (typeof n === 'string') return n;
    if (!n || n["$$mdtype"] !== 'Tag') return '';
    const name = n.name;
    if (name === 'Since' || name === 'a' || name === 'span') return '';
    return (n.children ?? []).map(textOf).join('');
  };
  const walk = (n: any) => {
    if (!n || n["$$mdtype"] !== 'Tag') return;
    const name = n.name ?? '';
    if (name === 'h2' || name === 'h3' || name === 'h4') {
      const id = n.attributes?.id ?? '';
      const since: Array<{ verb: string; version: string }> = [];
      for (const c of n.children ?? []) {
        if (c && c["$$mdtype"] === 'Tag' && c.name === 'Since') {
          const a = c.attributes ?? {};
          since.push({ verb: a.improved ? 'Improved' : 'Shipped', version: a.improved ?? a.version ?? '' });
        }
      }
      if (id) map.set(id, { level: Number(n.attributes?.level ?? name[1]), title: (n.children ?? []).map(textOf).join('').trim(), since });
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(payload.tree);
  return map;
}
const headingMap = buildHeadingMap();

function loadPreBlocks(): string[] {
  const out: string[] = [];
  const re = /<pre[^>]*class="shiki">([\s\S]*?)<\/pre>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]!);
  return out;
}
const preBlocks = loadPreBlocks();

function loadLedger(): Map<number, any> {
  const map = new Map<number, any>();
  if (!existsSync(LEDGER_PATH)) return map;
  try {
    const data = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
    for (const row of data.rows ?? []) map.set(row.n, row);
  } catch {
    /* ledger absent/stale — run blog:codeblocks-check first */
  }
  return map;
}
const ledger = loadLedger();

// ------------------------------------------------------------- html helpers
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function preText(inner: string): string {
  return inner
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function tokenCss(): string {
  const colors = new Set<string>();
  for (const p of preBlocks) for (const mm of p.matchAll(/class="(s-[a-f0-9]{6})"/g)) colors.add(mm[1]!);
  let css = '';
  for (const c of colors) css += '.' + c + '{color:#' + c.slice(2) + '}\n';
  return css;
}
const TOKEN_CSS = tokenCss();

// ------------------------------------------------------------------- parsing
type Item =
  | { t: 'heading'; level: number; id: string; title: string; since: Array<{ verb: string; version: string }> }
  | { t: 'p'; html: string }
  | { t: 'code'; idx: number; html: string; code: string; tab?: string }
  | { t: 'tabs'; tabs: Array<{ label: string; idx: number; html: string; code: string }> }
  | { t: 'img'; src: string; alt: string; width?: string; height?: string; caption?: string; href?: string }
  | { t: 'video'; poster: string; label: string }
  | { t: 'embed'; html: string }
  | { t: 'table'; html: string }
  | { t: 'details'; summary: string; items: Item[] }
  | { t: 'callout'; html: string };

function articleRegion(): string {
  const start = html.indexOf('<h1 class="display');
  if (start === -1) throw new Error('h1 not found');
  const end = html.indexOf('/blog/bun-v1.3.14"', start + 1);
  const last = html.lastIndexOf('</main>');
  const stop = Math.min(end === -1 ? Infinity : end, last === -1 ? Infinity : last);
  return html.slice(start, stop);
}
const article = articleRegion();

/** Tag-name stack walker over the article: yields each element with inner region. */
function* tags(src: string): Generator<{ name: string; attrs: Record<string, string>; inner: string; pos: number }> {
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^<>]*?)?)(\/?)>/g;
  let m: RegExpExecArray | null;
  const stack: Array<{ name: string; attrs: Record<string, string>; start: number }> = [];
  while ((m = re.exec(src)) !== null) {
    const rawName = m[1]!;
    const attrsRaw = m[2] ?? '';
    const selfClose = m[3] === '/';
    const name = rawName.toLowerCase();
    if (selfClose || name === 'br' || name === 'hr' || name === 'img' || name === 'input') {
      const attrs: Record<string, string> = {};
      for (const am of attrsRaw.matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g)) {
        if (am[1]) attrs[am[1]!.toLowerCase()] = am[2] ?? '';
      }
      yield { name, attrs, inner: '', pos: m.index };
      continue;
    }
    const closing = m[0].startsWith('</');
    if (closing) {
      const top = stack.pop();
      if (top && top.name === name) {
        yield { name, attrs: top.attrs, inner: src.slice(top.start, m.index), pos: top.start };
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const am of attrsRaw.matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g)) {
      if (am[1]) attrs[am[1]!.toLowerCase()] = am[2] ?? '';
    }
    stack.push({ name, attrs, start: m.index + m[0].length });
  }
}

function parseSince(inner: string): Array<{ verb: string; version: string }> {
  const out: Array<{ verb: string; version: string }> = [];
  for (const sm of inner.matchAll(/title="(Shipped|Improved) in Bun v([\d.]+)"/g)) {
    out.push({ verb: sm[1]!, version: sm[2]! });
  }
  return out;
}

function parseStory(): { items: Item[] } {
  const items: Item[] = [];
  let preCounter = 0;
  for (const t of tags(article)) {
    const { name, attrs, inner } = t;
    switch (name) {
      case 'h2':
      case 'h3':
      case 'h4': {
        const id = attrs.id ?? '';
        const ast = headingMap.get(id);
        const level = Number(name[1]); // HTML tag is authoritative (duplicate ids exist in the blog)
        const title = ast?.title ?? inner.replace(/<[^>]+>/g, '').replace(/#$/, '').trim();
        items.push({ t: 'heading', level, id, title, since: ast?.since ?? parseSince(inner) });
        break;
      }
      case 'p': {
        const htmlText = inner.replace(/<[^>]+>/g, '').trim();
        if (htmlText === '') break;
        if (inner.includes('<img')) break;
        if (['curl', 'powershell', 'npm', 'brew', 'docker'].includes(htmlText.toLowerCase())) break; // CodeBlockTab labels
        items.push({ t: 'p', html: inner.trim() });
        break;
      }
      case 'pre': {
        if ((attrs.class ?? '').includes('shiki')) {
          const code = preText(inner);
          items.push({ t: 'code', idx: preCounter, html: inner.trim(), code });
          preCounter++;
        }
        break;
      }
      case 'img': {
        const img: Item = { t: 'img', src: attrs.src ?? '', alt: attrs.alt ?? '' };
        if (attrs.width) img.width = attrs.width;
        if (attrs.height) img.height = attrs.height;
        items.push(img);
        break;
      }
      case 'video': {
        if (attrs.poster) items.push({ t: 'video', poster: attrs.poster!, label: attrs['aria-label'] ?? '' });
        break;
      }
      case 'iframe': {
        const a = Object.entries(t.attrs)
          .map(([k, v]) => (v === '' ? k : k + '="' + v.replace(/"/g, '&quot;') + '"'))
          .join(' ');
        items.push({ t: 'embed', html: '<iframe ' + a + '></iframe>' });
        break;
      }
      case 'table': {
        items.push({ t: 'table', html: inner });
        break;
      }
      case 'details': {
        const sm = inner.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
        const summary = sm ? sm[1]!.replace(/<[^>]+>/g, '').trim() : 'Details';
        items.push({ t: 'details', summary, items: [] });
        break;
      }
      default:
        break;
    }
  }
  return { items };
}

const { items: storyItems } = parseStory();

// ------------------------------------------------------------- ledger status
function ledgerStatus(idx: number): { status: string; kind: string; label: string; errors: string[]; claims: string } {
  const row = ledger.get(idx);
  if (!row) return { status: 'UNVERIFIED', kind: '', label: '', errors: [], claims: '' };
  return {
    status: row.status ?? 'UNVERIFIED',
    kind: row.kind ?? '',
    label: row.label ?? '',
    errors: row.errors ?? [],
    claims: row.claims ?? '',
  };
}

// --------------------------------------------------------------------- page
function renderStoryPage(): string {
  const count = { pass: 0, partial: 0, fail: 0, skip: 0 };
  for (let i = 0; i < preBlocks.length; i++) {
    const st = ledgerStatus(i).status;
    if (st === 'PASS') count.pass++;
    else if (st === 'PARTIAL') count.partial++;
    else if (st === 'FAIL') count.fail++;
    else count.skip++;
  }
  const authors = (meta.authors ?? []).map((a: any) => a.name).join(', ');
  const toc: Array<{ level: number; id: string; title: string }> = [];
  for (const it of storyItems) if (it.t === 'heading') toc.push({ level: it.level, id: it.id, title: it.title });

  const renderItem = (it: Item): string => {
    switch (it.t) {
      case 'heading': {
        const badges = it.since
          .map((s) => '<span class="badge' + (s.verb === 'Improved' ? ' improved' : '') + '" title="' + esc(s.verb + ' in Bun v' + s.version) + '">' + (s.verb === 'Improved' ? 'Improved · ' : 'v') + s.version + '</span>')
          .join('');
        const anchor = it.id ? '<a class="anchor" href="#' + esc(it.id) + '" aria-label="Permalink">#</a>' : '';
        return '<h' + it.level + ' id="' + esc(it.id) + '" class="story-h' + it.level + '">' + esc(it.title) + badges + anchor + '</h' + it.level + '>';
      }
      case 'p':
        return '<p>' + it.html + '</p>';
      case 'code': {
        const st = ledgerStatus(it.idx);
        const statusCls = st.status === 'PASS' ? 'ok' : st.status === 'PARTIAL' ? 'warn' : st.status === 'FAIL' ? 'bad' : 'skip';
        const runnable = st.kind === 'ts' || st.kind === 'js';
        return (
          '<div class="codeblock" data-idx="' + it.idx + '">' +
          '<div class="cb-head"><span class="cb-lang">' + esc(st.kind || 'code') + '</span>' +
          '<span class="cb-status ' + statusCls + '" title="' + esc(st.errors.join(', ')) + '">' + esc(st.status) + '</span>' +
          (runnable ? '<button class="cb-run" data-idx="' + it.idx + '">run</button>' : '') +
          '<button class="cb-copy" data-idx="' + it.idx + '">copy</button></div>' +
          '<pre class="shiki"><code>' + it.html + '</code></pre>' +
          '<div class="cb-out" hidden></div></div>'
        );
      }
      case 'tabs':
        return '<div class="tabs">' + it.tabs.map((tb, i) => '<div class="tab' + (i === 0 ? ' active' : '') + '"><button class="tab-btn">' + esc(tb.label) + '</button><pre class="shiki"><code>' + tb.html + '</code></pre></div>').join('') + '</div>';
      case 'img': {
        const cap = it.caption ? '<figcaption>' + esc(it.caption) + '</figcaption>' : '';
        return '<figure class="story-img"><img loading="lazy" src="' + esc(it.src) + '" alt="' + esc(it.alt) + '"' + (it.width ? ' width="' + esc(it.width) + '"' : '') + (it.height ? ' height="' + esc(it.height) + '"' : '') + '/>' + cap + '</figure>';
      }
      case 'video':
        return '<video class="story-video" preload="none" poster="' + esc(it.poster) + '" muted loop playsinline controls aria-label="' + esc(it.label) + '"></video>';
      case 'embed':
        return '<div class="story-embed">' + it.html + '</div>';
      case 'table':
        return '<div class="story-table"><table>' + it.html + '</table></div>';
      case 'details':
        return '<details class="story-details"><summary>' + esc(it.summary) + '</summary><div class="details-body"></div></details>';
      case 'callout':
        return '<div class="story-callout">' + it.html + '</div>';
      default:
        return '';
    }
  };

  const main = storyItems.map((it) => renderItem(it)).join('\n');
  const sidebarNav = toc.map((t) => '<a class="l' + t.level + '" href="#' + esc(t.id) + '">' + esc(t.title) + '</a>').join('');

  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Bun 1.4 — the release story</title><style>'
    + STYLE + '</style>' + (TOKEN_CSS ? '<style>' + TOKEN_CSS + '</style>' : '')
    + '</head><body><div class="layout"><aside class="side">'
    + '<h1>Bun 1.4</h1><p class="sub">the release story · ' + esc(meta.dateShort ?? meta.date ?? '') + '</p>'
    + '<div class="stats"><div class="ledger">'
    + '<span style="color:var(--ok)">' + count.pass + ' pass</span>'
    + '<span style="color:var(--warn)">' + count.partial + ' partial</span>'
    + '<span style="color:var(--bad)">' + count.fail + ' fail</span>'
    + '<span style="color:var(--fg-faint)">' + count.skip + ' skip</span>'
    + '</div><div>' + preBlocks.length + ' code blocks · ' + toc.filter((t) => t.level === 2).length + ' sections · ' + (meta.year ?? '') + '</div>'
    + '<div>typechecked against bun-types 1.4.0 (repo strict tsconfig)</div></div>'
    + '<button class="theme-toggle" id="themeToggle" type="button" aria-label="Toggle light/dark theme">◐ theme: <span id="themeLabel">system</span></button><nav>' + sidebarNav + '</nav></aside><main>'
    + '<div class="hero"><h1>' + esc(meta.title ?? 'Bun 1.4') + '</h1>'
    + '<div class="meta">' + esc(meta.date ?? '') + ' · ' + esc(authors) + '</div>'
    + '<div class="desc">' + esc(meta.description ?? '') + '</div></div>'
    + main
    + '<div class="footer">Story served natively by Bun · data: research/cache/bun-blog.html + research/outputs/blog-codeblocks-check.json · ' + preBlocks.length + ' shiki blocks · run: <code>bun tools/blog-story-server.ts</code></div>'
    + '</main></div>'
    + '<script>' + CLIENT_JS + '</script></body></html>';
}

const STYLE = `
/* ---- design tokens: real bun.com values (verified from site-a42cfdb2.css) ----
 * RGB triplets in --c-* custom properties; derived semantic vars consume them.
 * Theme strategy mirrors the blog: :root = light, @media prefers-color-scheme
 * = OS default, .dark / .light classes = manual override (localStorage).
 * Code blocks stay Dracula-dark in both themes (matching the shiki tokens). */
:root{--c-canvas:255 255 255;--c-fg:10 10 10;--c-fg-muted:82 82 82;--c-fg-faint:112 112 112;--c-accent:255 31 143;--c-accent-strong:214 0 102;--c-accent-soft:255 235 245;--c-line:226 226 226;--c-line-strong:10 10 10;--c-surface:255 255 255;--c-code-bg:246 246 246;--c-code-fg:10 10 10;--c-ok:0 145 80;--c-warn:194 120 3;--c-bad:214 31 45;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not(.light){--c-canvas:13 10 12;--c-fg:234 234 232;--c-fg-muted:168 168 165;--c-fg-faint:128 128 126;--c-accent:255 46 151;--c-accent-strong:255 92 176;--c-accent-soft:40 0 22;--c-line:40 40 43;--c-line-strong:72 72 76;--c-surface:13 10 12;--c-code-bg:14 14 14;--c-code-fg:240 240 240;--c-ok:40 220 130;--c-warn:245 180 60;--c-bad:255 90 90;color-scheme:dark}}
.dark{--c-canvas:13 10 12;--c-fg:234 234 232;--c-fg-muted:168 168 165;--c-fg-faint:128 128 126;--c-accent:255 46 151;--c-accent-strong:255 92 176;--c-accent-soft:40 0 22;--c-line:40 40 43;--c-line-strong:72 72 76;--c-surface:13 10 12;--c-code-bg:14 14 14;--c-code-fg:240 240 240;--c-ok:40 220 130;--c-warn:245 180 60;--c-bad:255 90 90;color-scheme:dark}
.light{--c-canvas:255 255 255;--c-fg:10 10 10;--c-fg-muted:82 82 82;--c-fg-faint:112 112 112;--c-accent:255 31 143;--c-accent-strong:214 0 102;--c-accent-soft:255 235 245;--c-line:226 226 226;--c-line-strong:10 10 10;--c-surface:255 255 255;--c-code-bg:246 246 246;--c-code-fg:10 10 10;--c-ok:0 145 80;--c-warn:194 120 3;--c-bad:214 31 45;color-scheme:light}
/* derived semantic vars (consumed by all existing selectors) */
:root{--canvas:rgb(var(--c-canvas));--surface:rgb(var(--c-surface));--line:rgb(var(--c-line));--line-strong:rgb(var(--c-line-strong));--fg:rgb(var(--c-fg));--fg-muted:rgb(var(--c-fg-muted));--fg-faint:rgb(var(--c-fg-faint));--accent:rgb(var(--c-accent));--accent-strong:rgb(var(--c-accent-strong));--accent-soft:rgb(var(--c-accent-soft));--ok:rgb(var(--c-ok));--warn:rgb(var(--c-warn));--bad:rgb(var(--c-bad));--code-bg:#0e0e0e;--code-fg:#f0f0f0;--mono:"Martian Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--fg);font-family:var(--sans);line-height:1.5}
a{color:var(--accent-strong)}
.layout{display:grid;grid-template-columns:280px 1fr;min-height:100vh}
.side{position:sticky;top:0;height:100vh;overflow-y:auto;padding:20px 16px;border-right:1px solid var(--line);background:var(--surface)}
.side h1{font-family:var(--mono);font-size:15px;letter-spacing:-.02em;margin:0 0 2px}
.side .sub{color:var(--fg-muted);font-size:12px;margin:0 0 14px}
.side .stats{font-size:11px;color:var(--fg-faint);border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:14px;line-height:1.6}
.side nav a{display:block;color:var(--fg-muted);text-decoration:none;font-size:12.5px;padding:3px 0 3px 10px;border-left:2px solid transparent}
.side nav a:hover{color:var(--fg)}
.side nav a.l2{border-left-color:var(--accent)}
.side nav a.l3{padding-left:20px;font-size:12px}
.side nav a.l4{padding-left:30px;font-size:11.5px;color:var(--fg-faint)}
main{padding:32px 40px 80px;max-width:880px}
.hero{margin-bottom:28px;border-bottom:1px solid var(--line);padding-bottom:20px}
.hero h1{font-size:clamp(2rem,5vw,3rem);font-weight:800;letter-spacing:-.02em;margin:0;font-family:var(--mono)}
.hero .meta{color:var(--fg-muted);font-size:13px;margin-top:8px}
.hero .desc{color:var(--fg-muted);font-size:14px;margin-top:10px}
.story-h2{margin-top:1.8em;margin-bottom:.7em;padding-bottom:.3em;border-bottom:1px solid var(--line);font-size:1.75em;letter-spacing:-.01em;scroll-margin-top:16px}
.story-h3{border-top:1px solid var(--line);margin-top:2.2em;margin-bottom:.6em;padding-top:1.1em;font-size:1.3em;letter-spacing:-.01em;scroll-margin-top:16px}
.story-h4{margin-top:2.4em;margin-bottom:.5em;font-size:1.25em;font-weight:650;letter-spacing:-.01em;scroll-margin-top:16px}
.badge{display:inline-block;vertical-align:middle;margin-left:8px;font-size:11px;font-weight:500;border:1px solid var(--accent);background:var(--accent-soft);color:var(--accent-strong);border-radius:999px;padding:2px 9px;font-family:var(--mono)}
.badge.improved{border-color:var(--line);background:transparent;color:var(--fg-faint)}
.anchor{color:var(--fg-faint);text-decoration:none;opacity:0;margin-left:.35em}
.story-h2:hover .anchor,.story-h3:hover .anchor,.story-h4:hover .anchor{opacity:1}
p{font-size:15px;color:var(--fg);margin:1em 0}
p code{background:rgba(234,234,232,.08);border-radius:4px;padding:0 .3em;font-family:var(--mono);font-size:.86em}
.codeblock{margin:1.2em 0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--code-bg)}
.cb-head{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--line);font-size:11px;font-family:var(--mono)}
.cb-lang{color:var(--fg-muted);text-transform:uppercase;letter-spacing:.08em;font-size:10px}
.cb-status{margin-left:auto;padding:1px 8px;border-radius:999px;font-size:10px}
.cb-status.ok{background:rgba(40,220,130,.15);color:var(--ok)}
.cb-status.warn{color:var(--warn);background:rgba(245,180,60,.12)}
.cb-status.bad{color:var(--bad);background:rgba(255,90,90,.12)}
.cb-status.skip{color:var(--fg-faint);background:rgba(128,128,126,.12)}
button.cb-copy,button.cb-run{background:transparent;border:1px solid var(--line-strong);color:var(--fg-muted);border-radius:5px;font-size:10px;font-family:var(--mono);padding:2px 8px;cursor:pointer}
button.cb-run{color:var(--ok);border-color:rgba(40,220,130,.4)}
button:hover{color:var(--fg)}
pre.shiki{overflow-x:auto;padding:12px 14px;margin:0;font-family:var(--mono);font-size:13px;line-height:1.6;color:var(--code-fg)}
.cb-out{border-top:1px solid var(--line);padding:8px 14px;font-family:var(--mono);font-size:12px;white-space:pre-wrap;color:var(--fg-muted);background:#0b0b0d}
.cb-out.err{color:var(--bad)}
.story-img{display:block;margin:1.4em auto;text-align:center}
.story-img img{max-width:100%;border-radius:6px}
.story-img figcaption{font-size:12px;color:var(--fg-faint);margin-top:6px}
.story-video{display:block;width:100%;max-width:640px;margin:1.4em auto;border-radius:6px}
.story-embed{margin:1.4em auto;max-width:640px}
.story-embed iframe{width:100%;aspect-ratio:16/9;border-radius:8px;border:0}
.story-table{overflow-x:auto;margin:1.2em 0}
.story-table table{border-collapse:collapse;font-size:13.5px;width:100%}
.story-table th,.story-table td{border-bottom:1px solid var(--line);padding:7px 10px;text-align:left}
.story-table thead th{color:var(--fg);font-weight:600}
.story-table code{font-family:var(--mono);font-size:.9em;background:rgba(234,234,232,.08);border-radius:4px;padding:0 .25em}
.story-details{margin:1.2em 0;border:1px solid var(--line);border-radius:8px;padding:0 14px}
.story-details summary{cursor:pointer;padding:10px 0;color:var(--fg-muted);font-size:13px}
.story-details .details-body{padding-bottom:12px}
.story-callout{border-left:3px solid var(--accent);background:var(--accent-soft);padding:12px 16px;border-radius:0 8px 8px 0;margin:1.4em 0;font-size:14px;color:var(--fg-muted)}
.footer{margin-top:3em;padding-top:1.4em;border-top:1px solid var(--line);color:var(--fg-faint);font-size:12px}
.ledger{display:flex;gap:14px;flex-wrap:wrap}
.ledger span{font-family:var(--mono)}
@media(max-width:900px){.layout{grid-template-columns:1fr}.side{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}}
.theme-toggle{display:inline-flex;align-items:center;gap:6px;margin-top:10px;background:transparent;border:1px solid var(--line-strong);color:var(--fg-muted);border-radius:999px;font-size:11px;font-family:var(--mono);padding:4px 12px;cursor:pointer}
.theme-toggle:hover{color:var(--fg);border-color:var(--accent)}
`;

const CLIENT_JS = `
const blocks = [...document.querySelectorAll('.codeblock')];
const CODE = Object.fromEntries(blocks.map((b) => [b.dataset.idx, b.querySelector('pre').innerText]));
document.querySelectorAll('.cb-copy').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const idx = btn.dataset.idx;
    await navigator.clipboard.writeText(CODE[idx]);
    btn.textContent = 'copied';
    setTimeout(() => (btn.textContent = 'copy'), 1200);
  });
});
document.querySelectorAll('.cb-run').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const idx = btn.dataset.idx;
    const out = document.querySelector('.codeblock[data-idx="' + idx + '"] .cb-out');
    out.hidden = false;
    out.textContent = 'running…';
    out.className = 'cb-out';
    btn.disabled = true;
    try {
      const r = await fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: CODE[idx] }) });
      const j = await r.json();
      out.textContent = j.ok ? (j.stdout || '(no output)') : (j.stderr || 'error');
      if (!j.ok) out.className = 'cb-out err';
    } catch (e) {
      out.textContent = 'failed: ' + e.message;
      out.className = 'cb-out err';
    } finally {
      btn.disabled = false;
    }
  });
});
// ---- theme engine: localStorage override with prefers-color-scheme default ----
(function () {
  const root = document.documentElement;
  const label = document.getElementById('themeLabel');
  const btn = document.getElementById('themeToggle');
  const stored = (() => { try { return localStorage.getItem('blog-story-theme'); } catch { return null; } })();
  const apply = (t) => {
    root.classList.toggle('dark', t === 'dark');
    root.classList.toggle('light', t === 'light');
    if (label) label.textContent = t || 'system';
  };
  apply(stored);
  if (btn) btn.addEventListener('click', () => {
    const cur = root.classList.contains('dark') ? 'dark' : root.classList.contains('light') ? 'light' : null;
    const next = cur === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('blog-story-theme', next); } catch { /* private mode */ }
    apply(next);
  });
})();
`;

// --------------------------------------------------------------------- server
async function runBlock(code: string): Promise<{ ok: boolean; stdout: string; stderr: string; exit: number; timedOut: boolean }> {
  const proc = Bun.spawn(['bun', '-e', code], { cwd: '/tmp', stdout: 'pipe', stderr: 'pipe', env: { ...Bun.env, BUN_ENV: 'production' } });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, 4000);
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  const exit = proc.exitCode ?? 0;
  return { ok: exit === 0 && !timedOut, stdout: stdout.slice(0, 8000), stderr: timedOut ? 'timed out after 4s' : stderr.slice(0, 8000), exit, timedOut };
}

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (path === '/health') return Response.json({ ok: true, blocks: preBlocks.length, port }, { headers: cors });
    if (path === '/api/story') {
      return Response.json(
        {
          slug: payload.slug,
          meta,
          previous: payload.previous,
          items: storyItems,
          preBlocks: preBlocks.length,
          toc: storyItems.filter((i) => i.t === 'heading').map((h) => ({ level: h.level, id: h.id, title: h.title })),
        },
        { headers: cors },
      );
    }
    if (path === '/api/blocks') {
      const blocks = preBlocks.map((inner, i) => ({ n: i, code: preText(inner), ...ledgerStatus(i) }));
      return Response.json({ total: blocks.length, blocks }, { headers: cors });
    }
    if (path === '/api/run' && req.method === 'POST') {
      const body: any = await req.json().catch(() => null);
      if (!body || typeof body.code !== 'string') return Response.json({ ok: false, stderr: 'missing code' }, { status: 400, headers: cors });
      const result = await runBlock(body.code);
      return Response.json(result, { headers: cors });
    }
    if (path === '/' || path === '') {
      return new Response(renderStoryPage(), { headers: { 'content-type': 'text/html; charset=utf-8', ...cors } });
    }
    return new Response('not found', { status: 404 });
  },
});

console.log('blog:story v2 — http://localhost:' + server.port + ' · ' + preBlocks.length + ' blocks · ' + storyItems.filter((i) => i.t === 'heading').length + ' headings · headingMap=' + headingMap.size);
