/**
 * Bun.markdown helpers — zero-dep Markdown → HTML / ANSI.
 *
 * Pure Bun-native: no `marked`, `markdown-it`, or `remark`.
 *
 * ## Defaults (Bun)
 *
 * | On by default | Off by default (opt-in) |
 * | ------------- | ----------------------- |
 * | tables, strikethrough, tasklists | autolinks, headings, tagFilter, hardSoftBreaks, wikiLinks, underline, latexMath, … |
 *
 * Production presets turn **tagFilter** + **autolinks** on; docs also enable
 * **heading ids**. Strict/dashboard can strip raw HTML blocks.
 *
 * @see https://bun.com/docs/runtime/markdown
 * @see https://bun.com/docs/runtime/markdown#options
 * @see https://bun.com/reference/bun/markdown/html
 * @see https://bun.com/reference/bun/markdown/ansi
 */
// @see https://bun.com/docs/runtime/markdown#bun-markdown-html
// @see https://bun.com/docs/runtime/markdown#options
// @see https://bun.com/docs/runtime/markdown#ansi-terminal-output

/** Autolink sub-options (when not a bare boolean). */
export type MarkdownAutolinks =
  | boolean
  | {
      url?: boolean;
      www?: boolean;
      email?: boolean;
    };

/** Heading id / autolink sub-options. */
export type MarkdownHeadings =
  | boolean
  | {
      ids?: boolean;
      autolink?: boolean;
    };

/**
 * Full Options surface for {@link Bun.markdown.html}.
 * @see https://bun.com/docs/runtime/markdown#options
 */
export type MarkdownHtmlOptions = {
  /** GFM tables (default: true). */
  tables?: boolean;
  /** GFM strikethrough `~~text~~` (default: true). */
  strikethrough?: boolean;
  /** GFM task lists `- [x]` (default: true). */
  tasklists?: boolean;
  /** Autolink URLs, emails, www. (default: false). */
  autolinks?: MarkdownAutolinks;
  /** Heading IDs and/or autolink headings (default: false). */
  headings?: MarkdownHeadings;
  /** Soft line breaks → hard breaks (default: false). */
  hardSoftBreaks?: boolean;
  /** `[[wiki links]]` (default: false). */
  wikiLinks?: boolean;
  /** `__text__` → `<u>` instead of `<strong>` (default: false). */
  underline?: boolean;
  /** `$inline$` / `$$display$$` math (default: false). */
  latexMath?: boolean;
  /** Collapse whitespace in text (default: false). */
  collapseWhitespace?: boolean;
  /** ATX headers without space after `#` (default: false). */
  permissiveAtxHeaders?: boolean;
  /** Disable indented code blocks (default: false). */
  noIndentedCodeBlocks?: boolean;
  /** Disable HTML blocks (default: false). */
  noHtmlBlocks?: boolean;
  /** Disable inline HTML spans (default: false). */
  noHtmlSpans?: boolean;
  /** GFM tag filter for disallowed HTML tags (default: false). */
  tagFilter?: boolean;
};

// ── Presets ────────────────────────────────────────────────────────────────

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
} as const satisfies MarkdownHtmlOptions;

/**
 * Doc / artifact HTML — GFM + heading IDs (ids + autolink headings).
 * Used by `colors:artifacts` → `docs/COLORS.html`.
 */
export const MARKDOWN_HTML_DOCS = {
  ...MARKDOWN_HTML_GFM,
  headings: { ids: true, autolink: true },
} as const satisfies MarkdownHtmlOptions;

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
} as const satisfies MarkdownHtmlOptions;

/**
 * Strict: no HTML blocks or spans — markdown formatting only.
 * Prefer for partner-facing or untrusted paste paths.
 */
export const MARKDOWN_HTML_STRICT = {
  ...MARKDOWN_HTML_DASHBOARD,
  noHtmlSpans: true,
} as const satisfies MarkdownHtmlOptions;

/** Named preset keys for {@link markdownToHtml}. */
export type MarkdownHtmlPreset = 'gfm' | 'docs' | 'dashboard' | 'strict';

const PRESETS: Record<MarkdownHtmlPreset, MarkdownHtmlOptions> = {
  gfm: MARKDOWN_HTML_GFM,
  docs: MARKDOWN_HTML_DOCS,
  dashboard: MARKDOWN_HTML_DASHBOARD,
  strict: MARKDOWN_HTML_STRICT,
};

// ── Render ─────────────────────────────────────────────────────────────────

function resolveOptions(
  options?: MarkdownHtmlOptions | MarkdownHtmlPreset,
): MarkdownHtmlOptions {
  if (options == null) return MARKDOWN_HTML_DOCS;
  if (typeof options === 'string') {
    const preset = PRESETS[options];
    if (!preset) throw new Error(`markdownToHtml: unknown preset ${options}`);
    return preset;
  }
  return options;
}

/**
 * Markdown → HTML via `Bun.markdown.html`.
 *
 * @param md Source markdown
 * @param options Full options object **or** preset name (`gfm` | `docs` | `dashboard` | `strict`).
 *   Default: {@link MARKDOWN_HTML_DOCS}.
 *
 * @example
 * ```ts
 * markdownToHtml(md);                    // docs preset
 * markdownToHtml(md, 'dashboard');       // production board
 * markdownToHtml(md, 'strict');          // no raw HTML
 * markdownToHtml(md, { autolinks: { url: true, www: true, email: false } });
 * ```
 */
export function markdownToHtml(
  md: string,
  options?: MarkdownHtmlOptions | MarkdownHtmlPreset,
): string {
  return Bun.markdown.html(md, resolveOptions(options));
}

/**
 * Markdown → ANSI for TTY (reports). Thin wrapper over `Bun.markdown.ansi`.
 * @see https://bun.com/docs/runtime/markdown#ansi-terminal-output
 */
export function markdownToAnsi(
  md: string,
  theme?: Bun.markdown.AnsiTheme,
): string {
  return theme === undefined ? Bun.markdown.ansi(md) : Bun.markdown.ansi(md, theme);
}

/** List preset names (for CLIs / docs). */
export function listMarkdownPresets(): readonly MarkdownHtmlPreset[] {
  return ['gfm', 'docs', 'dashboard', 'strict'] as const;
}
