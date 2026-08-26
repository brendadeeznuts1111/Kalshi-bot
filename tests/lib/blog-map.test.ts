// Blog → repo mapping tracker v2 tests — full-tree extraction, hierarchy,
// version provenance, diff contract, curation, report.
// @see docs/AGENT-PITFALLS.md §31 / §184
import { describe, expect, test } from "bun:test";
import { diffBlogMap, extractBadges, extractTree, mappingReport, parseTitle, type BlogMapEntry } from "../../src/lib/blog-map.ts";

const FIXTURE = [
  '<h2 id="faster">Faster</h2>',
  '<h3 id="new-url-is-up-to-4-6-faster">new URL() <span><a href="/blog/release-notes/bun-v1.4.0" class="since not-prose rounded-full border-accent/40 bg-accent-soft text-accent-strong" title="Shipped in Bun v1.4.0">v1.4.0</a></span></h3>',
  '<p>Bun\'s URL parser was rewritten. <a href="/docs">docs</a></p>',
  '<pre><code>const u = new URL(x)</code></pre>',
  '<h3 id="faster-regexp">Faster RegExp <a href="#x">v 1.3.10 v 1.4.0</a></h3>',
  '<h4 id="regexp-detail">Detail</h4>',
  '<h2 id="security">Security</h2>',
  '<h3 id="unrelated">x</h3>',
].join("");

const entry = (id: string, status: "verified" | "note" | "marketing" | "unmapped" = "verified"): BlogMapEntry => ({
  id, level: "h3", title: id, versions: [], badges: [], section: "faster", parent: null,
  codeBlocks: 0, links: 0, excerpt: "", mappedTo: "x", layer: "pipeline", status,
});

describe("extractBadges", () => {
  test("parses since anchors with verb/version/href/tone", () => {
    const html = '<a href="/blog/release-notes/bun-v1.4.0" class="since rounded-full border-accent/40 bg-accent-soft" title="Shipped in Bun v1.4.0">v1.4.0</a><a href="/blog/release-notes/bun-v1.3.10" class="since rounded-full border-line text-fg-faint" title="Improved in Bun v1.3.10">v1.3.10</a>';
    const badges = extractBadges(html);
    expect(badges).toHaveLength(2);
    expect(badges[0]).toMatchObject({ verb: "Shipped in", version: "1.4.0", href: "/blog/release-notes/bun-v1.4.0", tone: "accent" });
    expect(badges[1]).toMatchObject({ verb: "Improved in", version: "1.3.10", tone: "muted" });
  });
});

describe("parseTitle", () => {
  test("strips version tags + trailing # from the raw title", () => {
    const { title, versions } = parseTitle("Barrel import optimization <a href=\"#b\">v 1.3.10 v 1.4.0</a> #");
    expect(title).toBe("Barrel import optimization");
    expect(versions).toEqual(["1.3.10", "1.4.0"]);
  });
});

describe("extractTree", () => {
  test("parses h2/h3/h4 with ids, hierarchy, and per-heading context", () => {
    const tree = extractTree(FIXTURE);
    expect(tree.map((h) => h.id)).toEqual([
      "faster",
      "new-url-is-up-to-4-6-faster",
      "faster-regexp",
      "regexp-detail",
      "security",
      "unrelated",
    ]);
    const url = tree[1]!;
    expect(url.versions).toEqual(["1.4.0"]);
    expect(url.badges).toHaveLength(1);
    expect(url.badges[0]).toMatchObject({ verb: "Shipped in", version: "1.4.0", href: "/blog/release-notes/bun-v1.4.0", tone: "accent" });
    expect(url.section).toBe("faster");
    expect(url.codeBlocks).toBe(1);
    expect(url.links).toBeGreaterThan(0);
    expect(url.excerpt).toContain("rewritten");
    const detail = tree[3]!;
    expect(detail.level).toBe("h4");
    expect(detail.parent).toBe("faster-regexp");
    expect(detail.section).toBe("faster");
  });
});

describe("diffBlogMap", () => {
  test("full coverage when every blog h3/h4 is registered", () => {
    const d = diffBlogMap(FIXTURE, [entry("new-url-is-up-to-4-6-faster"), entry("faster-regexp"), entry("regexp-detail"), entry("unrelated")]);
    expect(d.newUnmapped).toEqual([]);
    expect(d.missing).toEqual([]);
    expect(d.coverage).toBe(1);
  });

  test("new blog headings are flagged as unmapped across ALL sections", () => {
    const d = diffBlogMap(FIXTURE, [entry("new-url-is-up-to-4-6-faster")]);
    expect(d.newUnmapped.map((u) => u.id)).toEqual(["faster-regexp", "regexp-detail", "unrelated"]);
    expect(d.newUnmapped.some((u) => u.section === "security")).toBe(true); // no longer ignored
  });

  test("registry entries missing from the blog are flagged", () => {
    const d = diffBlogMap(FIXTURE, [entry("old-removed-subheader")]);
    expect(d.missing).toContain("old-removed-subheader");
  });

  test("curation is the share of entries with a real mapping status", () => {
    const d = diffBlogMap(FIXTURE, [entry("new-url-is-up-to-4-6-faster"), entry("faster-regexp", "unmapped")]);
    expect(d.curation).toBeCloseTo(0.5);
    expect(d.total).toBe(2);
  });
});

describe("mappingReport", () => {
  test("includes registration + curation + unmapped list", () => {
    const d = diffBlogMap(FIXTURE, [entry("new-url-is-up-to-4-6-faster")]);
    const r = mappingReport(d, "2026-08-26T00:00:00.000Z");
    expect(r).toContain("Registration:");
    expect(r).toContain("Curation:");
    expect(r).toContain("faster-regexp");
    expect(r).toContain("contract violation");
  });
});