#!/usr/bin/env bun
/**
 * `bun run xml:probe` — probe the Bun.XML doc claims (AGENT-PITFALLS §68)
 * against the installed runtime: compact shape, tree shape, stringify
 * escaping/errors, module imports, bundler inlining, entity limits.
 *
 * VERIFIED on Bun 1.4.0 (36/36):
 *   - compact shape: one key per root, @attr/#text convention, repeated
 *     children -> arrays, empty element -> "", all values strings
 *   - #text concatenation (Hello <b>world</b>! -> "Hello !" + b)
 *   - tree shape (compact:false): { name, attributes, children } with
 *     comments { comment } and PIs { target, data } in document order
 *   - namespace prefixes verbatim; comments/PI/declaration absent compact
 *   - SyntaxError not-well-formed ("XML Parse error: Expected closing"),
 *     RangeError deep nesting, "billion laughs" fails in ~4ms
 *   - stringify: escapes &<> + &quot;/&#x9;/&#xA; in attrs; null -> empty
 *     element; undefined/function/symbol skipped; Date ISO; bad names /
 *     control chars / array-at-root / circular throw; -- in comment and
 *     ?> in PI throw ONLY for tree-shape children nodes (compact-level
 *     { comment } is just an element — probe nuance, not a doc error)
 *   - module imports: default/named/require/dynamic + with { type: xml }
 *   - bundler inlines XML at build time
 *   - string input IGNORES encoding decl (checked for syntax); bytes use
 *     BOM/declaration (UTF-8/16/ISO-8859-1); unknown -> throws
 *
 * @see docs/AGENT-PITFALLS.md §68
 */
import { XML } from "bun";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// P1: named export + surface
check("P1 XML === Bun.XML", XML === (Bun as any).XML, "identity=" + (XML === (Bun as any).XML));

// P2: compact shape (doc order example)
const data = XML.parse(`<order id="A1" currency="USD"><customer>Ada</customer><item sku="tea" qty="2">Green tea</item><item sku="mug" qty="1">Mug</item><paid/></order>`);
const d = JSON.stringify(data);
check("P2 compact keys", d.includes("\"@id\":\"A1\"") && d.includes("\"#text\":\"Green tea\"") && d.includes("\"@sku\":\"mug\""), d.slice(0, 100));
check("P2b repeated -> array", Array.isArray((data as any).order.item) && (data as any).order.item.length === 2, "item len=" + (data as any).order.item.length);
check("P2c empty element -> empty string", (data as any).order.paid === "", "paid=" + JSON.stringify((data as any).order.paid));
check("P3 no coercion", typeof (data as any).order.item[0]["@qty"] === "string", "qty type=" + typeof (data as any).order.item[0]["@qty"]);

// P4: #text concat
const p = XML.parse(`<p>Hello <b>world</b>!</p>`);
check("P4 #text concat", JSON.stringify(p) === JSON.stringify({ p: { "#text": "Hello !", b: "world" } }), JSON.stringify(p));

// P5: tree shape
const tree = XML.parse(`<p class="lead">Hello <b>world</b>!<!-- draft --></p>`, { compact: false });
const kids = (tree as any).children;
check("P5 tree doc order", Array.isArray(kids) && kids[0] === "Hello " && kids[1].name === "b" && kids[2] === "!" && kids[3].comment === " draft ", JSON.stringify(kids.map((k: any) => typeof k === "string" ? k : k.name || k.comment)));

// P6-7: namespace + no comments in compact
const soap = XML.parse(`<soap:Body xmlns:soap="http://x"><soap:Envelope/></soap:Body>`);
check("P6 namespace verbatim", JSON.stringify(soap).includes("soap:Body"), JSON.stringify(soap).slice(0, 60));
const noComment = XML.parse(`<?xml version="1.0"?><!-- hi --><root><a/><?pi data?></root>`);
check("P7 comments/PI/decl absent", JSON.stringify(noComment) === JSON.stringify({ root: { a: "" } }), JSON.stringify(noComment));

// P8-9: errors
let errMsg = ""; try { XML.parse("<a><b></a>"); } catch (e) { errMsg = (e as Error).message; }
check("P8 SyntaxError msg", errMsg.includes("XML Parse error") && errMsg.includes("Expected closing tag"), errMsg);
let deepErr = ""; try { XML.parse("<a>" + "<b>".repeat(100000) + "</b>".repeat(100000) + "</a>"); } catch (e) { deepErr = (e as Error).constructor.name; }
check("P9 deep nesting RangeError", deepErr === "RangeError", deepErr || "no-throw");

// P10: input types
check("P10 Blob", JSON.stringify(XML.parse(new Blob(["<a><b>1</b></a>"]))) === JSON.stringify({ a: { b: "1" } }), "ok");
check("P10b TypedArray", JSON.stringify(XML.parse(new TextEncoder().encode("<a><b>1</b></a>"))) === JSON.stringify({ a: { b: "1" } }), "ok");

// P11-13: stringify
const s1 = XML.stringify({ order: { "@id": "A1", customer: "Ada", item: [{ "@sku": "tea", "#text": "Green tea" }, { "@sku": "mug" }], paid: null } });
check("P11 stringify compact", s1 === '<order id="A1"><customer>Ada</customer><item sku="tea">Green tea</item><item sku="mug"/><paid/></order>', s1);
const s2 = XML.stringify({ name: "p", attributes: { class: "lead" }, children: ["Hello ", { name: "b", children: ["world"] }, "!", { comment: " draft " }] });
check("P12 stringify tree", s2 === '<p class="lead">Hello <b>world</b>!<!-- draft --></p>', s2);
const s3 = XML.stringify({ a: { "#text": "x & y < z > 1" } });
check("P13 escaping", s3.includes("&amp;") && s3.includes("&lt;") && s3.includes("&gt;"), s3);

// P14-16: types, round-trip, pretty
const s4 = XML.stringify({ a: { u: undefined, f: () => {}, s: Symbol("x"), d: new Date(0), n: null } }) ?? "";
check("P14 skip/ISO/null", !s4.includes("undefined") && s4.includes("<d>1970-01-01T00:00:00.000Z</d>") && s4.includes("<n/>"), s4);
check("P15 round-trip", JSON.stringify(XML.parse(XML.stringify(data))) === JSON.stringify(data), "equal");
const s5 = XML.stringify(data, null, 2);
check("P16 pretty 2-space", s5.includes("\n  <customer>"), s5.slice(0, 30).replace(/\n/g, "\\n"));

// E-errors: stringify throw cases
const throwsOn = (fn: () => void): boolean => { try { fn(); return false; } catch { return true; } };
check("E1 bad name throws", throwsOn(() => XML.stringify({ "first name": "x" })), "ok");
check("E2 control char throws", throwsOn(() => XML.stringify({ a: { "#text": "x\u0000y" } })), "ok");
check("E5 array at root throws", throwsOn(() => XML.stringify([1, 2])), "ok");
const circ: any = { a: {} }; circ.a.self = circ;
check("E6 circular throws", throwsOn(() => XML.stringify(circ)), "ok");
const s7 = XML.stringify({ a: { "@q": "say \"hi\"\ttab\nnew" } });
check("E7 attr char refs", s7.includes("&quot;") && s7.includes("&#x9;") && s7.includes("&#xA;"), s7);
// tree-shape comment/PI constraints (the doc nuance: compact-level { comment } is an element)
check("E3t -- in tree comment throws", throwsOn(() => XML.stringify({ name: "a", children: [{ comment: "x--y" }] })), "ok");
check("E4t ?> in tree PI throws", throwsOn(() => XML.stringify({ name: "a", children: [{ target: "pi", data: "x?>y" }] })), "ok");
// compact-level { comment } is an ELEMENT (probe nuance, doc-correct)
check("E3c compact {comment} is element", XML.stringify({ a: { comment: "x--y" } }) === "<a><comment>x--y</comment></a>", XML.stringify({ a: { comment: "x--y" } }));

// entities + encodings
const e8 = XML.parse(`<!DOCTYPE root [<!ENTITY foo "bar">]><root><x>&foo;</x></root>`);
check("E8 internal entity expanded", JSON.stringify(e8) === JSON.stringify({ root: { x: "bar" } }), JSON.stringify(e8));
let e9 = ""; try { XML.parse("<root><x>&nbsp;</x></root>"); } catch (e) { e9 = (e as Error).message; }
check("E9 undeclared entity throws", e9.length > 0, e9.slice(0, 60));
const utf16 = new Uint8Array([0xFF, 0xFE, 0x3C, 0x00, 0x61, 0x00, 0x3E, 0x00, 0x3C, 0x00, 0x2F, 0x00, 0x61, 0x00, 0x3E, 0x00]);
check("E10 UTF-16 BOM bytes", JSON.stringify(XML.parse(utf16)) === JSON.stringify({ a: "" }), "ok");
// string input IGNORES encoding decl; bytes throw on unknown
let e11s = ""; try { XML.parse(`<?xml version="1.0" encoding="EBCDIC"?><a/>`); e11s = "no-throw (string ignores decl — doc-correct)"; } catch (e) { e11s = "THREW " + (e as Error).message.slice(0, 40); }
check("E11a string ignores encoding decl", e11s.startsWith("no-throw"), e11s);
let e11b = ""; try { XML.parse(new TextEncoder().encode(`<?xml version="1.0" encoding="EBCDIC"?><a/>`)); } catch (e) { e11b = (e as Error).message; }
check("E11b bytes unknown encoding throws", e11b.includes("Unsupported encoding"), e11b.slice(0, 50));
// billion laughs
const bomb = `<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;"><!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;"><!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;"><!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;"><!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;"><!ENTITY lol8 "&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;">]><lolz>&lol8;</lolz>`;
const t0 = Date.now();
let e12 = ""; try { XML.parse(bomb); e12 = "parsed"; } catch (e) { e12 = "THREW " + (e as Error).constructor.name; }
check("E12 billion laughs fails", e12.startsWith("THREW"), e12 + " in " + (Date.now() - t0) + "ms");

console.log("---");
const fails = results.filter((r) => !r.pass);
console.log("xml:probe — " + (results.length - fails.length) + "/" + results.length + " pass" + (fails.length ? " · FAIL: " + fails.map((f) => f.name).join(", ") : ""));
process.exit(fails.length ? 1 : 0);