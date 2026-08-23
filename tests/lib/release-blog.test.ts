import { describe, expect, test } from "bun:test";
import {
  extractCodeBlocks,
  identifiersFromCodeBlocks,
  latestRelease,
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
