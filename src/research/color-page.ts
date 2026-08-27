/**
 * color-page.ts — /bun/color: the Unified Color Theme widget.
 *
 * One semantic theme (src/lib/color/theme.ts) -> terminal ANSI, web CSS
 * variables, and solid PNG swatches, zero dependencies. Every claim in the
 * marketing copy is probed against Bun 1.4.0; the page carries verified /
 * corrected / marketing badges. Token-built audited surface: all colors
 * rendered here are TOKENS values (or the palette onLight/onDark pick).
 */
import { renderWidgetPage, widgetTable, W_VERIFIED, W_CORRECTED, W_NOTE, W_MARKETING } from '../lib/widget-page.ts';
import {
  THEME,
  THEME_ROLES,
  accessibleForeground,
  contrastRatio,
  themeAnsi,
  themeCssVars,
  themeManifest,
  verdict,
  type ThemeRole,
} from '../lib/color/theme.ts';
import { convertColorFallback } from '../lib/color/kernel.ts';
import { markdownToHtmlAccent } from '../lib/markdown.ts';

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

/** Escape an ANSI sequence for display (\x1b -> literal, no raw control chars). */
const showAnsi = (s: string): string => esc(s.replace(/\x1b/g, '\\x1b'));

export function renderColorPage(): string {
  // ── Swatch grid: role chip with accessible foreground pick ──
  const swatches = THEME_ROLES.map((role) => {
    const hex = THEME[role];
    const fg = accessibleForeground(hex);
    return '<div style="display:inline-block;width:9.5%;min-width:96px;margin:0.35%;text-align:center;">' +
      '<div style="background:' + hex + ';color:' + fg + ';border-radius:8px;padding:0.55rem 0.25rem;font-family:var(--mono);font-size:0.72rem;">' +
      role + '<br/>' + hex + '</div></div>';
  }).join('');

  // ── Conversions table per role (verified formats only) ──
  const convRows = THEME_ROLES.map((role) => {
    const hex = THEME[role];
    const rgb = convertColorFallback(hex, '{rgb}');
    const rgbS = rgb && typeof rgb === 'object' ? rgb.r + ',' + rgb.g + ',' + rgb.b : '?';
    const css = convertColorFallback(hex, 'css');
    return {
      cells: [
        '<code>' + role + '</code>',
        '<code>' + hex + '</code>',
        '<code>' + esc(String(css)) + '</code>',
        '<code>rgb(' + rgbS + ')</code>',
        '<code>' + esc(String(convertColorFallback(hex, 'hsl'))) + '</code>',
        '<code>' + esc(String(convertColorFallback(hex, 'lab'))) + '</code>',
        '<code>' + esc(String(convertColorFallback(hex, 'lch'))) + '</code>',
        '<code>' + esc(String(convertColorFallback(hex, 'oklab'))) + '</code>',
        '<code>' + esc(String(convertColorFallback(hex, 'oklch'))) + '</code>',
        '<code>' + esc(String(convertColorFallback(hex, 'hsv'))) + '</code>',
        '<code>' + String(convertColorFallback(hex, 'number')) + '</code>',
        '<code>' + showAnsi(themeAnsi(role, '16m')) + '</code>',
      ],
    };
  });
  const conv = widgetTable(['Role', 'hex', 'css', 'rgb', 'hsl', 'lab', 'lch', 'oklab', 'oklch', 'hsv', 'number', 'ansi-16m'], convRows);

  // ── Contrast pairs with WCAG verdicts ──
  const contrastRows = themeManifest().contrast.map((c) => ({
    cells: [
      '<span style="color:' + c.fg + ';background:' + c.bg + ';padding:0.1rem 0.4rem;border-radius:4px;">Aa</span>',
      '<code>' + c.fg + '</code> on <code>' + c.bg + '</code>',
      c.ratio.toFixed(2) + ':1',
      '<span class="badge ' + (c.verdict === 'fail' ? 'bad' : 'ok') + '">' + c.verdict + '</span>',
    ],
  }));
  const contrastTbl = widgetTable(['Sample', 'Pair', 'Ratio', 'WCAG'], contrastRows);

  // ── Terminal preview (escaped ANSI) ──
  const termLine = (role: ThemeRole, label: string): string =>
    showAnsi(themeAnsi(role, '16m')) + label + '  \\x1b[0m  ' + THEME[role];
  const termPreview = '<pre>' + THEME_ROLES.map((r) => esc(termLine(r, r))).join('\n') + '</pre>';

  // ── Bun.color in the markdown renderer: palette-accent headings ──
  const accentMd = markdownToHtmlAccent(
    '# Palette headings\n\nHeadings are styled with THEME.accent (' + THEME.accent + ') via Bun.color(hex, "css") — the palette is the source of truth.\n\n- lab / lch / oklab / oklch / hsv are kernel-computed (Bun.color 1.4.0 supports lab only)',
    THEME.accent,
  );
  const accentDemo = '<section><h2>Bun.color in the markdown renderer</h2>' + accentMd + '</section>';
  // ── Advanced input formats (kernel-parses what Bun.color can't) ──
  const advancedInputHtml =
    '<p class="muted">Bun.color 1.4.0 parses hex / hwb / color-mix / lab / lch inputs (guide documents lab; lch shares the parser) — but returns null for oklab/oklch/hsv/device-cmyk. The kernel inverse parsers cover those (round-trip verified).</p>' +
    '<datalist id="color-suggestions">' +
    '<option value="lab(50% 50 50)" /><option value="lch(50% 50 100)" />' +
    '<option value="oklab(0.5 0.1 0.1)" /><option value="oklch(0.5 0.2 120)" />' +
    '<option value="hsv(200 80% 70%)" /><option value="hwb(200 10% 20%)" />' +
    '</datalist>' +
    '<input list="color-suggestions" id="advanced-input" placeholder="e.g. lab(50% 50 50)" ' +
    'style="font-family:var(--mono);background:var(--panel2);border:1px solid var(--line);color:var(--fg);border-radius:6px;padding:0.3rem 0.5rem;min-width:220px" /> ' +
    '<button id="apply-advanced" type="button" style="padding:0.3rem 0.8rem;background:var(--acc);color:var(--on-accent);border:none;border-radius:6px;font-weight:600;cursor:pointer">Apply</button>' +
    '<div id="advanced-result" style="margin-top:0.5rem;font-family:var(--mono);background:var(--panel2);border:1px solid var(--line);padding:0.5rem;border-radius:6px;font-size:0.82rem"></div>' +
    '<script>' +
    'document.getElementById("apply-advanced").addEventListener("click", function () {' +
    '  var val = document.getElementById("advanced-input").value.trim();' +
    '  var out = document.getElementById("advanced-result");' +
    '  if (!val) { out.textContent = "enter a color"; return; }' +
    '  fetch("/api/color-info?color=" + encodeURIComponent(val)).then(function (r) { return r.json(); }).then(function (d) {' +
    '    if (!d.ok) { out.textContent = "invalid color: " + val; return; }' +
    '    out.innerHTML = "hex " + d.hex + " · rgb(" + d.rgb.join(", ") + ") · " + d.hsl + " · parsed by " + d.parser;' +
    '  }).catch(function () { out.textContent = "request failed"; });' +
    '});' +
    '</scr' + 'ipt>';

  // ── cssVars block ──
  const cssVars = '<pre>:root {\n' + esc(themeCssVars()) + '\n}</pre>';

  const probeRows = [
    { cells: ['<code>color-mix(in srgb, red 50%, blue)</code> input', W_VERIFIED + ' parses to #800080'] },
    { cells: ['<code>hwb(0 0% 0%)</code> input', W_VERIFIED + ' parses to #ff0000'] },
    { cells: ['<code>hsl()</code> / <code>rgba()</code> / <code>lab</code> outputs', W_VERIFIED + ' byte-parity with the JS kernel (parity tests)'] },
    { cells: ['<code>lab()</code> / <code>lch()</code> inputs', W_VERIFIED + ' parse natively (guide input list documents lab; lch shares the parser — parity-tested vs kernel)'] },
    { cells: ['<code>oklab()</code> / <code>oklch()</code> / <code>hsv()</code> / <code>device-cmyk()</code> inputs', W_CORRECTED + ' return null — kernel inverse parsers cover oklab/oklch/hsv (hwb/color-mix stay Bun-native)'] },
    { cells: ['<code>FORCE_COLOR=1|2|3</code>', W_VERIFIED + ' forces 16 / 256 / 24-bit even when piped'] },
    { cells: ['<code>NO_COLOR</code>', W_VERIFIED + ' silences auto "ansi" only — explicit ansi-256/16m still emit'] },
    { cells: ['"ansi" auto-picks depth from env vars', W_VERIFIED + ' ENV-driven, not TTY-driven: NO_COLOR silences; FORCE_COLOR 1|2|3 → 16/256/16m (overrides TERM=dumb); TERM picks depth even piped (xterm→16, xterm-256color→256, dumb→""); COLORTERM=truecolor→16m; RGB-array input accepted — §235, styledRGB (terminal.ts)'] },
    { cells: ['<code>Bun.color(…, "luminance")</code>', W_CORRECTED + ' does not exist — WCAG luminance computed in-kernel (theme.ts)'] },
    { cells: ['"object" / "array" output formats', W_CORRECTED + ' real names: {rgb} / {rgba} / [rgb] / [rgba]'] },
    { cells: ['color-space keyword as 2nd arg (display-p3)', W_CORRECTED + ' 2nd arg is an output format only; p3/srgb rejected'] },

    { cells: ['<code>hex</code> output keeps alpha', W_CORRECTED + ' drops it: #ff0000aa -> #ff0000; transparent -> #000000'] },
    { cells: ['markdown.ansi(…, { heading/render }) theme callbacks', W_CORRECTED + ' options ignored in 1.4.0 — outputs are fixed'] },
    { cells: ['ImageData + new Image(imageData) pixel pipeline', W_CORRECTED + ' ImageData is not a global — solid PNGs via hand-rolled encoder'] },
    { cells: ['lch / oklab / oklch / hsv outputs', W_NOTE + ' kernel-computed — Bun.color 1.4.0 format list has lab but NOT these (verified); shapes are kernel-defined'] },
    { cells: ['~100 ns per parse', W_MARKETING + ' measured (bun run bench:feature, Apple M4): kernel formats 337-385 ns/op · inverse parsers 207-278 ns/op · native Bun.color lab 664 ns/op — kernel is native-fast, no allocs in JS (evidence: tools/feature-bench-evidence.json)'] },
  ];
  const probes = widgetTable(['Claim', 'Probe status'], probeRows);

  const pngProof = THEME_ROLES.map((role) => {
    const hex = THEME[role];
    return '<a href="/brand/swatch/' + role + '.png?size=48" title="' + hex + '">' +
      '<img src="/brand/swatch/' + role + '.png?size=48" width="48" height="48" alt="' + role + ' swatch" style="border-radius:6px;margin:0.2rem;border:1px solid var(--line);"/></a>';
  }).join('');

  return renderWidgetPage({
    title: 'Unified Color Theme',
    subtitle: 'One semantic theme -> terminal ANSI · web CSS vars · PNG swatches — zero dependencies, probe-verified against Bun ' + Bun.version,
    badges: ['12 roles', 'TOKENS-backed', 'WCAG contrast', 'zero deps'],
    links: ['/bun/overview', '/bun/networking', '/design', '/api/color/theme'],
    sections: [
      { heading: 'Markdown accent', html: accentDemo },
      { heading: 'Advanced input formats', html: advancedInputHtml },

      { heading: 'Theme swatches (one vocabulary)', html: '<div>' + swatches + '</div><p class="muted">Every hex is a TOKENS value — the design agent audit passes by construction. Text color is the WCAG contrast pick (black/white).</p>' },
      { heading: 'Conversions (probe-verified formats)', html: conv },
      { heading: 'Contrast pairs (WCAG 2.1)', html: contrastTbl + '<p class="muted">Ratios computed in-kernel — Bun has no luminance format (corrected claim).</p>' },
      { heading: 'Terminal preview (ansi-16m)', html: termPreview + '<p class="muted">Escape sequences shown literally — paste into a terminal to see color.</p>' },
      { heading: 'Web: CSS variables', html: cssVars + '<p class="muted">Consumed by the hq-app live bundle via /api/design; served to any origin via design CORS.</p>' },
      { heading: 'Image: solid swatch PNGs', html: pngProof + '<p class="muted">Generated by the repo hand-rolled PNG encoder (encodeSolidColorPng) — no ImageData global needed (corrected claim).</p>' },
      { heading: 'Claim probe table', html: probes },
    ],
    footer: 'Probes: docs/AGENT-PITFALLS.md §22 · theme module: src/lib/color/theme.ts · endpoint: /api/color/theme',
  });
}
