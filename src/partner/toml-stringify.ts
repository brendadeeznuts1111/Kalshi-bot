// @see https://bun.com/docs/runtime/toml#bun-toml-stringify
/**
 * TOML serialization via native Bun.TOML.stringify (Bun >= 1.4.0, the pinned
 * baseline). The pre-1.4 manual serializer fallback was removed when the repo
 * pinned Bun 1.4.0 (packageManager, engines, AGENTS.md); see git history for
 * the old fallback implementation.
 */
import { TOML } from "bun";

/** Serialize an object as TOML. */
export function tomlStringify<TValue>(value: TValue): string {
  const out = TOML.stringify(value);
  if (out === undefined) {
    throw new TypeError("TOML.stringify could not represent the given value");
  }
  return out;
}