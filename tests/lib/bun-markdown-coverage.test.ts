/**
 * Bun.markdown full-surface coverage — corrected to the PINNED 1.4.0 contract.
 *
 * Source of truth: docs/BUN_BUILD_FINDINGS.md §9 (cross-check, 114 claims,
 * gaps 0) + tools/build-artifact-evidence.json → markdownGotchas. Every
 * assertion below was probed on Bun 1.4.0 (34cbb9a40) offline.
 *
 * Corrections vs a naive API read (ledger claim IDs in §9):
 *  - autolinks are OFF by default; pass { url: true } (or www/email) to enable
 *    (MD-autolinks). A "disable all" test is vacuous — the default is off.
 *  - GFM toggle key is `tasklists` (lowercase per Options); `taskLists`
 *    (camelCase) is silently ignored.
 *  - `{#custom-id}` is NOT an attribute feature — heading ids are auto-slugs
 *    of the heading text ("# Heading {#custom-id}" → id="heading-custom-id").
 *  - wikiLinks render a custom <x-wikilink data-target="..."> element, not
 *    <a href> (MD-wikiLinks).
 *  - latexMath / underline / collapseWhitespace / hardSoftBreaks are declared
 *    but have NO effect on 1.4.0 (MD-noopOptions, MD-hardSoftBreaks). The
 *    `<br>` from two-trailing-spaces is CommonMark's own hard-break rule and
 *    appears without any option.
 *  - tagFilter is a boolean and DOES escape GFM-disallowed tags
 *    (script/style/iframe); allowed tags (table/div) pass through (MD-tagFilter).
 *  - noHtmlBlocks DOES take effect: raw block passthrough stops and the block
 *    becomes a paragraph containing inline HTML; with noHtmlSpans too, the tag
 *    is fully escaped (MD-noHtmlBlocks).
 *  - permissiveAtxHeaders is honored and its default IS false (types correct).
 *  - render() takes callbacks DIRECTLY as the 2nd arg — a { render } wrapper
 *    means NOTHING fires. There is no softbreak/linebreak callback; the html
 *    callback fires for HTML blocks only.
 *  - react() signature is (input, ComponentOverrides?, ReactOptions?);
 *    reactVersion lives in the 3rd arg (18 → Symbol.for('react.element'),
 *    19 → Symbol.for('react.transitional.element')); overrides may be
 *    functions or tag-name strings. React/react-dom are NOT installed in this
 *    repo, so elements are validated structurally.
 *  - ansi() theme is the 2nd arg; colors is a boolean (false → plain ASCII,
 *    no escapes).
 */
import { describe, expect, test } from "bun:test";
import { markdown as markdownNs } from "bun";

// --------------------------------------------------------------
// 1. API SURFACE
// --------------------------------------------------------------
describe("Bun.markdown API surface", () => {
  test("should expose all four public methods", () => {
    expect(Bun.markdown.html).toBeDefined();
    expect(Bun.markdown.render).toBeDefined();
    expect(Bun.markdown.react).toBeDefined();
    expect(Bun.markdown.ansi).toBeDefined();
  });

  test("import { markdown } from \"bun\" is the same object as Bun.markdown", () => {
    // The d.ts declares `namespace markdown` inside `declare module "bun"` and
    // the module aliases globalThis.Bun — one namespace, two access paths.
    expect(markdownNs).toBe(Bun.markdown as any);
    expect(Object.keys(markdownNs).sort()).toEqual(["ansi", "html", "react", "render"]);
  });
});

// --------------------------------------------------------------
// 2. OPTIONS – FULL COVERAGE
// --------------------------------------------------------------
describe("Bun.markdown.html()", () => {
  const md = [
    "| A | B |",
    "|:-|:-:|",
    "| 1 | 2 |",
    "",
    "~~strike~~",
    "",
    "- [x] done",
    "- [ ] todo",
    "",
    "https://bun.sh",
    "www.example.com",
    "email@example.com",
    "",
    "# Heading {#custom-id}",
    "",
    "$E = mc^2$",
    "",
    "[[WikiLink]]",
    "",
    "__underline__",
    "",
    "Line 1",
    "Line 2",
    "",
    "# ATX without space",
  ].join("\n");
  describe("GFM toggles", () => {
    test("should render tables, strikethrough, and task lists by default", () => {
      const html = Bun.markdown.html(md);
      expect(html).toContain("<table>");
      expect(html).toContain("<del>");
      expect(html).toContain('type="checkbox"');
      expect(html).toContain('disabled checked');
    });

    test("should disable tables, strikethrough, and task lists when turned off", () => {
      // NOTE: the GFM task-list toggle key is `tasklists` (lowercase, per
      // Options in bun.d.ts); `taskLists` is silently ignored.
      const html = Bun.markdown.html(md, {
        tables: false,
        strikethrough: false,
        tasklists: false,
      });
      expect(html).not.toContain("<table>");
      expect(html).not.toContain("<del>");
      expect(html).not.toContain('type="checkbox"');
    });

    test("camelCase `taskLists` key is ignored (key is `tasklists`)", () => {
      // Cast needed: TS rejects the wrong key - that is the point of this test.
      const html = Bun.markdown.html("- [x] done", { taskLists: false } as any);
      expect(html).toContain('type="checkbox"');
    });
  });

  describe("autolinks", () => {
    test("all autolink types are OFF by default (plain text)", () => {
      const html = Bun.markdown.html(md);
      expect(html).not.toContain('href="https://bun.sh"');
      expect(html).not.toContain('href="http://www.example.com"');
      expect(html).not.toContain('href="mailto:email@example.com"');
    });

    test("should enable only URL autolinks when www and email are disabled", () => {
      const html = Bun.markdown.html(md, {
        autolinks: { url: true, www: false, email: false },
      });
      expect(html).toContain('href="https://bun.sh"');
      expect(html).not.toContain('href="http://www.example.com"');
    });

    test("boolean true enables url + www + email at once (MD-autolinksTrue)", () => {
      const html = Bun.markdown.html(
        "Visit https://bun.sh or www.example.com or email me@example.com",
        { autolinks: true },
      );
      expect(html).toContain('href="https://bun.sh"');
      expect(html).toContain('href="http://www.example.com"');
      expect(html).toContain('href="mailto:me@example.com"');
    });

    test("www and email autolinks enabled individually", () => {
      const www = Bun.markdown.html("Visit www.example.com", {
        autolinks: { www: true },
      });
      expect(www).toContain('href="http://www.example.com"');
      const email = Bun.markdown.html("Email me@example.com", {
        autolinks: { email: true },
      });
      expect(email).toContain('href="mailto:me@example.com"');
    });
  });

  describe("headings", () => {
    test("ids are AUTO-SLUGS of the heading text (no {#id} attribute feature)", () => {
      const html = Bun.markdown.html("# Heading {#custom-id}", {
        headings: { ids: true, autolink: false },
      });
      // The `{#custom-id}` is ordinary text, slugged: "heading-custom-id".
      expect(html).toContain('id="heading-custom-id"');
      expect(html).not.toContain('href="#heading-custom-id"');
    });

    test("autolink anchors wrap the heading text when autolink is enabled", () => {
      const html = Bun.markdown.html("# Heading {#custom-id}", {
        headings: { ids: true, autolink: true },
      });
      expect(html).toContain('id="heading-custom-id"');
      expect(html).toContain('href="#heading-custom-id"');
    });
  });

  describe("latexMath", () => {
    test("DECLARED but NO effect on 1.4.0: math stays literal text", () => {
      const html = Bun.markdown.html("$E=mc^2$ and $$x=1$$", {
        latexMath: true,
      });
      expect(html).not.toContain('class="math"');
      expect(html).toContain("$E=mc^2$");
      expect(html).toContain("$$x=1$$");
    });
  });

  describe("wikiLinks", () => {
    test("renders a custom x-wikilink element with data-target", () => {
      const html = Bun.markdown.html("[[Foo|bar]]", { wikiLinks: true });
      expect(html).toContain('<x-wikilink data-target="Foo">bar</x-wikilink>');
    });

    test("default label is the target", () => {
      const html = Bun.markdown.html("[[Home]]", { wikiLinks: true });
      expect(html).toContain('<x-wikilink data-target="Home">Home</x-wikilink>');
    });

    test("left as plain text when disabled (default)", () => {
      const html = Bun.markdown.html("[[Foo|bar]]", { wikiLinks: false });
      expect(html).not.toContain("x-wikilink");
      expect(html).toContain("[[Foo|bar]]");
    });
  });
  describe("underline", () => {
    test("DECLARED but NO effect: __text__ renders as <strong> with the option on", () => {
      const html = Bun.markdown.html("__foo__", { underline: true });
      expect(html).toContain("<strong>foo</strong>");
      expect(html).not.toContain("<u>");
    });

    test("same <strong> output with the option off", () => {
      const html = Bun.markdown.html("__foo__", { underline: false });
      expect(html).toContain("<strong>foo</strong>");
    });
  });

  describe("hardSoftBreaks", () => {
    test("DECLARED but NO effect: plain newline stays inside <p>", () => {
      const html = Bun.markdown.html("Line 1\nLine 2", {
        hardSoftBreaks: true,
      });
      expect(html).toContain("<p>Line 1\nLine 2</p>");
      expect(html).not.toContain("<br");
    });

    test("trailing-space <br> is CommonMark's rule, not the option", () => {
      const withOpt = Bun.markdown.html("a  \nb", { hardSoftBreaks: true });
      const withoutOpt = Bun.markdown.html("a  \nb");
      expect(withoutOpt).toContain("<br");
      expect(withOpt).toBe(withoutOpt);
    });
  });

  describe("collapseWhitespace", () => {
    test("DECLARED but NO effect: multiple spaces are preserved", () => {
      const html = Bun.markdown.html("a    b", {
        collapseWhitespace: true,
      });
      expect(html).toContain("a    b");
      expect(html).not.toContain("a b");
    });
  });

  describe("permissiveAtxHeaders", () => {
    test("renders ATX headers without a space after # when enabled", () => {
      const html = Bun.markdown.html("#header", {
        permissiveAtxHeaders: true,
      });
      expect(html).toContain("<h1>header</h1>");
    });

    test("explicit false turns it off", () => {
      const html = Bun.markdown.html("#header", {
        permissiveAtxHeaders: false,
      });
      expect(html).toContain("<p>#header</p>");
    });

    test("runtime default is OFF — matches the types (default false)", () => {
      const html = Bun.markdown.html("#NoSpace");
      expect(html).toContain("<p>#NoSpace</p>");
      expect(html).not.toContain("<h1");
    });
  });

  describe("noIndentedCodeBlocks", () => {
    test("should not render indented code as code blocks when enabled", () => {
      const html = Bun.markdown.html("    const x = 1;", {
        noIndentedCodeBlocks: true,
      });
      expect(html).not.toContain("<pre><code>");
      expect(html).toContain("<p>const x = 1;</p>");
    });

    test("should render indented code as code blocks by default", () => {
      const html = Bun.markdown.html("    const x = 1;", {
        noIndentedCodeBlocks: false,
      });
      expect(html).toContain("<pre><code>");
    });
  });

  describe("noHtmlBlocks / noHtmlSpans", () => {
    test("raw HTML block and inline span pass through by default", () => {
      const html = Bun.markdown.html("<div>block</div>\n\nbefore <span>inline</span> after");
      expect(html).toContain("<div>block</div>");
      expect(html).toContain("<span>inline</span>");
    });

    test("noHtmlBlocks stops raw block passthrough (block becomes a paragraph)", () => {
      const html = Bun.markdown.html("<div>block</div>", {
        noHtmlBlocks: true,
      });
      expect(html).not.toBe("<div>block</div>\n");
      expect(html).toContain("<p><div>block</div></p>");
    });

    test("noHtmlBlocks + noHtmlSpans escapes the tag fully", () => {
      const html = Bun.markdown.html("<div>block</div>", {
        noHtmlBlocks: true,
        noHtmlSpans: true,
      });
      expect(html).toContain("&lt;div&gt;block&lt;/div&gt;");
    });

    test("noHtmlSpans escapes inline spans", () => {
      const html = Bun.markdown.html("before <span>inline</span> after", {
        noHtmlSpans: true,
      });
      expect(html).toContain("&lt;span&gt;inline&lt;/span&gt;");
    });
  });

  describe("tagFilter", () => {
    test("boolean true escapes GFM-disallowed tags (script/style/iframe)", () => {
      const html = Bun.markdown.html(
        "<script>alert(1)</script>\n\n<style>x</style>\n\n<iframe src=x></iframe>",
        { tagFilter: true },
      );
      expect(html).toContain("&lt;script");
      expect(html).toContain("&lt;style");
      expect(html).toContain("&lt;iframe");
      expect(html).not.toContain("<script>");
    });

    test("allowed tags (table/div) pass through untouched", () => {
      const html = Bun.markdown.html("<table><tr><td>x</td></tr></table>", {
        tagFilter: true,
      });
      expect(html).toContain("<table>");
    });
  });
});
// --------------------------------------------------------------
// 3. RENDER CALLBACKS – FULL SET WITH META VALIDATION
// --------------------------------------------------------------
describe("Bun.markdown.render() callbacks", () => {
  const markdown = [
    "# Heading {#hi}",
    "",
    "> blockquote",
    "",
    "- [x] task",
    "- item",
    "",
    "1. ordered start at 3",
    "",
    "**strong** *em* ~~strike~~ `code`",
    "",
    "[link](https://bun.sh \"title\")",
    "",
    "![img](/pic.png \"alt\")",
    "",
    "| A | B |",
    "|:-:|:-:|",
    "| 1 | 2 |",
    "",
    "```js",
    "console.log(1)",
    "```",
    "",
    "---",
    "",
    "raw <span>html</span>",
  ].join("\n");

  test("invokes every declared callback with the correct metadata", () => {
    const calls: Record<string, number> = {};
    const metaSnapshots: Record<string, any> = {};

    // NOTE: callbacks are the 2nd arg DIRECTLY. A { render: {...} } wrapper
    // results in NO callback ever firing. There is no softbreak/linebreak
    // callback in RenderCallbacks (bun.d.ts); the html callback fires for
    // HTML blocks only (verified separately below).
    const render: Record<string, (children: string, meta?: any) => string> = {
      text: (children: string) => {
        calls.text = (calls.text || 0) + 1;
        return children;
      },
      paragraph: (children: string) => {
        calls.paragraph = (calls.paragraph || 0) + 1;
        return `<p>${children}</p>`;
      },
      heading: (children: string, meta: any) => {
        calls.heading = (calls.heading || 0) + 1;
        metaSnapshots.heading = meta;
        return `<h${meta.level}>${children}</h${meta.level}>`;
      },
      blockquote: (children: string) => {
        calls.blockquote = (calls.blockquote || 0) + 1;
        return `<blockquote>${children}</blockquote>`;
      },
      list: (children: string, meta: any) => {
        calls.list = (calls.list || 0) + 1;
        metaSnapshots.list = meta;
        const tag = meta.ordered ? "ol" : "ul";
        return `<${tag} start="${meta.start ?? 1}">${children}</${tag}>`;
      },
      listItem: (children: string, meta: any) => {
        calls.listItem = (calls.listItem || 0) + 1;
        metaSnapshots.listItem = meta;
        return `<li>${children}</li>`;
      },
      code: (children: string, meta: any) => {
        calls.code = (calls.code || 0) + 1;
        metaSnapshots.code = meta;
        return `<pre><code class="lang-${meta?.language ?? ""}">${children}</code></pre>`;
      },
      codespan: (children: string) => {
        calls.codespan = (calls.codespan || 0) + 1;
        return `<code>${children}</code>`;
      },
      hr: () => {
        calls.hr = (calls.hr || 0) + 1;
        return "<hr>";
      },
      table: (children: string) => {
        calls.table = (calls.table || 0) + 1;
        return `<table>${children}</table>`;
      },
      thead: (children: string) => {
        calls.thead = (calls.thead || 0) + 1;
        return `<thead>${children}</thead>`;
      },
      tbody: (children: string) => {
        calls.tbody = (calls.tbody || 0) + 1;
        return `<tbody>${children}</tbody>`;
      },
      tr: (children: string) => {
        calls.tr = (calls.tr || 0) + 1;
        return `<tr>${children}</tr>`;
      },
      th: (children: string, meta: any) => {
        calls.th = (calls.th || 0) + 1;
        metaSnapshots.th = meta;
        return `<th align="${meta?.align ?? ""}">${children}</th>`;
      },
      td: (children: string, meta: any) => {
        calls.td = (calls.td || 0) + 1;
        metaSnapshots.td = meta;
        return `<td align="${meta?.align ?? ""}">${children}</td>`;
      },
      strong: (children: string) => {
        calls.strong = (calls.strong || 0) + 1;
        return `<strong>${children}</strong>`;
      },
      emphasis: (children: string) => {
        calls.emphasis = (calls.emphasis || 0) + 1;
        return `<em>${children}</em>`;
      },
      strikethrough: (children: string) => {
        calls.strikethrough = (calls.strikethrough || 0) + 1;
        return `<del>${children}</del>`;
      },
      link: (children: string, meta: any) => {
        calls.link = (calls.link || 0) + 1;
        metaSnapshots.link = meta;
        return `<a href="${meta.href}" title="${meta.title ?? ""}">${children}</a>`;
      },
      image: (children: string, meta: any) => {
        calls.image = (calls.image || 0) + 1;
        metaSnapshots.image = meta;
        return `<img src="${meta.src}" alt="${children}" title="${meta.title ?? ""}">`;
      },
    };

    // 3rd arg: parser options (heading ids need { headings: { ids: true } }).
    Bun.markdown.render(markdown, render, { headings: { ids: true } });

    const expectedCallbacks = [
      "text",
      "paragraph",
      "heading",
      "blockquote",
      "list",
      "listItem",
      "code",
      "codespan",
      "hr",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "strong",
      "emphasis",
      "strikethrough",
      "link",
      "image",
    ];

    for (const key of expectedCallbacks) {
      expect(calls[key]).toBeGreaterThan(0);
    }

    // Heading id IS the auto-slug when the ids option is passed.
    expect(metaSnapshots.heading).toMatchObject({ level: 1, id: "heading-hi" });
    // `1. ordered start at 3` — "start at 3" is prose; CommonMark start = 1.
    expect(metaSnapshots.list).toMatchObject({ ordered: true, start: 1, depth: 0 });
    expect(metaSnapshots.code).toMatchObject({ language: "js" });
    expect(metaSnapshots.link).toMatchObject({ href: "https://bun.sh", title: "title" });
    // Image meta is { src, title }; the alt text is the CHILDREN.
    expect(metaSnapshots.image).toMatchObject({ src: "/pic.png", title: "alt" });
    expect(metaSnapshots.th).toMatchObject({ align: "center" });
    expect(metaSnapshots.td).toMatchObject({ align: "center" });
  });

  test("task list item meta carries checked; ordered item meta carries start", () => {
    const taskMeta = captureMeta("- [x] task", "listItem");
    expect(taskMeta).toMatchObject({ index: 0, depth: 0, ordered: false, checked: true });

    const itemMeta = captureMeta("1. one", "listItem");
    expect(itemMeta).toMatchObject({ index: 0, depth: 0, ordered: true, start: 1 });
  });

  test("html callback fires for HTML blocks, not inline spans", () => {
    const blockOut = Bun.markdown.render("x\n\n<div>block</div>\n\ny", {
      html: (c: string) => `HTML(${c.trim()})`,
    });
    expect(blockOut).toContain("HTML(<div>block</div>)");

    const inlineOut = Bun.markdown.render("a <span>x</span>", {
      html: (c: string) => `HTML(${c})`,
    });
    expect(inlineOut).not.toContain("HTML(");
  });

  test("a { render } wrapper never fires (callbacks are the 2nd arg directly)", () => {
    let fired = 0;
    Bun.markdown.render("# Hi", { render: { heading: () => { fired++; return "X"; } } } as any);
    expect(fired).toBe(0);
  });
});

function captureMeta(markdown: string, callback: string): any {
  let meta: any;
  const render: any = {};
  render[callback] = (_c: string, m: any) => {
    meta = m;
    return "";
  };
  Bun.markdown.render(markdown, render);
  return meta;
}

// --------------------------------------------------------------
// 4. REACT API – COMPONENT OVERRIDES & VERSION
// --------------------------------------------------------------
// React/react-dom are NOT installed in this repo (zero npm deps), so elements
// are validated structurally: $$typeof symbols, tag/type identity, props.
describe("Bun.markdown.react()", () => {
  const V18 = Symbol.for("react.element");
  const V19 = Symbol.for("react.transitional.element");

  test("returns a React-shaped element tree (v19 transitional symbol by default)", () => {
    const el: any = Bun.markdown.react("# Hello");
    expect(el).toBeTruthy();
    expect(typeof el).toBe("object");
    expect(el.$$typeof).toBe(V19);
    expect(el.type).toBe(Symbol.for("react.fragment"));
    const h1 = el.props.children[0];
    expect(h1.type).toBe("h1");
    expect(h1.props.children).toEqual(["Hello"]);
  });

  test("supports function component overrides (2nd arg, direct)", () => {
    const CustomH1 = ({ children }: any) => `H1[${children}]`;
    const el: any = Bun.markdown.react("# Hello", { h1: CustomH1 });
    expect(el.props.children[0].type).toBe(CustomH1);
    expect(el.props.children[0].props.children).toEqual(["Hello"]);
  });

  test("supports string tag names as overrides", () => {
    const el: any = Bun.markdown.react("# Hello", { h1: "MyHeading" });
    expect(el.props.children[0].type).toBe("MyHeading");
  });

  test("reactVersion is the 3rd arg: 18 → react.element, 19 → transitional", () => {
    const el18: any = Bun.markdown.react("# Hello", undefined, { reactVersion: 18 });
    expect(el18.$$typeof).toBe(V18);
    const el19: any = Bun.markdown.react("# Hello", undefined, { reactVersion: 19 });
    expect(el19.$$typeof).toBe(V19);
  });

  test("a { reactVersion } 2nd arg is treated as overrides and ignored", () => {
    // Signature is (input, ComponentOverrides?, ReactOptions?) — the 2nd arg
    // is the override map, so { reactVersion: 18 } there does nothing.
    const el: any = Bun.markdown.react("# Hello", { reactVersion: 18 } as any);
    expect(el.$$typeof).toBe(V19);
  });
});

// --------------------------------------------------------------
// 5. ANSI API – THEME COVERAGE
// --------------------------------------------------------------
describe("Bun.markdown.ansi()", () => {
  test("emits ANSI escapes by default; colors:false → plain ASCII", () => {
    const colored = Bun.markdown.ansi("# Title");
    expect(typeof colored).toBe("string");
    expect(colored).toContain("\x1b[");

    const plain = Bun.markdown.ansi("# Title", { colors: false });
    expect(plain).not.toContain("\x1b[");
  });

  test("theme options are the 2nd arg: columns wrap, hyperlinks OSC8, kittyGraphics, light", () => {
    // AnsiTheme: colors is a BOOLEAN, not a color map; columns 0 disables wrap.
    const wrapped = Bun.markdown.ansi("a b c d e", { columns: 5 });
    expect(wrapped).toContain("\n");

    const osc8 = Bun.markdown.ansi("[x](https://example.com)", { hyperlinks: true });
    expect(osc8).toContain("\x1b]8");

    expect(() =>
      Bun.markdown.ansi("# Hi", { kittyGraphics: true, light: false, columns: 0 }),
    ).not.toThrow();
  });
});

// --------------------------------------------------------------
// 6. HTML API – SMOKE TEST
// --------------------------------------------------------------
describe("Bun.markdown.html()", () => {
  test("should produce HTML string with options applied", () => {
    const html = Bun.markdown.html("# Hello", {
      headings: { ids: true },
    });
    expect(typeof html).toBe("string");
    expect(html).toContain("<h1");
    expect(html).toContain('id="hello"');
  });
});