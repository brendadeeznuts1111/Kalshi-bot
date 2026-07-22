// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  decodeEvidenceBody,
  digestLogicalEvidenceBody,
  digestStoredEvidenceBytes,
  encodeEvidenceBody,
  EVIDENCE_COMPRESS_THRESHOLD_BYTES,
  EVIDENCE_ZSTD_LEVEL,
  evidenceStorageLabel,
  isZstdEvidence,
} from "../src/research/evidence-io.ts";

describe("evidence-io", () => {
  test("passes through small bodies uncompressed", () => {
    const text = '{"ok":true}\n';
    const encoded = encodeEvidenceBody(text);
    expect(evidenceStorageLabel(encoded.encoding)).toBe("plain");
    expect(isZstdEvidence(encoded.bytes)).toBe(false);
    expect(decodeEvidenceBody(encoded.bytes)).toBe(text);
    expect(digestStoredEvidenceBytes(encoded.bytes)).toBe(digestLogicalEvidenceBody(text));
  });

  test("round-trips large bodies with zstd and dual digests", () => {
    const text = `${"line\n".repeat(EVIDENCE_COMPRESS_THRESHOLD_BYTES)}`;
    const encoded = encodeEvidenceBody(text);
    expect(evidenceStorageLabel(encoded.encoding)).toBe("zstd");
    expect(encoded.zstdLevel).toBe(EVIDENCE_ZSTD_LEVEL);
    expect(isZstdEvidence(encoded.bytes)).toBe(true);
    expect(decodeEvidenceBody(encoded.bytes)).toBe(text);
    expect(encoded.bytes.byteLength).toBeLessThan(text.length);
    expect(digestStoredEvidenceBytes(encoded.bytes)).not.toBe(digestLogicalEvidenceBody(text));
    expect(digestLogicalEvidenceBody(decodeEvidenceBody(encoded.bytes))).toBe(
      digestLogicalEvidenceBody(text),
    );
  });
});
