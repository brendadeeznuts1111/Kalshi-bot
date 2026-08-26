// ML-KEM utility (S223): verified encapsulate/decapsulateBits round-trip on 1.4.0.
import { describe, expect, test } from "bun:test";
import { mlKemGenerateKey, mlKemEncapsulate, mlKemDecapsulate } from "../../src/lib/ml-kem.ts";

function bytesEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const ua = new Uint8Array(a);
  const ub = new Uint8Array(b);
  return ua.length === ub.length && ua.every((v, i) => v === ub[i]);
}

describe("ml-kem (S223)", () => {
  test("encapsulate -> decapsulate round-trips the shared key (ml-kem-768)", async () => {
    const { publicKey, privateKey } = await mlKemGenerateKey();
    const enc = await mlKemEncapsulate(publicKey);
    expect(enc.ciphertext.byteLength).toBeGreaterThan(0);
    expect(enc.sharedKey.byteLength).toBe(32);
    const dec = await mlKemDecapsulate(privateKey, enc.ciphertext);
    expect(dec.byteLength).toBe(32);
    expect(bytesEqual(enc.sharedKey, dec)).toBe(true);
  });

  test("each encapsulate yields a FRESH ciphertext + shared key", async () => {
    const { publicKey, privateKey } = await mlKemGenerateKey();
    const a = await mlKemEncapsulate(publicKey);
    const b = await mlKemEncapsulate(publicKey);
    expect(bytesEqual(a.sharedKey, b.sharedKey)).toBe(false);
    expect(bytesEqual(a.ciphertext, b.ciphertext)).toBe(false);
  });

  test("ml-kem-1024 also round-trips (parameter set supported)", async () => {
    const { publicKey, privateKey } = await mlKemGenerateKey("ml-kem-1024");
    const enc = await mlKemEncapsulate(publicKey, "ml-kem-1024");
    const dec = await mlKemDecapsulate(privateKey, enc.ciphertext, "ml-kem-1024");
    expect(bytesEqual(enc.sharedKey, dec)).toBe(true);
  });
});
