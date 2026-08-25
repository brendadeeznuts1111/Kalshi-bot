#!/usr/bin/env bun
/**
 * `bun run format:probe` — format/parser cluster (§132 round 2): TOML,
 * YAML (1.2 semantics), JSONC, JSONL (+parseChunk), XML (attrs -> @attr),
 * markdown.html(). Shapes the repo relies on (audit-bun-native,
 * runtime-surface, partner-toml, bun-docs-index). Bun 1.4.0.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// P1 TOML parse + stringify round-trip (repo: partner-toml, defaults-probe)
const t = Bun.TOML.parse("title = \"x\"\n[server]\nport = 8080\n") as any;
check("P1 TOML.parse", t.title === "x" && t.server.port === 8080, JSON.stringify(t));
const ts = Bun.TOML.stringify({ a: 1, b: "s" }) ?? "";
const t2 = Bun.TOML.parse(ts) as any;
check("P1a TOML.stringify round-trip", t2.a === 1 && t2.b === "s", JSON.stringify(ts));

// P2 YAML 1.2 semantics: yes/on/no are STRINGS (runtime-surface.ts)
const y = Bun.YAML.parse("a: yes\nb: on\nc: no\nd: 5\n") as any;
check("P2 YAML 1.2 yes/on/no strings", y.a === "yes" && y.b === "on" && y.c === "no" && y.d === 5, JSON.stringify(y));
const ys = Bun.YAML.stringify({ k: [1, 2], s: "v" });
const y2 = Bun.YAML.parse(ys) as any;
check("P2a YAML.stringify round-trip", y2.k[1] === 2 && y2.s === "v", JSON.stringify(ys));

// P3 JSONC: comments, trailing commas, unquoted keys
// JSONC = JSON with Comments: quoted keys REQUIRED (unquoted keys are
// JSON5 syntax — Bun.JSONC rejects them; pinned as the boundary below).
const jc = Bun.JSONC.parse("// hi\n{\"a\": 1, \"b\": [1, 2,], /* x */}") as any;
check("P3 JSONC.parse comments+trailing", jc.a === 1 && jc.b[1] === 2, JSON.stringify(jc));
let jcErr = "no-throw";
try { Bun.JSONC.parse("{ a: 1 }"); } catch (e) { jcErr = "throws"; }
check("P3a JSONC rejects unquoted keys", jcErr === "throws", jcErr);

// P4 JSONL.parse + parseChunk (repo: ndjson replacement)
const jl = Bun.JSONL.parse("{\"a\":1}\n{\"a\":2}") as any[];
check("P4 JSONL.parse", Array.isArray(jl) && jl.length === 2 && jl[1].a === 2, JSON.stringify(jl));
// parseChunk returns { values, read, done, error } per call; it is

// P5 XML.parse attrs -> @attr (repo: bun-docs-index §68)
const x = Bun.XML.parse("<root><item id=\"1\">v</item><item id=\"2\">w</item></root>") as any;
const items = x.root.item;
check("P5 XML.parse attrs+array", Array.isArray(items) && items[0]["@id"] === "1" && items[0]["#text"] === "v" && items.length === 2, JSON.stringify(x).slice(0, 120));
const xs = Bun.XML.stringify({ root: { item: "hi" } });
check("P5a XML.stringify", typeof xs === "string" && xs.includes("<root>"), xs.slice(0, 60));

// P6 markdown.html() (repo: audit-bun-native marked replacement)
const md = Bun.markdown as any;
check("P6 markdown.html exists", typeof md.html === "function", Object.keys(md).join(","));
if (typeof md.html === "function") {
  const h = md.html("# Title\n\n**bold** and *em*");
  check("P6a markdown renders", typeof h === "string" && h.includes("<h1") && h.includes("<strong>"), h.slice(0, 120));
}

// P7 Image already gated by image:probe — assert presence only.
check("P7 Image gated elsewhere", typeof Bun.Image === "function", "covered by image:probe");

const failed = results.filter((r) => !r.pass);
console.log("format:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
