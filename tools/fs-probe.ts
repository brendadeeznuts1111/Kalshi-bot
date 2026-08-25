#!/usr/bin/env bun
/**
 * `bun run fs:probe` — filesystem surface: Bun.file/Bun.write,
 * compression (zlib/zstd), Bun.mmap, runtime loader imports,
 * Bun.Archive (§131). Verified against Bun 1.4.0 (34cbb9a40) and
 * bun-types. Self-contained: fixtures generated at runtime.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

const D = "scratch/fs-fixture";
await Bun.write(D + "/data.txt", "hello fs\n");
await Bun.write(D + "/data.json", '{"a": 1, "b": [1,2]}');
await Bun.write(D + "/conf.toml", "[server]\nport = 8080\nname = \"x\"\n");
await Bun.write(D + "/conf.yaml", "key: value\nnested:\n  x: 1\n");
await Bun.write(D + "/conf.json5", "{ a: 1, trailing: 2, }\n");
await Bun.write(D + "/doc.md", "# Title\nBody text\n");
await Bun.write(D + "/data.xml", "<root><item>1</item></root>");

// Loader imports via dynamic import AFTER the fixture writes (the gate
// must be self-contained on a clean checkout — static imports would
// resolve before the files exist).
const toml: any = (await import("../scratch/fs-fixture/conf.toml")).default;
const yaml: any = (await import("../scratch/fs-fixture/conf.yaml")).default;
const json5: any = (await import("../scratch/fs-fixture/conf.json5")).default;
const xml: any = (await import("../scratch/fs-fixture/data.xml")).default;
const mdPath = "../scratch/fs-fixture/doc.md"; // variable path: tsc has no .md module declaration
const md: any = (await import(mdPath)).default;
const txt: any = (await import("../scratch/fs-fixture/data.txt")).default;

const f = Bun.file(D + "/data.txt");
check("P1 size/type/text/bytes", f.size === 9 && f.type === "text/plain;charset=utf-8" && (await f.text()) === "hello fs\n" && new TextDecoder().decode(await f.bytes()) === "hello fs\n", "size=" + f.size);
const jv = await Bun.file(D + "/data.json").json();
check("P2 json()", jv.a === 1 && jv.b[1] === 2, JSON.stringify(jv));
const chunks: string[] = [];
for await (const c of f.stream() as any) { chunks.push(new TextDecoder().decode(c as any)); }
check("P3 stream()", chunks.join("") === "hello fs\n", JSON.stringify(chunks));
const missing = Bun.file(D + "/nope.txt");
check("P4 missing file", missing.size === 0 && missing.type === "text/plain;charset=utf-8" && (await missing.exists()) === false, "size=" + missing.size);
check("P4a type override", Bun.file(D + "/nope.json", { type: "application/json" }).type === "application/json;charset=utf-8", "");
check("P5 slice offsets", (await Bun.file(D + "/data.txt").slice(6, 9).text()) === "fs\n", "");

await Bun.write(D + "/del.txt", "bye");
await Bun.file(D + "/del.txt").delete();
check("P6 delete", !(await Bun.file(D + "/del.txt").exists()), "");
const n = await Bun.write(D + "/w.txt", "abcdef");
await Bun.write(D + "/w.txt", "xy");
check("P7 write bytes + truncate", n === 6 && (await Bun.file(D + "/w.txt").text()) === "xy", "n=" + n);
await Bun.write(D + "/wr.txt", new Response("resp-body"));
check("P8 write Response body", (await Bun.file(D + "/wr.txt").text()) === "resp-body", "");
await Bun.write(D + "/wc.txt", Bun.file(D + "/data.txt"));
check("P9 write BunFile copy", (await Bun.file(D + "/wc.txt").text()) === "hello fs\n", "");

// Compression: only the four *Sync zlib forms exist on 1.4.0 (types
// agree) — no async Bun.gzip/gunzip, no brotli functions.
check("P10 gzip round-trip", new TextDecoder().decode(Bun.gunzipSync(Bun.gzipSync("compress me"))) === "compress me", "");
check("P11 deflate round-trip", new TextDecoder().decode(Bun.inflateSync(Bun.deflateSync("deflate me"))) === "deflate me", "");
check("P12 no async gzip / no brotli", typeof (Bun as any).gzip === "undefined" && typeof (Bun as any).brotliCompressSync === "undefined", "gzip=" + typeof (Bun as any).gzip + " brotli=" + typeof (Bun as any).brotliCompressSync);
const z = Bun.zstdCompressSync("zstd me");
check("P13 zstd sync + async", new TextDecoder().decode(Bun.zstdDecompressSync(z)) === "zstd me" && new TextDecoder().decode(await Bun.zstdDecompress(await Bun.zstdCompress("async zstd"))) === "async zstd", "zlen=" + z.length);

const mm = Bun.mmap(D + "/data.txt");
check("P14 mmap", mm.length === 9 && new TextDecoder().decode(mm.slice(0, 5)) === "hello", "len=" + mm.length);

check("P15 toml/yaml/json5 imports", toml.server.port === 8080 && yaml.nested.x === 1 && json5.trailing === 2, JSON.stringify(toml));
check("P16 xml/md/txt imports", xml.root.item === "1" && typeof md === "string" && md.includes("Title") && txt === "hello fs\n", "xml=" + typeof xml + " md=" + typeof md);
check("P17 Bun.stdout is Blob", Bun.stdout instanceof Blob, (Bun.stdout as any).constructor?.name);

// Bun.Archive: static write works with STRING content; a BunFile value
// is archived as a 0-byte entry (pinned negative — silent data loss).
const A: any = Bun.Archive;
await A.write(D + "/str.tar", { "s.txt": "hello string content" });
const b1 = new A(await Bun.file(D + "/str.tar").bytes());
await b1.extract(D + "/extracted-str");
check("P18 Archive write string round-trip", (await Bun.file(D + "/extracted-str/s.txt").text()) === "hello string content", "");
await A.write(D + "/bf.tar", { "data.txt": Bun.file(D + "/data.txt") }, { compress: "gzip" });
const b2 = new A(await Bun.file(D + "/bf.tar").bytes());
await b2.extract(D + "/extracted-bf");
const bfContent = await Bun.file(D + "/extracted-bf/data.txt").text();
check("P19 Archive BunFile value = 0-byte entry", bfContent === "", "content=" + JSON.stringify(bfContent) + " size=" + (await Bun.file(D + "/extracted-bf/data.txt").stat()).size);

const failed = results.filter((r) => !r.pass);
console.log("fs:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
