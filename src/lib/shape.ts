/**
 * shape.ts - proper definitions for the §211 corrections: BunFile type guard
 * (Bun.File is a TYPE, not a runtime value) and a shape matcher with an
 * EXPLICIT '*' wildcard (Bun.deepMatch is NOT a wildcard matcher - it is
 * value-sensitive and requires actual keys to be present in expected).
 */
import type { BunFile } from 'bun';

/**
 * Type guard for a BunFile at runtime. Bun.File does NOT exist (typeof
 * undefined on 1.4.0, S211) - a BunFile is a Blob subclass with name/size/
 * type/path fields. This is the correct `x instanceof Bun.File` replacement.
 */
export function isBunFile(value: unknown): value is BunFile {
  if (typeof Blob === "undefined" || !(value instanceof Blob)) return false;
  const v = value as unknown as { name?: unknown; path?: unknown };
  return typeof v.name === "string" || typeof v.path === "string";
}

/**
 * Shape matcher with an explicit '*' wildcard - the proper definition of what
 * the S211 proposal wanted from Bun.deepMatch. Semantics:
 *   - '*' matches ANY value at that key (wildcard).
 *   - nested objects recurse (schema { a: { b: 1 } } matches actual { a: { b: 1, c: 2 } }).
 *   - arrays: schema array length 1 matches ANY length actual array, checking
 *     every element against the single schema item.
 *   - primitive schema values are compared with deepEquals semantics.
 * Unlike Bun.deepMatch, EXTRA actual keys are allowed (schema is a subset).
 */
export function shapeMatch(actual: unknown, schema: unknown): boolean {
  if (schema === "*") return true;
  if (schema === null) return actual === null;
  if (Array.isArray(schema)) {
    if (!Array.isArray(actual)) return false;
    if (schema.length === 0) return true;
    return actual.every((a) => shapeMatch(a, schema[0]));
  }
  if (typeof schema === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(schema as Record<string, unknown>).every(([k, v]) =>
      shapeMatch((actual as Record<string, unknown>)[k], v),
    );
  }
  // primitive schema: deepEquals-style compare (type + value sensitive)
  if (typeof schema === "number" && Number.isNaN(schema)) return typeof actual === "number" && Number.isNaN(actual);
  return Object.is(actual, schema);
}
