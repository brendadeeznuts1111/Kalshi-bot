// @see https://bun.com/docs/runtime/utils#bun-escapehtml
/** HTML escaping SSOT — delegates to Bun.escapeHTML (SIMD-native). */
export function escapeHtml(value: string): string {
  return Bun.escapeHTML(value);
}

// @see https://bun.com/docs/runtime/utils#bun-deepequals
export function deepEqual<T>(a: T, b: T, strict = false): boolean {
  return Bun.deepEquals(a, b, strict);
}

// @see https://bun.com/docs/runtime/hashing#bun-hash
export function stableHash(input: string): string {
  return Bun.hash(input).toString(16);
}

// @see https://bun.com/docs/runtime/utils#bun-inspect
export function inspectBrief(value: unknown, depth = 2): string {
  return Bun.inspect(value, { colors: false, depth });
}

/**
 * TTY-oriented snapshot dump — `Bun.inspect(snapshot, { colors, depth, sorted })`.
 * Defaults: colors off (caller enables for TTY), depth 4, sorted true.
 * @see https://bun.com/docs/runtime/utils#bun-inspect
 */
export type InspectSnapshotOptions = {
  colors?: boolean;
  depth?: number;
  sorted?: boolean;
};

export function inspectSnapshot(
  snapshot: unknown,
  options: InspectSnapshotOptions = {},
): string {
  const colors = options.colors ?? false;
  const depth = options.depth ?? 4;
  const sorted = options.sorted ?? true;
  // @see https://bun.com/docs/runtime/utils#bun-inspect
  return Bun.inspect(snapshot, { colors, depth, sorted });
}

// @see https://bun.com/docs/runtime/utils#bun-path-to-fileurl
export function absPathToFileUrl(absPath: string): string {
  return Bun.pathToFileURL(absPath).href;
}

// @see https://bun.com/docs/runtime/utils#bun-fileurl-to-path
export function fileUrlToAbsPath(url: string | URL): string {
  return Bun.fileURLToPath(url instanceof URL ? url : new URL(url));
}
