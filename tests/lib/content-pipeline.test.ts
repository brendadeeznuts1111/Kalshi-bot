// Content pipeline tests — zero-dep frontmatter + SHA-256 + ETag.
// @see docs/AGENT-PITFALLS.md §24 (Bun.sha = SHA-512/256 correction)
import { describe, expect, test } from "bun:test";
import {
  etagFor,
  hashContent,
  ingestContentItem,
  markdownPlaintext,
  parseFrontmatter,
  renderMarkdownBody,
} from "../../src/lib/content-pipeline.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("hashContent (CryptoHasher)", () => {
  test("sha256 matches the known vector for 'abc'", () => {
    expect(hashContent("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  test("sha512 matches the known vector for 'abc'", () => {
    expect(hashContent("abc", "sha512")).toBe(
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    );
  });
  test("Uint8Array input hashes identically to the string", () => {
    expect(hashContent(new TextEncoder().encode("abc"))).toBe(hashContent("abc"));
  });
  test("content changes the hash (content-addressing)", () => {
    expect(hashContent("one")).not.toBe(hashContent("two"));
  });
});

describe("etagFor", () => {
  test("returns the quoted hash", () => {
    expect(etagFor("abc123")).toBe('"abc123"');
  });
});

describe("parseFrontmatter (zero-dep)", () => {
  test("parses --- block: slug/title/date/tags", () => {
    const md = [
      "---",
      "slug: hello",
      "title: Hello World",
      "date: 2026-08-24",
      "tags: [a, b, c]",
      "---",
      "# Body",
    ].join("\n");
    const { data, content } = parseFrontmatter(md);
    expect(data.slug).toBe("hello");
    expect(data.title).toBe("Hello World");
    expect(data.date).toBe("2026-08-24");
    expect(data.tags).toEqual(["a", "b", "c"]);
    expect(content).toBe("# Body");
  });
  test("no frontmatter -> empty metadata, whole input as body", () => {
    const { data, content } = parseFrontmatter("plain");
    expect(data).toEqual({});
    expect(content).toBe("plain");
  });
  test("quoted values are unquoted", () => {
    const { data } = parseFrontmatter('---\ntitle: "Quoted Title"\n---\nx');
    expect(data.title).toBe("Quoted Title");
  });
});

describe("renderMarkdownBody (§27 — Bun.markdown.html)", () => {
  test("renders headings, lists, and code fences to real HTML", () => {
    const md = "# Hi\n\n- a\n- b\n\n\u0060\u0060\u0060ts\nconst x = 1\n\u0060\u0060\u0060\n";
    const html = renderMarkdownBody(md);
    // upgraded contract: prose wrapper + docs preset (GFM + tagFilter + heading ids)
    expect(html).toContain('<div class="prose">');
    expect(html).toContain("<h1 id=\"hi\">");
    expect(html).toContain("<li>a</li>");
    expect(html).toContain('class="language-ts"');
  });
});

describe("markdownPlaintext (§32 — render callbacks)", () => {
  test("strips formatting but keeps structure", () => {
    const md = "# Hi\n\nSome **bold** and `code` and [link](https://bun.sh).\n\n- one\n- two\n";
    const out = markdownPlaintext(md);
    expect(out).toContain("Hi");
    expect(out).toContain("bold"); // no ** markers
    expect(out).toContain("link (https://bun.sh)");
    expect(out).toContain("- one");
    expect(out).not.toContain("**");
  });
});

describe("ingestContentItem", () => {
  test("reads file, parses frontmatter, hashes RAW content, builds etag", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cp-"));
    const path = join(dir, "hello.md");
    const raw = [
      "---",
      "slug: hello",
      "title: Hello",
      "date: 2026-08-24",
      "tags: [content]",
      "---",
      "# Body",
    ].join("\n");
    await Bun.write(path, raw);
    const item = await ingestContentItem(path);
    rmSync(dir, { recursive: true, force: true });
    expect(item.id).toBe("hello");
    expect(item.title).toBe("Hello");
    expect(item.pubDate).toBe("2026-08-24T00:00:00.000Z");
    expect(item.tags).toEqual(["content"]);
    expect(item.body).toBe("# Body");
    // Hash covers the RAW content (frontmatter included) — deterministic.
    expect(item.contentHash).toBe(hashContent(raw));
    expect(item.etag).toBe('"' + item.contentHash + '"');
  });
});
