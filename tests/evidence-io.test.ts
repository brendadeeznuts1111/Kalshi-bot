// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  decodeEvidenceBody,
  encodeEvidenceBody,
  EVIDENCE_COMPRESS_THRESHOLD_BYTES,
  evidenceStorageLabel,
  isZstdEvidence,
} from "../src/research/evidence-io.ts";

describe("evidence-io", () => {
  test("passes through small bodies uncompressed", () => {
    const text = '{"ok":true}\n';
    const encoded = encodeEvidenceBody(text);
    expect(evidenceStorageLabel(encoded.byteLength)).toBe("plain");
    expect(isZstdEvidence(encoded)).toBe(false);
    expect(decodeEvidenceBody(encoded)).toBe(text);
  });

  test("round-trips large bodies with zstd", () => {
    const text = `${"line\n".repeat(EVIDENCE_COMPRESS_THRESHOLD_BYTES)}`;
    const encoded = encodeEvidenceBody(text);
    expect(evidenceStorageLabel(text.length)).toBe("zstd");
    expect(isZstdEvidence(encoded)).toBe(true);
    expect(decodeEvidenceBody(encoded)).toBe(text);
    expect(encoded.byteLength).toBeLessThan(text.length);
  });
});
