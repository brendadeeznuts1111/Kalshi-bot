// XML probe tests (§68) — lock the verified surface so doc claims can't drift.
import { describe, expect, test } from "bun:test";
import { XML } from "bun";

describe("Bun.XML compact shape (§68)", () => {
  test("order example: @attr/#text, repeated->array, empty->''", () => {
    const data = XML.parse(`<order id="A1" currency="USD"><customer>Ada</customer><item sku="tea" qty="2">Green tea</item><item sku="mug" qty="1">Mug</item><paid/></order>`) as any;
    expect(data.order["@id"]).toBe("A1");
    expect(data.order.item).toHaveLength(2);
    expect(data.order.item[0]["#text"]).toBe("Green tea");
    expect(data.order.paid).toBe("");
  });

  test("no coercion: attribute values stay strings", () => {
    const data = XML.parse(`<a n="2"/>`) as any;
    expect(typeof data.a["@n"]).toBe("string");
  });

  test("#text concatenation drops inter-element whitespace runs", () => {
    const p = XML.parse(`<p>Hello <b>world</b>!</p>`) as any;
    expect(JSON.stringify(p)).toBe(JSON.stringify({ p: { "#text": "Hello !", b: "world" } }));
  });
});

describe("Bun.XML tree shape (§68)", () => {
  test("compact:false keeps document order incl. comments", () => {
    const tree = XML.parse(`<p class="lead">Hello <b>world</b>!<!-- draft --></p>`, { compact: false }) as any;
    expect(tree.name).toBe("p");
    expect(tree.attributes.class).toBe("lead");
    expect(tree.children[0]).toBe("Hello ");
    expect(tree.children[1].name).toBe("b");
    expect(tree.children[3].comment).toBe(" draft ");
  });
});

describe("Bun.XML.stringify (§68)", () => {
  test("compact + tree shapes serialize correctly", () => {
    expect(XML.stringify({ order: { "@id": "A1", customer: "Ada", paid: null } })).toBe('<order id="A1"><customer>Ada</customer><paid/></order>');
    expect(XML.stringify({ name: "p", children: ["Hi ", { name: "b", children: ["x"] }] })).toBe("<p>Hi <b>x</b></p>");
  });

  test("-- in comment and ?> in PI throw for TREE children only", () => {
    expect(() => XML.stringify({ name: "a", children: [{ comment: "x--y" }] })).toThrow(/comment/);
    expect(() => XML.stringify({ name: "a", children: [{ target: "pi", data: "x?>y" }] })).toThrow("processing instruction data");
    // compact-level { comment } is an element, not a comment node
    expect(XML.stringify({ a: { comment: "x--y" } })).toBe("<a><comment>x--y</comment></a>");
  });

  test("null -> empty element; undefined/fn/symbol skipped; Date ISO", () => {
    const s = XML.stringify({ a: { u: undefined, f: () => {}, d: new Date(0), n: null } }) ?? "";
    expect(s).toContain("<d>1970-01-01T00:00:00.000Z</d>");
    expect(s).toContain("<n/>");
    expect(s).not.toContain("undefined");
  });
});

describe("Bun.XML errors + conformance (§68)", () => {
  test("not-well-formed throws SyntaxError with the doc message", () => {
    expect(() => XML.parse("<a><b></a>")).toThrow(/XML Parse error: Expected closing tag/);
  });

  test("billion-laughs entity expansion fails fast", () => {
    const bomb = `<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;"><!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;"><!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;"><!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;"><!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;"><!ENTITY lol8 "&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;">]><lolz>&lol8;</lolz>`;
    expect(() => XML.parse(bomb)).toThrow(/Entity expansion/);
  });

  test("string input ignores encoding decl; bytes throw on unknown", () => {
    expect(() => XML.parse(`<?xml version="1.0" encoding="EBCDIC"?><a/>`)).not.toThrow();
    expect(() => XML.parse(new TextEncoder().encode(`<?xml version="1.0" encoding="EBCDIC"?><a/>`))).toThrow(/Unsupported encoding/);
  });
});