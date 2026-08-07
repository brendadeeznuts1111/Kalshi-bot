#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/toml#bun-toml-stringify
/**
 * Convert any JSON artifact to TOML.
 *
 * Usage:
 *   bun scripts/export-toml.ts path/to/file.json
 *   bun run export:toml ./research/seed/tournament-tiers.json
 *
 * Output: writes file.toml alongside the input JSON.
 * Validates against TOML restrictions (no null/undefined in arrays, no BigInt).
 */
import { tomlStringify } from "../src/partner/toml-stringify.ts";

function findUndefinedInArray(value: unknown[], path: string): string | null {
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (item === undefined) {
      return `TOML arrays cannot contain undefined (hole). Found at ${path}[${i}]`;
    }
    if (Array.isArray(item)) {
      const inner = findUndefinedInArray(item, `${path}[${i}]`);
      if (inner) return inner;
    } else if (typeof item === "object" && item !== null) {
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        if (v === undefined) {
          return `TOML tables cannot contain undefined. Found at ${path}[${i}].${k}`;
        }
      }
    }
  }
  return null;
}

function validateForToml(data: unknown, path = "$"): string | null {
  if (data === null) return "TOML cannot represent null at top level";
  if (Array.isArray(data)) {
    return findUndefinedInArray(data, path);
  }
  if (typeof data === "object") {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (v === undefined) continue; // skipped by the governed serializer
      if (Array.isArray(v)) {
        const err = findUndefinedInArray(v, `${path}.${k}`);
        if (err) return err;
      } else if (typeof v === "object" && v !== null) {
        const err = validateForToml(v, `${path}.${k}`);
        if (err) return err;
      }
    }
  }
  return null;
}

async function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error("Usage: bun scripts/export-toml.ts <path-to-json>");
    process.exit(1);
  }

  const file = Bun.file(jsonPath);
  if (!(await file.exists())) {
    console.error(`File not found: ${jsonPath}`);
    process.exit(1);
  }

  let data: unknown;
  try {
    data = await file.json();
  } catch (err) {
    console.error(`Invalid JSON in ${jsonPath}: ${err}`);
    process.exit(1);
  }

  // Validate before stringifying
  const validationError = validateForToml(data);
  if (validationError) {
    console.error(`Cannot convert to TOML: ${validationError}`);
    process.exit(1);
  }

  try {
    const toml = tomlStringify(data).trimEnd();
    const tomlPath = jsonPath.replace(/\.json$/i, ".toml");
    await Bun.write(tomlPath, toml + "\n");
    console.log(`✅ ${jsonPath} → ${tomlPath}`);
  } catch (err) {
    console.error(`TOML serialization failed: ${err}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
