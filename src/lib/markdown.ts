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
