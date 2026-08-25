/**
 * xml-page.ts — /bun/xml: the Bun.XML reference (bun.com/docs/runtime/xml),
 * probed against Bun 1.4.0 in AGENT-PITFALLS §68. Token-built audited page.
 */
import { renderWidgetPage, widgetTable, W_VERIFIED } from "../lib/widget-page.ts";

export function renderXmlPage(): string {
  const compact = widgetTable(["Shape", "Probe"], [
    { cells: ["one key per root element", W_VERIFIED + ' <code>{ order: { ... } }</code> — root name is the single key (§68)'] },
    { cells: ["<code>@attr</code> / <code>#text</code> convention", W_VERIFIED + ' attributes <code>@id</code>, own text <code>#text</code> — no collision (§68)'] },
    { cells: ["repeated children -> array", W_VERIFIED + ' one-or-many: <code>item: [a, b]</code> vs <code>item: {...}</code> — read defensively (§68)'] },
    { cells: ["empty element -> empty string", W_VERIFIED + ' <code>&lt;paid/&gt;</code> -> <code>paid: ""</code> (§68)'] },
    { cells: ["all values strings", W_VERIFIED + ' <code>@qty="2"</code> stays <code>"2"</code> — no coercion (§68)'] },
    { cells: ["#text concatenation", W_VERIFIED + ' <code>Hello &lt;b&gt;world&lt;/b&gt;!</code> -> <code>{"#text":"Hello !", b:"world"}</code> (§68)'] },
    { cells: ["namespace prefixes verbatim", W_VERIFIED + ' <code>soap:Body</code> kept as written; xmlns is an ordinary attribute (§68)'] },
    { cells: ["comments/PI/declaration absent", W_VERIFIED + ' compact shape omits comments, PIs, DOCTYPE (§68)'] },
  ]);
  const tree = widgetTable(["Tree shape (compact:false)", "Probe"], [
    { cells: ["<code>{ name, attributes, children }</code>", W_VERIFIED + ' every element has all three keys, both present even when empty (§68)'] },
    { cells: ["children in document order", W_VERIFIED + ' text-as-string, child elements, <code>{comment}</code>, <code>{target, data}</code> PI (§68)'] },
    { cells: ["disambiguate by key", W_VERIFIED + ' string = text, .name = element, .comment = comment, .target = PI (§68)'] },
  ]);
  const stringify = widgetTable(["Bun.XML.stringify", "Probe"], [
    { cells: ["escapes &amp; &lt; &gt; + attr char refs", W_VERIFIED + ' <code>&quot;</code>/<code>&#x9;</code>/<code>&#xA;</code> in attrs, CR anywhere (§68)'] },
    { cells: ["null -> empty element; undefined/fn/symbol skipped", W_VERIFIED + ' <code>null</code> -> <code>&lt;n/&gt;</code>; Date -> ISO string (§68)'] },
    { cells: ["throws on unrepresentable values", W_VERIFIED + ' bad names, control chars, array-at-root, circular (§68)'] },
    { cells: ["-- in comment / ?> in PI throw (tree only)", W_VERIFIED + ' compact <code>{comment}</code> is an ELEMENT; constraint applies to tree children (§68 nuance)'] },
    { cells: ["no prolog/DOCTYPE (concatenatable)", W_VERIFIED + ' element only; prepend the prolog yourself (§68)'] },
    { cells: ["pretty print via space arg", W_VERIFIED + ' <code>XML.stringify(x, null, 2)</code>; second param reserved (§68)'] },
  ]);
  const imports = widgetTable(["Module import", "Probe"], [
    { cells: ["default + named import", W_VERIFIED + ' <code>import doc from "./config.xml"</code> + <code>import { config }</code> — root is both (§68)'] },
    { cells: ["require + dynamic import", W_VERIFIED + ' <code>require("./config.xml")</code> and <code>await import(...)</code> both work (§68)'] },
    { cells: ["with { type: \"xml\" }", W_VERIFIED + ' parse a non-.xml extension as XML (§68)'] },
    { cells: ["bundler inlines at build time", W_VERIFIED + ' <code>bun build</code> parses XML and inlines the object — zero runtime overhead (§68)'] },
  ]);
  const errors = widgetTable(["Errors + conformance", "Probe"], [
    { cells: ["SyntaxError not-well-formed", W_VERIFIED + ' <code>XML Parse error: Expected closing tag</code> — no lenient mode (§68)'] },
    { cells: ["RangeError deep nesting", W_VERIFIED + ' pathologically deep documents throw (§68)'] },
    { cells: ["billion-laughs protection", W_VERIFIED + ' entity expansion limits — bomb fails in ~3ms (§68)'] },
    { cells: ["internal entities + DTD subset", W_VERIFIED + ' expanded; attribute defaults applied; undeclared entity is an error (§68)'] },
    { cells: ["no XXE surface", W_VERIFIED + ' external DTDs/entities never fetched (§68)'] },
    { cells: ["encoding: string ignores decl, bytes honor it", W_VERIFIED + ' bytes: BOM/decl picks UTF-8/16/ISO-8859-1, others throw (§68)'] },
  ]);
  return renderWidgetPage({
    title: "Bun.XML Reference",
    subtitle: "Runtime API + module imports + bundler integration — probed against Bun 1.4.0 (33/33)",
    badges: ["parse · stringify", "compact + tree shapes", "module imports", "probed §68"],
    links: ["/bun/overview", "/bun/markdown", "/bun/transpiler"],
    sections: [
      { heading: "Compact shape (the default)", html: compact },
      { heading: "Tree shape (compact: false)", html: tree },
      { heading: "Bun.XML.stringify", html: stringify },
      { heading: "Module imports + bundler", html: imports },
      { heading: "Errors + conformance", html: errors },
    ],
    footer: "Full probe matrix: docs/AGENT-PITFALLS.md §68 · page: src/research/xml-page.ts",
  });
}