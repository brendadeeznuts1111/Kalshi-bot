/**
 * Bun utility-surface coverage (goal round 2) — Glob / CryptoHasher / password /
 * escapeHTML / deepEquals, grounded against docs/BUN_BUILD_FINDINGS.md §9
 * (claims GL-*, CH-*, PW-*, EH-*, DE-*) on the pinned 1.4.0.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "util-cov-"));
  writeFileSync(join(dir, "a.ts"), "x");
  writeFileSync(join(dir, "b.js"), "x");
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "c.txt"), "x");
  return dir;
}

describe("Bun.Glob", () => {
  test("match honors brace extension sets and globstar", () => {
    const g = new Bun.Glob("*.{ts,js}");
    expect(g.match("foo.ts")).toBe(true);
    expect(g.match("foo.md")).toBe(false);
    expect(g.match("a/b/c.ts")).toBe(false); // no globstar -> no nested match
    expect(new Bun.Glob("**/*.txt").match("a/b/c.txt")).toBe(true);
  });

  test("scanSync is cwd-scoped and recursive (GL-scan)", () => {
    const dir = fixture();
    expect([...new Bun.Glob("*.ts").scanSync({ cwd: dir })].sort()).toEqual(["a.ts"]);
    expect([...new Bun.Glob("**/*").scanSync({ cwd: dir })].sort()).toEqual([
      "a.ts",
      "b.js",
      "sub/c.txt",
    ]);
  });
});

describe("Bun.CryptoHasher", () => {
  test("sha256/md5 produce known digests (CH-digest)", () => {
    const sha = new Bun.CryptoHasher("sha256");
    sha.update("abc");
    expect(sha.digest("hex")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const md5 = new Bun.CryptoHasher("md5");
    md5.update("abc");
    expect(md5.digest("hex")).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  test("exposes algorithm and byteLength; static hash with encoding (CH-staticHash)", () => {
    const h = new Bun.CryptoHasher("sha256");
    expect(h.algorithm).toBe("sha256");
    expect(h.byteLength).toBe(32);
    expect(Bun.CryptoHasher.hash("sha256", "abc", "hex")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("Bun.password", () => {
  test("argon2id hash/verify roundtrip (PW-hashVerify)", async () => {
    const hash = await Bun.password.hash("hunter2", { algorithm: "argon2id" });
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await Bun.password.verify("hunter2", hash)).toBe(true);
    expect(await Bun.password.verify("wrong", hash)).toBe(false);
  });

  test("bcrypt hashSync/verifySync roundtrip (PW-sync)", () => {
    const hash = Bun.password.hashSync("secret", "bcrypt");
    expect(hash.startsWith("$2b$")).toBe(true);
    expect(Bun.password.verifySync("secret", hash)).toBe(true);
    expect(Bun.password.verifySync("nope", hash)).toBe(false);
  });

  test("PINNED: the widely-known $2b$10$ 'password' hash is rejected on 1.4.0", () => {
    // Interop pin: this standard bcrypt hash verifies in most implementations
    // but NOT in Bun 1.4.0's bcrypt (evidence utilityGotchas.password.
    // bcryptKnownHashRejected). Third-party bcrypt interop unverified.
    const known = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
    expect(Bun.password.verifySync("password", known, "bcrypt")).toBe(false);
  });
});

describe("Bun.escapeHTML", () => {
  test("escapes < > & and double quotes, not single quotes (EH-escape)", () => {
    expect(Bun.escapeHTML("<script>& \"")).toBe("&lt;script&gt;&amp; &quot;");
    expect(Bun.escapeHTML("plain text")).toBe("plain text");
  });
});

describe("Bun.deepEquals", () => {
  test("structural equality powers toEqual semantics (DE-equal)", () => {
    expect(Bun.deepEquals({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(Bun.deepEquals(NaN, NaN)).toBe(true);
    expect(Bun.deepEquals(new Date(0), new Date(0))).toBe(true);
    expect(Bun.deepEquals(-0, 0)).toBe(false); // Object.is-style strictness
    expect(Bun.deepEquals(1, "1")).toBe(false); // no == coercion
  });
});