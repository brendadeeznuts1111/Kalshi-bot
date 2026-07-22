// @see https://bun.com/docs/runtime/utils#bun-zstdcompresssync
// @see https://bun.com/docs/runtime/utils#bun-zstddecompresssync

/** Zstd frame magic — detect compressed evidence blobs on read. */
const ZSTD_MAGIC = 0xfd2fb528;

export const EVIDENCE_COMPRESS_THRESHOLD_BYTES = 4096;

export function isZstdEvidence(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true) === ZSTD_MAGIC;
}

/** Encode evidence NDJSON; compress with Bun.zstdCompressSync when over threshold. */
export function encodeEvidenceBody(text: string): Uint8Array {
  const raw = new TextEncoder().encode(text);
  if (raw.byteLength < EVIDENCE_COMPRESS_THRESHOLD_BYTES) return raw;
  return Bun.zstdCompressSync(raw);
}

/** Decode plain or zstd-compressed evidence bytes. */
export function decodeEvidenceBody(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const decoded = isZstdEvidence(bytes) ? Bun.zstdDecompressSync(bytes) : bytes;
  return new TextDecoder().decode(decoded);
}

export function evidenceStorageLabel(byteLength: number): "plain" | "zstd" {
  return byteLength >= EVIDENCE_COMPRESS_THRESHOLD_BYTES ? "zstd" : "plain";
}
