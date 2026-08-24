// Blog → repo mapping tracker tests — registry diff, coverage, report.
// @see docs/AGENT-PITFALLS.md §31
import { describe, expect, test } from "bun:test";
import { diffBlogMap, extractAnchors, mappingReport, type BlogMapEntry } from "../../src/lib/blog-map.ts";

const FIXTURE = [
  '<h2 id="faster">Faster</h2>',
  '<h3 id="new-url-is-up-to-4-6-faster">new URL()</h3>',
  '<h3 id="faster-regexp">Faster RegExp</h3>',
  '<h2 id="security">Security</h2>',
  '<h3 id="unrelated">x</h3>',
].join("");

const entry = (subId: string): BlogMapEntry => ({
  anchor: "faster", subId, title: subId, mappedTo: "x", layer: "pipeline", status: "verified",
});

describe("extractAnchors", () => {
  test("parses h2/h3 with ids in document order", () => {
    const h = extractAnchors(FIXTURE);
    expect(h.map((x) => x.id)).toEqual(["faster", "new-url-is-up-to-4-6-faster", "faster-regexp", "security", "unrelated"]);
    expect(h[0]!.level).toBe("h2");
    expect(h[1]!.level).toBe("h3");
  });
});

describe("diffBlogMap", () => {
  test("full coverage when every tracked sub-header is registered", () => {
    const d = diffBlogMap(FIXTURE, [entry("new-url-is-up-to-4-6-faster"), entry("faster-regexp")]);
    expect(d.newUnmapped).toEqual([]);
    expect(d.missing).toEqual([]);
    expect(d.coverage).toBe(1);
  });

  test("new blog sub-headers are flagged as unmapped (contract violation)", () => {
    const d = diffBlogMap(FIXTURE, [entry("new-url-is-up-to-4-6-faster")]);
    expect(d.newUnmapped).toHaveLength(1);
    expect(d.newUnmapped[0]!.id).toBe("faster-regexp");
    expect(d.newUnmapped[0]!.anchor).toBe("faster");
    expect(d.coverage).toBeCloseTo(0.5);
  });

  test("registry entries missing from the blog are flagged", () => {
    const d = diffBlogMap(FIXTURE, [entry("old-removed-subheader")]);
    expect(d.missing).toContain("old-removed-subheader");
  });

  test("sub-headers outside the tracked anchors are ignored", () => {
    const d = diffBlogMap(FIXTURE, []);
    expect(d.newUnmapped.every((u) => u.anchor !== "security")).toBe(true);
  });
});

describe("mappingReport", () => {
  test("includes coverage + unmapped list", () => {
    const d = diffBlogMap(FIXTURE, [entry("new-url-is-up-to-4-6-faster")]);
    const r = mappingReport(d, "2026-08-24T00:00:00.000Z");
    expect(r).toContain("Coverage: 50%");
    expect(r).toContain("faster-regexp");
    expect(r).toContain("contract violation");
  });
});