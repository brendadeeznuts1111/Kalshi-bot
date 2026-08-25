#!/usr/bin/env bun
/**
 * `bun run crypto:probe` — crypto cluster (§132): CryptoHasher, SHA256,
 * hash, deepEquals, randomUUIDv7. Repo relies on new Bun.CryptoHasher
 * ("sha256").update(...).digest("hex"), Bun.hash bigint output,
 * Bun.deepEquals(a, b, true), Bun.randomUUIDv7(). Bun 1.4.0.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
const h = new Bun.CryptoHasher("sha256");
h.update("abc");
check("P1 CryptoHasher sha256 hex", h.digest("hex") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", h.digest("hex"));
const h2 = new Bun.CryptoHasher("sha256");
h2.update("a"); h2.update("bc");
check("P2 streaming equals one-shot", h2.digest("hex") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "");
const h3 = new Bun.CryptoHasher("sha256");
const d = h3.update("abc").digest();
check("P3 digest() default Uint8Array", d instanceof Uint8Array && d.length === 32, "len=" + d.length);
const h4 = new Bun.CryptoHasher("md5");
check("P4 md5 algo", h4.update("abc").digest("hex") === "900150983cd24fb0d6963f7d28e17f72", h4.update("abc").digest("hex"));

const b = Bun.hash("x");
check("P5 hash bigint", typeof b === "bigint", typeof b);
const b2 = Bun.hash("x", 12345);
check("P5a hash seeded differs", b2 !== b, "");

check("P6 SHA256 member", typeof (Bun as any).SHA256 === "function", String(typeof (Bun as any).SHA256));
if (typeof (Bun as any).SHA256 === "function") {
  const s = new (Bun as any).SHA256();
  check("P6a SHA256 usage", typeof s.update === "function" && typeof s.digest === "function", Object.getOwnPropertyNames(Object.getPrototypeOf(s)).join(","));
}

check("P7 deepEquals deep", Bun.deepEquals({ a: { b: 1 } }, { a: { b: 1 } }) === true && Bun.deepEquals({ a: 1 }, { a: 2 }) === false, "");
check("P7a deepEquals fuzzy arg", typeof Bun.deepEquals({ a: 1 }, { a: 1 }, true) === "boolean", String(typeof Bun.deepEquals({ a: 1 }, { a: 1 }, true)));

const u = Bun.randomUUIDv7();
check("P8 randomUUIDv7 format", typeof u === "string" && u.length === 36 && u[14] === "7", u);

const failed = results.filter((r) => !r.pass);
console.log("crypto:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
