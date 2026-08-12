/**
 * Bun.markdown helpers — GFM HTML with explicit safe defaults.
 *
 * tables / strikethrough / tasklists default on in Bun; **autolinks** and
 * **tagFilter** default off — we opt them in for docs and artifact HTML.
 *
 * @see https://bun.com/docs/runtime/markdown
 * @see https://bun.com/docs/runtime/markdown#options
 * @see https://bun.com/reference/bun/markdown/html
 */
// @see https://bun.com/docs/runtime/markdown#bun-markdown-html
// @see https://bun.com/docs/runtime/markdown#options

/**
 * Explicit GFM + safety opts matching the official Options example.
 * @see https://bun.com/docs/runtime/markdown#options
 */
export const MARKDOWN_HTML_GFM = {
  tables: true, // GFM tables (default: true)
  strikethrough: true, // GFM strikethrough (default: true)
  tasklists: true, // GFM task lists (default: true)
  tagFilter: true, // GFM tag filter for disallowed HTML tags (default: false)
  autolinks: true, // Autolink URLs, emails, and www. links (default: false)
} as const;

/** Doc / artifact HTML — GFM + heading IDs for anchor nav. */
export const MARKDOWN_HTML_DOCS = {
  ...MARKDOWN_HTML_GFM,
  headings: { ids: true, autolink: true },
} as const;

export type MarkdownHtmlOptions =
  | typeof MARKDOWN_HTML_GFM
  | typeof MARKDOWN_HTML_DOCS
  | {
      tables?: boolean;
      strikethrough?: boolean;
      tasklists?: boolean;
      tagFilter?: boolean;
      autolinks?: boolean | { url?: boolean; www?: boolean; email?: boolean };
      headings?: boolean | { ids?: boolean; autolink?: boolean };
    };

/**
 * Render markdown → HTML via Bun.markdown.html.
 * Defaults to {@link MARKDOWN_HTML_DOCS} (GFM + tagFilter + autolinks + heading ids).
 */
export function markdownToHtml(
  md: string,
  options: MarkdownHtmlOptions = MARKDOWN_HTML_DOCS,
): string {
  return Bun.markdown.html(md, options);
}
