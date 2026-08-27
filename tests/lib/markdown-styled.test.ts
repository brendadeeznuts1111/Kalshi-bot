/**
 * styled-render tests — Bun.markdown.render callback layer (verified working
 * on 1.4.0; supersedes the old "render is plain text" probe): heading ids,
 * language-tagged codeblocks, tablewrap, external-link attributes, docs-link
 * rewriting, and alt-enforced images.
 */
import { describe, expect, test } from "bun:test";
import { COLORS } from "../../src/lib/color/palette.ts";
import { docsLinkRewriter, languageChip, markdownToStyledHtml } from "../../src/lib/markdown.ts";

describe("markdownToStyledHtml", () => {
  test("headings carry ids from the parser meta", () => {
    const html = markdownToStyledHtml("## Hello World");
    expect(html).toContain('<h2 id="hello-world">Hello World</h2>');
  });

  test("fenced codeblocks are language-tagged inside .codeblock", () => {
    const html = markdownToStyledHtml("```bash\necho hi\n```");
    expect(html).toContain('<div class="codeblock"><span class="langchip" data-lang="BASH"');
    expect(html).toContain('<code class="language-bash">');
  });

  test("external links get target=_blank + rel=noopener; internal stay plain", () => {
    const html = markdownToStyledHtml("[ext](https://example.com) [in](/docs/foo)");
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">ext</a>');
    expect(html).toContain('<a href="/docs/foo">in</a>');
  });

  test("tables are wrapped for reflow (1.4.10)", () => {
    const html = markdownToStyledHtml("| a |\n| - |\n| b |");
    expect(html).toContain('<div class="tablewrap"><table>');
  });

  test("docs link rewriting: sibling .md -> /docs/<name>; parent-relative -> GitHub", () => {
    const rewrite = docsLinkRewriter();
    expect(rewrite("OTHER.md")).toBe("/docs/OTHER");
    expect(rewrite("./OTHER.md")).toBe("/docs/OTHER");
    expect(rewrite("../config/odds-registry.xml")).toBe(
      "https://github.com/brendadeeznuts1111/Kalshi-bot/blob/main/config/odds-registry.xml",
    );
    expect(rewrite("https://example.com")).toBe("https://example.com");
    expect(rewrite("#anchor")).toBe("#anchor");
  });

  test("end-to-end: docs prose with links + code renders fully rewritten", () => {
    const md = "## Run it\n\nSee [BUN_NATIVE](BUN_NATIVE.md) then run:\n\n```bash\nbun test\n```";
    const html = markdownToStyledHtml(md, { rewriteHref: docsLinkRewriter() });
    expect(html).toContain('<a href="/docs/BUN_NATIVE">BUN_NATIVE</a>');
    expect(html).toContain('class="language-bash"');
    expect(html).toContain('id="run-it"');
  });

  test("images without alt are dropped (1.1.1)", () => {
    const html = markdownToStyledHtml('![](img.png)\n\n![logo](logo.png)');
    expect(html).not.toContain('<img src="img.png"');
    expect(html).toContain('<img src="logo.png" alt="logo"');
  });
});

describe("language chips", () => {
  test("fenced blocks emit a colored lang chip in the codeblock header", () => {
    const html = markdownToStyledHtml("```bash\necho hi\n```");
    expect(html).toContain('<div class="codeblock"><span class="langchip" data-lang="BASH"');
    expect(html).toContain(">BASH</span>");
    expect(html).toContain('<code class="language-bash">');
  });

  test("chip colors come from the palette SSOT per language", () => {
    const bash = languageChip("bash");
    expect(bash.color).toBe(COLORS.tennis); // green family
    const ts = languageChip("typescript");
    expect(ts.color).toBe(COLORS.kalshi);
    const unknown = languageChip("cobol");
    expect(unknown.color).toBe(COLORS.unknown);
    expect(languageChip("").label).toBe("");
  });

  test("chip labels are normalized uppercase", () => {
    expect(languageChip("TypeScript").label).toBe("TYPESCRIPT");
  });
});
