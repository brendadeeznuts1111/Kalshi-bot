// @see https://bun.com/docs/runtime/utils#bun-zstdcompresssync
// @see https://bun.com/docs/runtime/utils#bun-zstddecompresssync
// @see https://bun.com/docs/runtime/hashing#bun-cryptohasher

/** Zstd frame magic — detect compressed evidence blobs on read. */
const ZSTD_MAGIC = 0xfd2fb528;

export const EVIDENCE_COMPRESS_THRESHOLD_BYTES = 4096;

/** Recorded on every zstd evidence file — verifiers need this if levels change. */
export const EVIDENCE_ZSTD_LEVEL = 3;

export type EvidenceEncoding = "plain" | "zstd";

export type EncodedEvidence = {
  bytes: Uint8Array;
  encoding: EvidenceEncoding;
  zstdLevel?: number;
};

export function isZstdEvidence(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true) === ZSTD_MAGIC;
}

export function sha3Bytes(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const hasher = new Bun.CryptoHasher("sha3-256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

/** Identity hash — decompressed NDJSON body (dedupe / content equality across recompression). */
export function digestLogicalEvidenceBody(body: string): string {
  const hasher = new Bun.CryptoHasher("sha3-256");
  hasher.update(body);
  return hasher.digest("hex");
}

/** Integrity anchor — exact bytes as stored on disk (plain or zstd frame). */
export function digestStoredEvidenceBytes(bytes: Uint8Array): string {
  return sha3Bytes(bytes);
}

/** Encode evidence NDJSON; compress with Bun.zstdCompressSync when over threshold. */
export function encodeEvidenceBody(text: string): EncodedEvidence {
  const raw = new TextEncoder().encode(text);
  if (raw.byteLength < EVIDENCE_COMPRESS_THRESHOLD_BYTES) {
    return { bytes: raw, encoding: "plain" };
  }
  return {
    bytes: Bun.zstdCompressSync(raw, { level: EVIDENCE_ZSTD_LEVEL }),
    encoding: "zstd",
    zstdLevel: EVIDENCE_ZSTD_LEVEL,
  };
}

/** Decode plain or zstd-compressed evidence bytes. */
export function decodeEvidenceBody(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const decoded = isZstdEvidence(bytes) ? Bun.zstdDecompressSync(bytes) : bytes;
  return new TextDecoder().decode(decoded);
}

export function evidenceStorageLabel(encoding: EvidenceEncoding): "plain" | "zstd" {
  return encoding;
}
