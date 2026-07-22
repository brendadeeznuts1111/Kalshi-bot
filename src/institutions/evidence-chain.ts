// @see https://bun.com/docs/runtime/hashing#bun-cryptohasher
/**
 * Tenant-facing evidence chain — hash-before-outcome.
 * Alpha programs import this module; the harness never imports alpha tenants.
 */
import { sha3Hex } from "../research/audit-adapter.ts";

export { sha3Hex };
export { digestLogicalEvidenceBody } from "../research/evidence-io.ts";

/** sha3-256 over canonical JSON — commit prediction before outcome is known. */
export function hashPredictionPayload(payload: unknown): string {
  return sha3Hex(JSON.stringify(payload));
}
