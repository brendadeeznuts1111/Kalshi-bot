import { describe, expect, test } from "bun:test";

/** Fixture sitemap exercising repeats, namespaces, entities + CDATA. */
const FIXTURE_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://bun.com/docs/runtime/xml</loc></url>
  <url><loc>https://bun.com/docs/runtime/image</loc></url>
  <url><loc>https://bun.com/docs/runtime/markdown</loc></url>
</urlset>`;

/** The Bun.XML extraction now used by tools/bun-docs-index.ts (source=site). */
function extractLocsViaBunXml(xml: string): string[] {
  const parsed = Bun.XML.parse(xml) as { urlset?: { url?: { loc?: string } | Array<{ loc?: string }> } };
  const urls = parsed.urlset?.url;
  return (Array.isArray(urls) ? urls : urls ? [urls] : [])
    .map((u) => u.loc)
    .filter((l): l is string => typeof l === "string");
}

/** The old regex extraction (parity oracle). */
function extractLocsViaRegex(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
}

describe("Bun.XML sitemap extraction (§68, bun-docs-index site source)", () => {
  test("matches the regex extraction exactly on a fixture sitemap", () => {
    expect(extractLocsViaBunXml(FIXTURE_SITEMAP)).toEqual(extractLocsViaRegex(FIXTURE_SITEMAP));
    expect(extractLocsViaBunXml(FIXTURE_SITEMAP)).toEqual([
      "https://bun.com/docs/runtime/xml",
      "https://bun.com/docs/runtime/image",
      "https://bun.com/docs/runtime/markdown",
    ]);
  });

  test("single <url> child is not wrapped in an array (shape stability)", () => {
    const one = Bun.XML.parse('<urlset><url><loc>https://a.b/c</loc></url></urlset>') as { urlset: { url: { loc?: string } } };
    expect(Array.isArray(one.urlset.url)).toBe(false);
    expect(extractLocsViaBunXml('<urlset><url><loc>https://a.b/c</loc></url></urlset>')).toEqual(["https://a.b/c"]);
  });

  test("entities and CDATA are decoded by the parser", () => {
    const parsed = Bun.XML.parse('<root><a><![CDATA[hello <world> & more]]></a><b>AT&amp;T</b></root>') as { root: { a: string; b: string } };
    expect(parsed.root.a).toBe("hello <world> & more");
    expect(parsed.root.b).toBe("AT&T");
  });

  test("attributes land on @attr keys, mixed content on #text", () => {
    const parsed = Bun.XML.parse('<root><c attr="x&quot;y">text</c></root>') as { root: { c: { "@attr": string; "#text": string } } };
    expect(parsed.root.c["@attr"]).toBe('x"y');
    expect(parsed.root.c["#text"]).toBe("text");
  });

  test("namespace prefixes are preserved verbatim (§68)", () => {
    const parsed = Bun.XML.parse('<soap:Envelope><soap:Body>ok</soap:Body></soap:Envelope>') as Record<string, unknown>;
    expect(Object.keys(parsed)).toContain("soap:Envelope");
  });
});
