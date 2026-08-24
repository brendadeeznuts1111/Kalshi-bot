// Native heading extraction via Bun.markdown (GFM verified) — heading ids,
// fragment slugs, child tracking.
// @see docs/AGENT-PITFALLS.md §32
import { describe, expect, test } from "bun:test";
import { headingSlug, headingTree, markdownHeadings } from "../../src/lib/markdown-headings.ts";
import { renderMarkdownToc } from "../../src/lib/content-pipeline.ts";

const MD = [
  "# Faster",
  "## new URL()",
  "### Faster RegExp",
  "## Duplicate Heading",
  "## Duplicate Heading",
  "### Child of second dup",
].join("\n");

describe("headingSlug", () => {
  test("github-style: lowercase, dashes, strip punctuation", () => {
    expect(headingSlug("new URL() is up to 4.6× faster")).toBe("new-url-is-up-to-46-faster");
    expect(headingSlug("Faster RegExp")).toBe("faster-regexp");
  });
});

describe("markdownHeadings", () => {
  test("extracts heading tree with levels and parent indices", () => {
    const nodes = markdownHeadings(MD);
    expect(nodes.map((n) => n.text)).toEqual(["Faster", "new URL()", "Faster RegExp", "Duplicate Heading", "Duplicate Heading", "Child of second dup"]);
    expect(nodes[0]!.parentIndex).toBeNull();
    expect(nodes[1]!.parentIndex).toBe(0);
    expect(nodes[2]!.parentIndex).toBe(1); // h3 under the h2
    expect(nodes[3]!.parentIndex).toBe(0); // second h2 under h1
    expect(nodes[4]!.parentIndex).toBe(0); // duplicate h2
    expect(nodes[5]!.parentIndex).toBe(4); // h3 under the duplicate h2
  });

  test("duplicate headings get -1 suffixes (fragment-unique)", () => {
    const slugs = markdownHeadings(MD).map((n) => n.slug);
    expect(slugs).toContain("duplicate-heading");
    expect(slugs).toContain("duplicate-heading-1");
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("headingTree", () => {
  test("builds nested structure", () => {
    const tree = headingTree(markdownHeadings(MD));
    expect(tree).toHaveLength(1); // one h1
    // h1 -> three h2 children (new URL, dup, dup); the h3 nests under the
    // SECOND duplicate h2.
    expect(tree[0]!.children).toHaveLength(3);
    expect(tree[0]!.children[1]!.children).toHaveLength(0);
    expect(tree[0]!.children[2]!.children).toHaveLength(1);
  });
});

describe("renderMarkdownToc", () => {
  test("emits nested fragment links", () => {
    const toc = renderMarkdownToc(MD);
    expect(toc).toContain('href="#faster"');
    expect(toc).toContain('href="#new-url"');
    expect(toc).toContain('href="#duplicate-heading-1"');
    expect(toc).toContain("<ul>");
  });
  test("single heading -> empty TOC", () => {
    expect(renderMarkdownToc("# Only")).toBe("");
  });
});