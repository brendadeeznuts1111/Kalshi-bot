// Bun.XML coverage (XML-* ledger claims, §9) on pinned 1.4.0 - parse/stringify,
// compact + tree shapes, XXE safety, .xml imports, bundler inlining, named export.
import { describe, expect, test } from "bun:test";
import { XML } from "bun";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Bun.XML parse", () => {
  test("compact shape: attributes @name, child arrays, #text (XML-compact)", () => {
    const doc: any = XML.parse('<order id="A1"><item sku="x">Tea</item><item sku="y">Mug</item><paid/></order>');
    expect(doc.order["@id"]).toBe("A1");
    expect(doc.order.item).toHaveLength(2);
    expect(doc.order.item[0]).toMatchObject({ "@sku": "x", "#text": "Tea" });
    expect(doc.order.paid).toBeDefined();
  });

  test("tree shape with { compact: false } (XML-parse)", () => {
    const doc: any = XML.parse("<p>Hello <b>world</b>!</p>", { compact: false });
    expect(Object.keys(doc)).toEqual(["name", "attributes", "children"]);
  });
});

describe("Bun.XML stringify", () => {
  test("round-trips parse(x) exactly; escapes & < > (XML-stringify)", () => {
    expect(XML.stringify(XML.parse("<a><b>x</b></a>"))).toBe("<a><b>x</b></a>");
    expect(XML.stringify({ a: { b: "x & y < z >" } } as any)).toBe("<a><b>x &amp; y &lt; z &gt;</b></a>");
  });

  test("Date scalar -> ISO; malformed element name throws", () => {
    expect(XML.stringify({ d: new Date(0) } as any)).toBe("<d>1970-01-01T00:00:00.000Z</d>");
    expect(() => XML.stringify({ "a<b": "x" } as any)).toThrow();
  });
});

describe("Bun.XML safety + integration", () => {
  test("XXE-safe: external entities are NOT resolved (XML-xxe)", () => {
    const doc: any = XML.parse('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><a>&xxe;</a>');
    expect(doc.a).toBe("&xxe;"); // left as literal text, never resolved
  });

  test("importing a .xml file evaluates to the compact shape (XML-import)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xml-"));
    const f = join(dir, "config.xml");
    writeFileSync(f, "<config><name>demo</name><port>8080</port></config>");
    const m: any = await import(f);
    expect(JSON.parse(JSON.stringify(m.default ?? m))).toEqual({ config: { name: "demo", port: "8080" } });
  });

  test("Bun.build inlines .xml at build time (XML-bundler)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xmlb-"));
    const f = join(dir, "config.xml");
    writeFileSync(f, "<config><name>demo</name></config>");
    const out = await Bun.build({ entrypoints: [f], outdir: join(dir, "dist") } as any);
    expect(out.success).toBe(true);
    expect(await out.outputs[0]!.text()).toContain("demo");
  });

  test("import { XML } from \"bun\" is the same object as Bun.XML (XML-namedExport)", () => {
    expect(XML).toBe((Bun as any).XML);
  });
});