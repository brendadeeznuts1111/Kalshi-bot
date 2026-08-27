/**
 * Bun.markdown helpers — preset sugar over the native API.
 *
 * Options are typed with the native Bun.markdown.Options type (no duplicated
 * declaration). The only added value here is named presets + defaults:
 * callers pass a preset name (docs | dashboard | strict | gfm) or a raw
 * Bun.markdown.Options object.
 *
 * ## Bun native defaults (verified 2026-08-22 against Bun 1.4.0)
 *
 * ON by default: tables, strikethrough, tasklists.
 * OFF by default (opt-in): autolinks, headings, hardSoftBreaks, wikiLinks,
 * underline, latexMath, collapseWhitespace, permissiveAtxHeaders,
 * noIndentedCodeBlocks, noHtmlBlocks, noHtmlSpans, tagFilter.
 *
 * Our presets turn ON beyond the native defaults:
 *   gfm       + tagFilter, autolinks
 *   docs      + gfm + headings { ids, autolink }          (default for markdownToHtml)
 *   dashboard + gfm + headings { ids }, noHtmlBlocks
 *   strict    + dashboard + noHtmlSpans
 * The native-off options (wikiLinks, underline, latexMath, hardSoftBreaks, …)
 * stay OFF in every preset. List rendering (ordered/nested/task) is parser
 * behavior, not configurable: explicit start numbers render as ol start=,
 * nested lists render as nested ol/ul, task items render checked checkboxes.
 *
 * ## React
 *
 * Bun.markdown.react() is NOT used by this repo (no React dependency or JSX
 * in the stack). If it is ever adopted, pass the parser options as the third
 * argument with an explicit reactVersion: 18 — React 18 and older do not
 * understand the default transitional element symbol (React 19+ only).
 *
 * ## ANSI options (verified 2026-08-22)
 *
 * Bun.markdown.ansi accepts: colors (false = plain text), hyperlinks (OSC 8),
 * columns (render-time markdown-aware wrapping — tables stay aligned, code
 * blocks are NOT wrapped mid-line, unlike post-hoc Bun.wrapAnsi), and
 * kittyGraphics (inline images; safe 📷 alt-text fallback on non-Kitty terms).
 *
 * ## Markdown file imports (the .md loader)
 *
 * Bun lets you import .md files directly (import html from "./x.md").
 * VERIFIED: the loader renders with DEFAULT options — no tagFilter, so raw
 * <script> passes through unescaped; no autolinks; no heading ids. It is NOT
 * a drop-in for markdownToHtml presets on untrusted/operator input — keep
 * using the presets there (they enable tagFilter). The loader is only safe
 * for trusted markdown rendered with native defaults.
 *
 * @see https://bun.com/docs/runtime/markdown
 */

import { TOKENS } from "../institutions/design-tokens.ts";
import { COLORS, type ColorKey } from "./color/palette.ts";

/**
 * Explicit GFM + safety (tagFilter + autolinks).
 * Matches the common Options example in Bun docs.
 */
export const MARKDOWN_HTML_GFM = {
  tables: true,
  strikethrough: true,
  tasklists: true,
  tagFilter: true,
  autolinks: true,
} as const satisfies Bun.markdown.Options;

/**
 * Doc / artifact HTML — GFM + heading IDs (ids + autolink headings).
 * Used by colors:artifacts → docs/COLORS.html.
 */
export const MARKDOWN_HTML_DOCS = {
  ...MARKDOWN_HTML_GFM,
  headings: { ids: true, autolink: true },
} as const satisfies Bun.markdown.Options;

/**
 * Dashboard / untrusted operator markdown (typical production pattern).
 * Heading ids for in-page nav; no raw HTML blocks; tagFilter + autolinks.
 */
export const MARKDOWN_HTML_DASHBOARD = {
  tables: true,
  strikethrough: true,
  tasklists: true,
  autolinks: true,
  headings: { ids: true },
  tagFilter: true,
  noHtmlBlocks: true,
} as const satisfies Bun.markdown.Options;

/**
 * Strict: no HTML blocks or spans — markdown formatting only.
 * Prefer for partner-facing or untrusted paste paths.
 */
export const MARKDOWN_HTML_STRICT = {
  ...MARKDOWN_HTML_DASHBOARD,
  noHtmlSpans: true,
} as const satisfies Bun.markdown.Options;

/** Named preset keys for {@link markdownToHtml}. */
export type MarkdownHtmlPreset = "gfm" | "docs" | "dashboard" | "strict";

const PRESETS: Record<MarkdownHtmlPreset, Bun.markdown.Options> = {
  gfm: MARKDOWN_HTML_GFM,
  docs: MARKDOWN_HTML_DOCS,
  dashboard: MARKDOWN_HTML_DASHBOARD,
  strict: MARKDOWN_HTML_STRICT,
};

function resolveOptions(
  options?: Bun.markdown.Options | MarkdownHtmlPreset,
): Bun.markdown.Options {
  if (options == null) return MARKDOWN_HTML_DOCS;
  if (typeof options === "string") {
    const preset = PRESETS[options];
    if (!preset) throw new Error("markdownToHtml: unknown preset " + options);
    return preset;
  }
  return options;
}

/**
 * Language chip colors — every fenced language maps to a palette key
 * (COLORS SSOT); unknown languages get the neutral gray. The chip renders
 * as a small outlined tag in the codeblock header.
 */
const LANG_CHIP_KEYS: Record<string, ColorKey> = {
  bash: "tennis", sh: "tennis", shell: "tennis", zsh: "tennis",
  ts: "kalshi", typescript: "kalshi", tsx: "kalshi",
  js: "middleware", javascript: "middleware", jsx: "middleware", mjs: "middleware",
  json: "env", json5: "env", jsonc: "env", toml: "env", yaml: "env", yml: "env",
  python: "research", py: "research", sql: "pinnacle",
  html: "betfair", css: "betfair", xml: "betfair",
  md: "misc", markdown: "misc", text: "misc",
};

export function languageChip(lang: string): { label: string; color: string } {
  const key = lang.trim().toLowerCase();
  const colorKey = LANG_CHIP_KEYS[key] ?? "unknown";
  return { label: key === "" ? "" : key.toUpperCase(), color: COLORS[colorKey] };
}

/**
 * Styled Markdown → HTML via Bun.markdown.render callbacks (verified working
 * on 1.4.0 — the old probe claim "render is plain text" predates the
 * callback API). Adds the styleOptions the plain .html path cannot express:
 *
 *   - headings carry ids (meta.id)
 *   - fenced code blocks emit <pre class="codeblock"><code class="language-…">
 *   - tables are wrapped in .tablewrap (reflow / 1.4.10)
 *   - external links get target=_blank + rel=noopener; the caller can
 *     rewrite internal hrefs (docs-surface .md links → /docs/<name>)
 *   - images without alt are dropped (1.1.1) rather than emitted broken
 *
 * Parser options (third arg) enable the ids meta + GFM safety.
 */
export function markdownToStyledHtml(
  md: string,
  options: {
    /** Rewrite link hrefs; returns the final href. Receives the raw target. */
    rewriteHref?: (href: string) => string;
  } = {},
): string {
  const rewriteHref = options.rewriteHref ?? ((href: string) => href);
  const isExternal = (href: string) => /^https?:\/\//.test(href);
  const escAttr = (v: string): string =>
    v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  return Bun.markdown.render(
    md,
    {
      heading: (children, meta) => {
        const level = meta.level;
        const id = meta.id ? ` id="${escAttr(meta.id)}"` : "";
        return `<h${level}${id}>${children}</h${level}>\n`;
      },
      paragraph: (children) => `<p>${children}</p>`,
      blockquote: (children) => `<blockquote>${children}</blockquote>`,
      code: (children, meta) => {
        const lang = meta?.language ?? "";
        const chip = languageChip(lang);
        return (
          `<div class="codeblock"><span class="langchip" data-lang="${escAttr(chip.label)}" ` +
          `style="color:${escAttr(chip.color)};border-color:${escAttr(chip.color)}">${escAttr(chip.label)}</span>` +
          `<pre><code class="language-${escAttr(lang)}">${children}</code></pre></div>`
        );
      },
      codespan: (children) => `<code>${children}</code>`,
      link: (children, meta) => {
        const href = rewriteHref(meta.href);
        return isExternal(href)
          ? `<a href="${escAttr(href)}" target="_blank" rel="noopener noreferrer">${children}</a>`
          : `<a href="${escAttr(href)}">${children}</a>`;
      },
      image: (alt, meta) => {
        // Runtime signature: children = the alt text, meta = { src, title? }.
        // bun-types types meta loosely (string) — cast and guard.
        const m = meta as unknown as { src?: string } | string;
        const src = typeof m === "object" && m !== null && typeof m.src === "string" ? m.src : "";
        if (!src || !alt) return ""; // no alt -> dropped (1.1.1)
        return `<img src="${escAttr(src)}" alt="${escAttr(alt)}" loading="lazy" />`;
      },
      list: (children, meta) => (meta.ordered ? `<ol>${children}</ol>` : `<ul>${children}</ul>`),
      listItem: (children) => `<li>${children}</li>`,
      table: (children) => `<div class="tablewrap"><table>${children}</table></div>`,
      hr: () => "<hr />",
    },
    { headings: { ids: true }, tables: true, tagFilter: true },
  );
}

/**
 * Sibling/parent docs-link resolver for the /docs surface: `<name>.md` →
 * `/docs/<name>` (the served route strips the extension — a raw `.md` href
 * 404s because the route appends `.md` again), parent-relative repo files →
 * absolute GitHub blob URLs (the standalone repo does not serve config/ or
 * parent trees). External and hash hrefs pass through.
 */
export function docsLinkRewriter(): (href: string) => string {
  const repoBase = "https://github.com/brendadeeznuts1111/Kalshi-bot/blob/main";
  return (href: string) => {
    if (href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) return href;
    if (href.endsWith(".md")) return "/docs/" + href.replace(/\.md$/, "").replace(/^\.\//, "");
    if (href.startsWith("../")) return repoBase + "/" + href.slice(3).replace(/^\//, "");
    return href;
  };
}

/**
 * Markdown → HTML via Bun.markdown.html.
 *
 * @param md Source markdown
 * @param options Raw Bun.markdown.Options object or preset name (docs default).
 */
export function markdownToHtml(
  md: string,
  options?: Bun.markdown.Options | MarkdownHtmlPreset,
): string {
  return Bun.markdown.html(md, resolveOptions(options));
}

/**
 * Markdown → HTML with palette-accent headings — literally uses Bun.color to
 * validate/normalize the accent (hex → css) before styling.
 *
 * @param md Source markdown
 * @param accentHex Palette accent (hex). When omitted, headings keep the
 *   default foreground (no style block is injected).
 */
export function markdownToHtmlAccent(md: string, accentHex?: string): string {
  let style = "";
  if (accentHex) {
    const accent = Bun.color(accentHex, "css");
    if (accent) {
      style =
        "<style>.prose h1,.prose h2,.prose h3,.prose h4{color:" +
        accent +
        "}</style>";
    }
  }
  return style + '<div class="prose">' + markdownToHtml(md, "docs") + "</div>";
}

/**
 * Markdown → ANSI for TTY (reports). Thin wrapper over Bun.markdown.ansi.
 */
export function markdownToAnsi(
  md: string,
  theme?: Bun.markdown.AnsiTheme,
): string {
  return theme === undefined ? Bun.markdown.ansi(md) : Bun.markdown.ansi(md, theme);
}

/** List preset names (for CLIs / docs). */
export function listMarkdownPresets(): readonly MarkdownHtmlPreset[] {
  return ["gfm", "docs", "dashboard", "strict"] as const;
}
/**
 * Markdown → ANSI colored by the Kalshi HQ design tokens (TOKENS) — the
 * registry stays the single source of truth for terminal output too.
 *
 * Why callbacks, not Bun.markdown.ansi(): ansi()'s theme only toggles
 * colors/hyperlinks/columns — it cannot inject arbitrary token hex
 * (verified 1.4.0). Bun.markdown.render(md, callbacks) can; verified
 * callback shapes: heading(children, {level}), paragraph(children),
 * strong(children), link(children, {href}), listItem(children).
 *
 * Colors (RGB triplets from TOKENS hex): headings = acc, body = fg,
 * muted chrome (bullets, links, code) = dim.
 */
export function markdownToAnsiTokens(md: string): string {
  const ESC = '\u001b[';
  const reset = ESC + '0m';
  const bold = ESC + '1m';
  const dim = ESC + '2m';
  const fg = (hex: string) => {
    const h = hex.replace(/^#/, '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return ESC + '38;2;' + r + ';' + g + ';' + b + 'm';
  };
  const acc = fg(TOKENS.color.acc);
  const body = fg(TOKENS.color.fg);
  const muted = fg(TOKENS.color.dim);
  return Bun.markdown.render(md, {
    heading: (c) => bold + acc + c + reset + '\n',
    paragraph: (c) => c + '\n',
    strong: (c) => bold + body + c + reset,
    emphasis: (c) => body + c + reset,
    link: (c, m) => muted + c + (m && m.href ? ' (' + String(m.href) + ')' : '') + reset,
    codespan: (c) => dim + muted + '`' + c + '`' + reset,
    listItem: (c) => dim + '\u2022 ' + reset + c + '\n',
    blockquote: (c) => dim + '\u2502 ' + c + reset + '\n',
  });
}
