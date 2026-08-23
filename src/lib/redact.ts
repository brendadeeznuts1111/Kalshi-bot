// @see https://bun.com/docs/runtime/utils#bun-inspect-custom
/**
 * Recursive secret redaction for logging (compliance).
 *
 * redactSecrets returns a deep clone with secret keys replaced by a marker;
 * the INPUT IS NEVER MUTATED. Circular references become [Circular]; Date and
 * typed arrays pass through. Recursion is bounded by the depth option.
 *
 * The RedactedClone<T> mapped type mirrors the shape: secret-keyed properties
 * become the marker type, everything else keeps its structure.
 */

/** Keys considered secret (case-insensitive substring). */
export const SECRET_KEY_RE =
  /pass|token|secret|authorization|api[_-]?key|credential|pwd|private[_-]?key|gsid/i;

export type RedactedMarker = "🔒 REDACTED";

export const REDACTED_MARKER: RedactedMarker = "🔒 REDACTED";

/**
 * Type-level mirror of SECRET_KEY_RE (approximation: template-literal matching
 * is case-sensitive; covered with lowercase + Camel/Pascal variants).
 */
type SecretKeyLike =
  `${string}${
    | "pass" | "token" | "secret" | "authorization"
    | "credential" | "pwd" | "gsid" | "key"
  }${string}`
  | `${string}${"Password" | "Token" | "Secret" | "Authorization" | "Credential" | "Pwd" | "GSID" | "Key"}${string}`;

/**
 * Shape of a value after redaction: secret-keyed props become the marker.
 * Preserves Dates, typed arrays, arrays, and nested structure.
 */
export type RedactedClone<T> = T extends Date | ArrayBuffer
  ? T
  : T extends ArrayBufferView
    ? T
    : T extends ReadonlyArray<infer U>
      ? RedactedClone<U>[]
      : T extends object
        ? {
            [K in keyof T]: K extends SecretKeyLike
              ? RedactedMarker
              : RedactedClone<T[K]>;
          }
        : T;

export type RedactOptions = {
  /** Replacement for secret values. Default REDACTED_MARKER. */
  marker?: string;
  keyRe?: RegExp;
  /** Max recursion depth (guards pathological nesting). Default 32. */
  depth?: number;
};

const DEFAULT_REDACT_DEPTH = 32;

/**
 * Redact secrets in an arbitrary value without mutating it.
 * @example redactSecrets({ password: "hunter2", meta: { apiToken: "sk-1" } })
 *   -> { password: "🔒 REDACTED", meta: { apiToken: "🔒 REDACTED" } }
 */
export function redactSecrets<T>(value: T, options: RedactOptions = {}): RedactedClone<T> {
  const marker = options.marker ?? REDACTED_MARKER;
  const keyRe = options.keyRe ?? SECRET_KEY_RE;
  const maxDepth = options.depth ?? DEFAULT_REDACT_DEPTH;
  const seen = new WeakSet<object>();

  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (depth <= 0) return "[DepthLimit]";
    if (seen.has(v)) return "[Circular]";
    seen.add(v);
    if (v instanceof Date) return v;
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return v;
    if (Array.isArray(v)) return v.map((item) => walk(item, depth - 1));
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = keyRe.test(k) ? marker : walk(val, depth - 1);
    }
    return out;
  };

  return walk(value, maxDepth) as RedactedClone<T>;
}

/** Query-param keys that commonly carry session/token values. */
export const SECRET_QUERY_KEY_RE = /gsid|token|key|pass|auth|session/i;

/**
 * Redact sensitive query params from a URL string without mutating it.
 * Redacts keys matching SECRET_QUERY_KEY_RE (or all keys when redactAll).
 * Returns the original string when it is not a valid URL.
 */
export function redactUrlParams(
  url: string,
  options: { redactAll?: boolean; keyRe?: RegExp } = {},
): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const keyRe = options.keyRe ?? SECRET_QUERY_KEY_RE;
  let changed = false;
  for (const [k, v] of [...parsed.searchParams.entries()]) {
    if (options.redactAll || keyRe.test(k)) {
      parsed.searchParams.set(k, REDACTED_MARKER);
      changed = true;
    }
  }
  return changed ? parsed.toString() : url;
}