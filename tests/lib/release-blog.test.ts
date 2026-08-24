import { describe, expect, test } from "bun:test";
import {
  extractCodeBlocks,
  identifiersFromCodeBlocks,
  latestRelease,
  parseAtomEntries,
  parseRssEntries,
} from "../../src/lib/release-blog.ts";

const RSS = [
  '<?xml version="1.0"?>',
  '<rss><channel>',
  '<title>bun.com</title>',
  '<item><title>Bun 1.4</title><link>https://bun.com/blog/bun-v1.4</link><pubDate>Thu, 20 Aug 2026 00:53:44 GMT</pubDate></item>',
  '<item><title>Bun v1.3.14</title><link>https://bun.com/blog/bun-v1.3.14</link><pubDate>Wed, 13 May 2026 03:19:35 GMT</pubDate></item>',
  '<item><title>Rewriting Bun in Rust</title><link>https://bun.com/blog/bun-in-rust</link><pubDate>Wed, 08 Jul 2026 16:00:00 GMT</pubDate></item>',
  '</channel></rss>',
].join("\n");

const BLOG_HTML = [
  "<html><body>",
  "<h1>Bun 1.4</h1>",
  '<pre><code>const img = Bun.file("a.jpg").image().resize(100).png().bytes();</code></pre>',
  '<pre><code>Bun.stringWidth("\u001b[31mhi\u001b[0m"); // 2</code></pre>',
  "<p>prose with Bun.sql but no code block</p>",
  "</body></html>",
].join("\n");

describe("release-blog parsers (pure)", () => {
  test("parseRssEntries extracts items in order", () => {
    const entries = parseRssEntries(RSS);
    expect(entries.map((e) => e.title)).toEqual(["Bun 1.4", "Bun v1.3.14", "Rewriting Bun in Rust"]);
    expect(entries[0]!.link).toBe("https://bun.com/blog/bun-v1.4");
  });

  test("parseRssEntries extracts image enclosures (@url convention)", () => {
    const xml = [
      '<?xml version="1.0"?>',
      '<rss><channel>',
      '<title>bun.com</title>',
      '<item><title>Bun 1.4</title><link>https://bun.com/blog/bun-v1.4</link><pubDate>Thu, 20 Aug 2026 00:53:44 GMT</pubDate>',
      '<enclosure url="https://bun.com/img/hero.png" type="image/png" length="123"/>',
      '<media:content url="https://bun.com/img/b.jpg" medium="image"/>',
      '<media:thumbnail url="https://bun.com/img/c.jpg"/>',
      '</item>',
      '<item><title>No image</title><link>https://bun.com/blog/none</link><pubDate>Wed, 19 Aug 2026 00:00:00 GMT</pubDate></item>',
      '</channel></rss>',
    ].join("\n");
    const entries = parseRssEntries(xml);
    expect(entries[0]!.imageUrl).toBe("https://bun.com/img/hero.png"); // enclosure wins
    expect(entries[1]!.imageUrl).toBeUndefined();
  });

  test("latestRelease picks the newest versioned entry and cleans the version", () => {
    const rel = latestRelease(parseRssEntries(RSS));
    expect(rel).not.toBeNull();
    expect(rel!.title).toBe("Bun 1.4");
    expect(rel!.version).toBe("1.4");
  });

  test("extractCodeBlocks strips tags and entities", () => {
    const blocks = extractCodeBlocks(BLOG_HTML);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("Bun.file");
    expect(blocks[0]).toContain("\"a.jpg\"");
  });

  test("identifiersFromCodeBlocks finds top-level Bun.* in code only", () => {
    const ids = identifiersFromCodeBlocks(extractCodeBlocks(BLOG_HTML));
    expect(ids.has("file")).toBe(true);
    // ".image()" is a method on the BunFile, NOT a top-level Bun.image.
    expect(ids.has("image")).toBe(false);
    expect(ids.has("stringWidth")).toBe(true);
    expect(ids.has("sql")).toBe(false); // prose only, no code block
  });
});

const ATOM = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<feed xmlns="http://www.w3.org/2005/Atom">',
  '<entry><title>Bun v1.4</title><id>tag:github.com,2008:Repository/357728969/bun-v1.4.0</id><link rel="alternate" type="text/html" href="https://github.com/oven-sh/bun/releases/tag/bun-v1.4.0"/><updated>2026-08-20T00:53:44Z</updated></entry>',
  '<entry><title>Bun v1.3.14</title><id>tag:github.com,2008:Repository/357728969/bun-v1.3.14</id><link rel="alternate" type="text/html" href="https://github.com/oven-sh/bun/releases/tag/bun-v1.3.14"/><updated>2026-05-13T03:19:35Z</updated></entry>',
  '</feed>',
].join("\n");

describe("GitHub releases Atom feed (parseAtomEntries)", () => {
  test("extracts entries with @href links, same RssEntry shape", () => {
    const entries = parseAtomEntries(ATOM);
    expect(entries.map((e) => e.title)).toEqual(["Bun v1.4", "Bun v1.3.14"]);
    expect(entries[0]!.link).toBe("https://github.com/oven-sh/bun/releases/tag/bun-v1.4.0");
    expect(entries[0]!.pubDate).toBe("2026-08-20T00:53:44Z");
  });

  test("latestRelease works on atom entries (cross-check compatibility)", () => {
    const rel = latestRelease(parseAtomEntries(ATOM));
    expect(rel!.version).toBe("1.4");
    expect(rel!.link).toContain("bun-v1.4.0");
  });

  test("tolerates malformed feeds", () => {
    expect(parseAtomEntries("not xml")).toEqual([]);
    expect(parseAtomEntries("")).toEqual([]);
  });
});
