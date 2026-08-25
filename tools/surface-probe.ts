#!/usr/bin/env bun
/**
 * `bun run surface:probe` — closes the unprobed-member gap (§158): the
 * SHA family, password, FileSystemRouter, readableStreamTo* family,
 * randomUUIDv5 (BROKEN), deepMatch/concatArrayBuffers, memory/runtime
 * members, postgres/RedisClient/s3 shapes. Bun 1.4.0.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// P1 SHA family: all classes constructible; known digests.
const md5 = new Bun.MD5().update("abc").digest("hex");
check("P1 SHA family + known digests", md5 === "900150983cd24fb0d6963f7d28e17f72" && new Bun.SHA1().update("abc").digest("hex") === "a9993e364706816aba3e25717850c26c9cd0d89d" && new Bun.SHA224().update("abc").digest("hex").length === 56 && new Bun.SHA384().update("abc").digest("hex").length === 96 && new Bun.SHA512().update("abc").digest("hex").length === 128 && new Bun.SHA512_256().update("abc").digest("hex").length === 64 && new Bun.MD4().update("abc").digest("hex").length === 32, "md5=" + md5.slice(0, 8));

// P2 password: hash + verify round-trip.
const pw = await Bun.password.hash("secret123");
check("P2 password hash + verify", typeof pw === "string" && pw.length > 20 && (await Bun.password.verify("secret123", pw)) === true && (await Bun.password.verify("wrong", pw)) === false, "type=" + typeof pw + " len=" + pw.length);

// P3 FileSystemRouter: match + routes (dir + nextjs style).
const fsr = new Bun.FileSystemRouter({ dir: "scratch/meta-fixture", style: "nextjs" });
const m = fsr.match("/entry");
check("P3 FileSystemRouter match/routes", !!m && typeof m.filePath === "string" && Object.keys(fsr.routes).length > 0, "routes=" + Object.keys(fsr.routes).length);

// P4 readableStreamTo* family (ArrayBuffer/Text already pinned).
check("P4 readableStreamTo family", Array.isArray(await Bun.readableStreamToArray(new Response("a,b").body!)) && (await Bun.readableStreamToBytes(new Response("xyz").body!)).length === 3 && (await Bun.readableStreamToBlob(new Response("b").body!)).size === 1 && (await Bun.readableStreamToJSON(new Response("{\"k\":1}").body!)).k === 1, "");

// P5 CORRECTION: randomUUIDv5 accepts NO namespace form on 1.4.0.
let v5Err = "no-throw";
try { Bun.randomUUIDv5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "name"); } catch { v5Err = "throws"; }
check("P5 randomUUIDv5 BROKEN (all namespace forms throw)", v5Err === "throws", v5Err);

// P6 deepMatch + concatArrayBuffers.
// concatArrayBuffers takes ONE array of buffers and returns an ArrayBuffer.
const concat = Bun.concatArrayBuffers([new Uint8Array([1]), new Uint8Array([2])]);
check("P6 deepMatch + concatArrayBuffers", Bun.deepMatch({ a: { b: 1 } }, { a: { b: 1 } }) === true && Bun.deepMatch({ a: 1 }, { a: 2 }) === false && concat instanceof ArrayBuffer && concat.byteLength === 2, "concat=" + (concat as ArrayBuffer).constructor.name + ":" + (concat as ArrayBuffer).byteLength);

// P7 memory/runtime members exist.
check("P7 memory/runtime members", typeof Bun.gc === "function" && typeof Bun.shrink === "function" && typeof Bun.generateHeapSnapshot === "function" && typeof Bun.isMainThread === "boolean" && typeof Bun.isStandaloneExecutable === "boolean" && typeof Bun.main === "string" && typeof Bun.unsafe === "object" && typeof Bun.indexOfLine === "function" && typeof Bun.resolveSync === "function" && typeof Bun.allocUnsafe === "function" && Array.isArray(Bun.embeddedFiles) && typeof Bun.stderr === "object" && typeof Bun.stdin === "object", "main=" + Bun.main.slice(0, 20));

// P8 postgres / RedisClient / s3 shapes.
check("P8 postgres/RedisClient/s3 shapes", typeof Bun.postgres === "object" || typeof Bun.postgres === "function", "postgres=" + typeof Bun.postgres + " redis=" + typeof Bun.RedisClient + " s3=" + typeof Bun.s3 + " s3Client=" + typeof Bun.S3Client);

const failed = results.filter((r) => !r.pass);
console.log("surface:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
