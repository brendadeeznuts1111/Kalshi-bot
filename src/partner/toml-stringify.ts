/**
 * TOML serialization through Bun's native API with a stable-runtime fallback.
 *
 * Project R is pinned to Bun 1.3.14, while `Bun.TOML.stringify` arrived on the
 * Bun 1.4 channel. Keep the compatibility decision at this one boundary so
 * callers and tests have the same behavior on stable and newer runtimes.
 *
 * This mirrors the governed helper at `~/Projects/lib/toml-stringify.ts`.
 *
 * @see https://bun.com/docs/runtime/toml#bun-toml-stringify
 */
import { TOML } from "bun";

type TomlScalar = string | number | bigint | boolean | Date;
type TomlValue = TomlScalar | TomlValue[] | TomlTable;
interface TomlTable {
  [key: string]: TomlValue | undefined;
}

function isTomlTable(value: TomlValue): value is TomlTable {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function parseTomlValue(
  value: unknown,
  path: string,
  ancestors: ReadonlySet<object>,
): TomlValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) throw new TypeError(`TOML cannot represent null (key '${path}')`);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError(`Invalid Date at '${path}'`);
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`Unsupported TOML value at '${path}': ${typeof value}`);
  }
  if (ancestors.has(value)) throw new TypeError(`Circular TOML value at '${path}'`);

  const nextAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const parsed = parseTomlValue(item, `${path}[${index}]`, nextAncestors);
      if (parsed === undefined) {
        throw new TypeError(`TOML arrays cannot contain undefined at '${path}[${index}]'`);
      }
      return parsed;
    });
  }

  const table: TomlTable = {};
  for (const key of Object.keys(value)) {
    table[key] = parseTomlValue(
      Reflect.get(value, key),
      path ? `${path}.${key}` : key,
      nextAncestors,
    );
  }
  return table;
}

function formatTomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function formatTomlPath(path: readonly string[]): string {
  return path.map(formatTomlKey).join(".");
}

function formatTomlScalar(value: TomlScalar): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && !Number.isFinite(value)) {
    if (Number.isNaN(value)) return "nan";
    return value < 0 ? "-inf" : "inf";
  }
  return String(value);
}

function isArrayOfTables(value: TomlValue): value is TomlTable[] {
  return Array.isArray(value) && value.length > 0 && value.every(isTomlTable);
}

function formatTomlArray(values: TomlValue[], path: readonly string[]): string {
  return `[${values
    .map((value, index) => {
      if (isTomlTable(value)) {
        throw new TypeError(
          `TOML inline arrays cannot contain tables at '${formatTomlPath(path)}[${index}]'`,
        );
      }
      return Array.isArray(value) ? formatTomlArray(value, path) : formatTomlScalar(value);
    })
    .join(", ")}]`;
}

function collectTomlBlocks(
  table: TomlTable,
  path: readonly string[],
  arrayTable: boolean,
): string[] {
  const lines: string[] = [];
  if (path.length > 0) {
    const name = formatTomlPath(path);
    lines.push(arrayTable ? `[[${name}]]` : `[${name}]`);
  }

  for (const [key, value] of Object.entries(table)) {
    if (value === undefined || isTomlTable(value) || isArrayOfTables(value)) continue;
    lines.push(
      `${formatTomlKey(key)} = ${
        Array.isArray(value)
          ? formatTomlArray(value, [...path, key])
          : formatTomlScalar(value)
      }`,
    );
  }

  const blocks = lines.length > 0 ? [lines.join("\n")] : [];
  for (const [key, value] of Object.entries(table)) {
    if (value === undefined) continue;
    if (isTomlTable(value)) {
      blocks.push(...collectTomlBlocks(value, [...path, key], false));
    } else if (isArrayOfTables(value)) {
      for (const item of value) blocks.push(...collectTomlBlocks(item, [...path, key], true));
    }
  }
  return blocks;
}

function fallbackTomlStringify<TValue>(value: TValue): string {
  const parsed = parseTomlValue(value, "", new Set());
  if (parsed === undefined || !isTomlTable(parsed)) {
    throw new TypeError("TOML root must be an object");
  }
  return `${collectTomlBlocks(parsed, [], false).join("\n\n")}\n`;
}

/** Serialize an object as TOML on both Bun 1.3.14 and Bun 1.4+. */
export function tomlStringify<TValue>(value: TValue): string {
  const nativeStringify = Reflect.get(TOML, "stringify");
  if (typeof nativeStringify === "function") return nativeStringify.call(TOML, value);
  return fallbackTomlStringify(value);
}
