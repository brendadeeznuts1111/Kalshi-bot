/**
 * showcase builder tests — the manifest-driven showcase: stats resolved from
 * live repo state, markdown prose through Bun.markdown.html, section
 * filtering, and JSON/HTML dual-format output.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { buildShowcaseData, renderShowcaseHtml, setRoot, showcaseColors } from "../../src/lib/showcase.ts";
import { ROUTE_MANIFEST } from "../../src/research/route-manifest.ts";
import { TOKENS } from "../../src/institutions/design-tokens.ts";

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

describe("color governance — no hardcoded hexes", () => {
  test("showcase builder carries no color literals (palette/env only)", () => {
    const src = readFileSync(new URL("../../src/lib/showcase.ts", import.meta.url).pathname, "utf8");
    expect(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });

  test("book logo generator carries no color literals", () => {
    const src = readFileSync(new URL("../../src/institutions/odds-registry/book-logos.ts", import.meta.url).pathname, "utf8");
    expect(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });

  test("SHOWCASE_* env overrides win over token defaults", () => {
    const colors = showcaseColors({ SHOWCASE_ACCENT: "#00ff00", SHOWCASE_FG: "#eeeeee" });
    expect(colors.accent).toBe("#00ff00");
    expect(colors.fg).toBe("#eeeeee");
    expect(colors.bg).toBe(TOKENS.color.bg); // unset keys fall back to the palette
  });
});

describe("html compliance — codeblocks, lists, links, lang", () => {
  test("fenced codeblocks are language-tagged", () => {
    const mdSection = data.sections.find((s) => s.id === "unified-on-blob")!;
    expect(mdSection.html).toContain('<code class="language-bash">');
  });

  test("pre blocks are overflow-wrapped by the stylesheet", () => {
    const wrapRules = (html.match(/overflow-x:auto/g) ?? []).length;
    expect(wrapRules).toBeGreaterThanOrEqual(2); // .tablewrap + pre
  });

  test("ordered GFM list renders as <ol> with <li> children", () => {
    const mdSection = data.sections.find((s) => s.id === "unified-on-blob")!;
    expect(mdSection.html).toContain("<ol>");
  });

  test("every internal href resolves to a route-manifest pathname or anchor", () => {
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    const manifestPaths = ROUTE_MANIFEST.map((r) => r.path);
    const covered = (href: string): boolean => {
      if (href.startsWith("#")) return true; // same-page anchor
      const base = href.split("#")[0]!.split("?")[0]!;
      if (base === "") return true; // pure hash link
      return manifestPaths.some((p) =>
        p.endsWith("*") ? base.startsWith(p.slice(0, -1)) : p === base,
      );
    };
    const dead = hrefs.filter((h) => !h.startsWith("http") && !covered(h));
    expect(dead).toEqual([]);
  });

  test("nomenclature: lang declared, sections id'd, no placeholders", () => {
    expect(html).toContain('<html lang="en">');
    for (const s of data.sections) expect(html).toContain(`id="${s.id}"`);
    expect(html).not.toMatch(/TODO|FIXME/i);
  });
});
