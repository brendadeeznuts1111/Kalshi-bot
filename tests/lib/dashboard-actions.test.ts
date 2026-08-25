// Dashboard action contract (§74): every action pushed by a collector
// must have an implemented handler in serve.ts — dead buttons are a bug.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

function pushedActions(): Set<string> {
  const src = readFileSync(join(ROOT, "src/institutions/signal-pipeline.ts"), "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/action: \x27([a-z:.-]+)\x27/g)) out.add(m[1]!);
  return out;
}

function implementedActions(): Set<string> {
  const src = readFileSync(join(ROOT, "src/research/serve.ts"), "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/name === \x22([a-z:.-]+)\x22/g)) out.add(m[1]!);
  return out;
}

describe("dashboard action contract (§74)", () => {
  test("every pushed action has an implemented handler (no dead buttons)", () => {
    const pushed = pushedActions();
    const implemented = implementedActions();
    const dead = [...pushed].filter((a) => !implemented.has(a));
    expect(dead).toEqual([]);
  });
});