// @see https://bun.com/docs/runtime/utils#bun-inspect-custom
/**
 * Recursive secret redaction for logging (compliance).
 *
 * Returns a deep clone with keys matching password/token/secret/… replaced
 * by a marker — the INPUT IS NEVER MUTATED. Circular references become
 * [Circular]; Date and typed arrays pass through untouched.
 */

/** Keys considered secret (case-insensitive substring). */
export const SECRET_KEY_RE =
  /pass|token|secret|authorization|api[_-]?key|credential|pwd|private[_-]?key/i;

export type RedactOptions = {
  /** Replacement for secret values. Default "🔒 REDACTED". */
  marker?: string;
  keyRe?: RegExp;
};

/**
 * Redact secrets in an arbitrary value without mutating it.
 * @example redactSecrets({ password: "hunter2", meta: { apiToken: "sk-1" } })
 *   -> { password: "🔒 REDACTED", meta: { apiToken: "🔒 REDACTED" } }
 */
export function redactSecrets<T>(value: T, options: RedactOptions = {}): T {
  const marker = options.marker ?? "🔒 REDACTED";
  const keyRe = options.keyRe ?? SECRET_KEY_RE;
  const seen = new WeakSet<object>();

  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[Circular]";
    seen.add(v);
    if (v instanceof Date) return v;
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return v;
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = keyRe.test(k) ? marker : walk(val);
    }
    return out;
  };

  return walk(value) as T;
}
