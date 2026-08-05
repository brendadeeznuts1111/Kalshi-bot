/**
 * state-binding.ts — SHA-256 previewId binding for mutation safety.
 *
 * Inspired by reasonix-guard PR #6973: a previewId cryptographically binds a
 * planned mutation to the exact state snapshot that the user reviewed.  At
 * confirm time the current state is re-hashed; if it differs the mutation is
 * rejected (fail-closed) instead of applying to drifted state.
 *
 * No external dependencies — uses Bun's built-in Web Crypto.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
 */

/** Canonical JSON encoder — stable key order, no extra whitespace. */
function canonicalJson(data: unknown): string {
  if (data === null || data === undefined) return "null";
  if (typeof data === "string") return JSON.stringify(data);
  if (typeof data === "number" || typeof data === "boolean") return String(data);
  if (Array.isArray(data)) return `[${data.map(canonicalJson).join(",")}]`;
  if (typeof data === "object") {
    const keys = Object.keys(data as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${canonicalJson(k)}:${canonicalJson((data as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(data);
}

/**
 * Compute a SHA-256 digest of arbitrary structured data.
 * Deterministic for the same input: stable key order, no extraneous whitespace.
 */
export async function sha256Digest(data: unknown): Promise<string> {
  const json = canonicalJson(data);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(json);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex;
}

/**
 * Compute a previewId for a planned mutation.
 *
 * @param action — short machine-readable action name (e.g. "rotate-key").
 * @param stateSnapshot — the state that the user reviewed (inputs + context).
 * @returns hex SHA-256 string.
 */
export async function computePreviewId(
  action: string,
  stateSnapshot: Record<string, unknown>,
): Promise<string> {
  return sha256Digest({ action, state: stateSnapshot });
}

/**
 * Verify that a previously-computed previewId still matches the current state.
 *
 * @param previewId — the id returned at preview time.
 * @param action — same action name used at preview time.
 * @param currentState — the state to verify against (freshly sampled).
 * @returns true iff the recomputed hash matches.
 */
export async function verifyPreviewId(
  previewId: string,
  action: string,
  currentState: Record<string, unknown>,
): Promise<boolean> {
  const expected = await computePreviewId(action, currentState);
  // Constant-time compare to prevent timing side-channels.
  if (previewId.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < previewId.length; i++) {
    mismatch |= previewId.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Snapshot the state for a Kalshi key rotation preview.
 *
 * @param keyId — the key id being reviewed.
 * @param pemText — the PEM text being reviewed (stored as a hash, never echoed).
 */
export async function snapshotKeyRotation(
  keyId: string,
  pemText: string,
): Promise<{ previewId: string; state: Record<string, unknown> }> {
  const pemHash = await sha256Digest(pemText);
  const state: Record<string, unknown> = {
    keyId,
    pemHash,
  };
  const previewId = await computePreviewId("rotate-key", state);
  return { previewId, state };
}
