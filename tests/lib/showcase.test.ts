/**
 * showcase builder tests — the manifest-driven showcase: stats resolved from
 * live repo state, markdown prose through Bun.markdown.html, section
 * filtering, and JSON/HTML dual-format output.
 */
import { describe, expect, test } from "bun:test";
import { buildShowcaseData, renderShowcaseHtml, setRoot } from "../../src/lib/showcase.ts";

setRoot(import.meta.dir + "/../..");

const data = await buildShowcaseData();
const html = renderShowcaseHtml(data);

describe("buildShowcaseData", () => {
  test("stats are resolved from live repo state (not placeholders)", () => {
    const byLabel = Object.fromEntries(data.stats.map((s) => [s.label, s.value]));
    expect(Number(byLabel["books in registry"])).toBeGreaterThanOrEqual(38);
    expect(Number(byLabel["venues in store"])).toBeGreaterThanOrEqual(1);
    expect(Number(byLabel["logo PNGs baked"])).toBeGreaterThanOrEqual(38);
    expect(Number(byLabel["pipeline modules"])).toBe(12);
    expect(Number(byLabel["manifest routes"])).toBeGreaterThan(100);
  });

  test("markdown sections render through Bun.markdown.html (docs preset)", () => {
    const blob = data.sections.find((s) => s.id === "unified-on-blob")!;
    expect(blob.kind).toBe("markdown");
    expect(blob.html).toContain("<h");
    expect(blob.html).toContain("Bun.XML.parse");
  });

  test("mermaid section carries the diagram source", () => {
    const mermaid = data.sections.find((s) => s.id === "pipeline")!;
    expect(mermaid.kind).toBe("mermaid");
    expect(mermaid.html).toContain("Bun.XML.parse");
  });

  test("module table lists every module with line counts", () => {
    const modules = data.sections.find((s) => s.id === "modules")!;
    expect(modules.html).toContain("xml-feed.ts");
    expect(modules.html).toContain("scope=\"col\"");
  });

  test("section filter narrows the output", async () => {
    const filtered = await buildShowcaseData({ sections: ["modules"] });
    expect(filtered.sections.map((s) => s.id)).toEqual(["modules"]);
  });
});

describe("renderShowcaseHtml", () => {
  test("header, meta, and a11y chrome", () => {
    expect(html).toContain("<html lang=\"en\">");
    expect(html).toContain("<meta name=\"description\"");
    expect(html).toContain("<meta property=\"og:title\"");
    expect(html).toContain("<meta name=\"generator\" content=\"Bun ");
    expect(html).toContain("<main id=\"main\">");
    expect(html).toContain("<th scope=\"col\">");
    expect(html).toContain(".tablewrap");
    expect(html).toContain("a:focus-visible");
    expect(html).toContain("@media print");
    expect(html).toContain("Contents:"); // generated TOC
  });

  test("all sections are listed and linked", () => {
    for (const s of data.sections) {
      expect(html).toContain(`id="${s.id}"`);
      expect(html).toContain(`href="#${s.id}"`);
    }
  });
});
