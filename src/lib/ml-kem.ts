/**
 * ml-kem.ts - ML-KEM (post-quantum key encapsulation) on Bun 1.4.0, S223.
 *
 * The API WORKS - the S221 'unusable' conclusion was WRONG (our probe read
 * the wrong property + arg order). Verified on 1.4.0:
 *   - methods: crypto.subtle.encapsulateBits / decapsulateBits
 *   - ARG ORDER is (algorithm, key) - NOT the spec's (key, algorithm)
 *   - result: { ciphertext: ArrayBuffer (1088B @ ml-kem-768), sharedKey: ArrayBuffer (32B) }
 *     - property is 'sharedKey', NOT 'sharedSecret'
 *   - KeyUsage strings are 'encapsulateBits'/'decapsulateBits' (the enum
 *     rejects the spec's 'encapsulate'/'decapsulate').
 *   - each encapsulate yields a FRESH ciphertext + shared key.
 */

export type MlkEmParameterSet = 'ml-kem-768' | 'ml-kem-1024';

export type MlkEmKeyPair = { publicKey: globalThis.CryptoKey; privateKey: globalThis.CryptoKey };

export interface MlkEmEncapsulation {
  ciphertext: ArrayBuffer;
  /** 32-byte shared secret (ml-kem-768/1024 both derive 32 bytes). */
  sharedKey: ArrayBuffer;
}

/** Supported usage strings (verified S223): the Bits variant is the working one. */
const BITS_USAGES: string[] = ['encapsulateBits', 'decapsulateBits'];

/** Generate an ML-KEM key pair with the Bits usages. */
export async function mlKemGenerateKey(
  algorithm: MlkEmParameterSet = 'ml-kem-768',
  extractable = false,
): Promise<MlkEmKeyPair> {
  const subtle = crypto.subtle as unknown as {
    generateKey(algo: { name: string }, extractable: boolean, usages: string[]): Promise<MlkEmKeyPair>;
    encapsulateBits(algo: { name: string }, key: globalThis.CryptoKey): Promise<MlkEmEncapsulation>;
    decapsulateBits(algo: { name: string }, key: globalThis.CryptoKey, ct: ArrayBuffer): Promise<ArrayBuffer>;
  };
  return await subtle.generateKey({ name: algorithm }, extractable, BITS_USAGES);
}

/**
 * Encapsulate: produce a ciphertext + shared key for a public key.
 * NOTE the arg order (algorithm, key) - the JSC binding is NOT the spec's
 * (key, algorithm) (S223).
 */
export async function mlKemEncapsulate(
  publicKey: globalThis.CryptoKey,
  algorithm: MlkEmParameterSet = 'ml-kem-768',
): Promise<MlkEmEncapsulation> {
  const subtle = crypto.subtle as unknown as {
    encapsulateBits(algo: { name: string }, key: globalThis.CryptoKey): Promise<MlkEmEncapsulation>;
  };
  return await subtle.encapsulateBits({ name: algorithm }, publicKey);
}

/** Decapsulate: recover the shared key from a ciphertext with the private key. */
export async function mlKemDecapsulate(
  privateKey: globalThis.CryptoKey,
  ciphertext: ArrayBuffer | Uint8Array,
  algorithm: MlkEmParameterSet = 'ml-kem-768',
): Promise<ArrayBuffer> {
  const subtle = crypto.subtle as unknown as {
    decapsulateBits(algo: { name: string }, key: globalThis.CryptoKey, ct: ArrayBuffer): Promise<ArrayBuffer>;
  };
  const ct = ciphertext instanceof Uint8Array ? ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) as ArrayBuffer : ciphertext;
  return await subtle.decapsulateBits({ name: algorithm }, privateKey, ct);
}
