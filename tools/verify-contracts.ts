#!/usr/bin/env bun
/**
 * verify:contracts — run ALL offline contract gates in parallel via
 * Bun-native Bun.spawn (Bun.which('bun') resolve, like runBunGate).
 * These are the pre-commit-conditional gates promoted to full CI:
 *   deps:check · docs:check · content:check · bun:blog-map (offline)
 *   colors:check · design:check · docs:refresh (offline triple-lock)
 * Each is offline + sub-second; parallel fan-out keeps the whole thing
 * ~the slowest single gate. Exit 1 if any gate fails.
 */
import { join } from 'node:path';
import { runBunCommand } from '../src/lib/run-bun.ts';

const ROOT = join(import.meta.dir, '..');

const gates = [
  ['deps:check'],
  ['docs:check'],
  ['docs:api'], // STRICT=1 env set in run() below
  ['docs:integrity'], // STRICT callability via env — runBunCommand passes env through? check
  ['content:check'],
  ['assets:check'],
  ['bun:blog-map', '--', '--offline'],
  ['colors:check'],
  ['design:check'],
  ['plugins:probe'],
  ['xml:probe'],
  ['image:probe'],
  ['infra:probe'],
  ['csrf:probe'],
  ['cookies:probe'],
  ['defaults:probe'],
  ['licenses:gate'],
  ['bun:build-probe'],
  ['docs:refresh'],
  ['routes:check'],
  ['bun:coverage-audit'],
  ['sqlite:probe'],
  ['serve-stream:probe'],
  ['spawn:probe'],
  ['ws:probe'],
  ['bun:apis-probe'],
  ['routes:probe'],
  ['serve-tls:probe'],
  ['shell:probe'],
  ['html:probe'],
  ['build-deep:probe'],
  ['fs:probe'],
  ['ansi:probe'],
  ['crypto:probe'],
  ['format:probe'],
  ['fsx:probe'],
  ['net:probe'],
  ['runtime:probe'],
  ['test:probe'],
  ['fetch:probe'],
  ['node-compat:probe'],
  ['transpiler:probe'],
  ['sqlite-deep:probe'],
  ['h2:probe'],
  ['metafile:probe'],
  ['ecosystem:probe'],
  ['surface:probe'],
  ['version:probe'],
  ['type-drift:probe'],
  ['shape:probe'], // §169 full-shape runtime agreement
  ['etag:probe'], // §176 automatic ETag/304 behavior (P3 docs-corrected)
  ['build-artifact:probe'], // §177 BuildArtifact gotchas (P3/P3b docs-corrected)
  ['client-shape:probe'],
  ['coverage:probe'],
  ['fullstack:probe'],
] as const;

const GATE_ENV: Record<string, Record<string, string>> = {
  'docs:api': { STRICT: '1' },
  'docs:refresh': { BUN_DOCS_REFRESH_SKIP_NETWORK: '1' },
};

const run = async (name: string, args: readonly string[]): Promise<boolean> => {
  const env = GATE_ENV[name];
  const r = await runBunCommand(['run', name, ...args], { cwd: ROOT, ...(env ? { env } : {}) });
  console.log((r.ok ? 'ok   ' : 'FAIL ') + name.padEnd(16) + r.lastLine.slice(0, 100));
  return r.ok;
};

const results = await Promise.all(gates.map(([name, ...args]) => run(name, args as readonly string[])));
const failed = results.filter((ok) => !ok).length;
console.log('verify:contracts — ' + (gates.length - failed) + '/' + gates.length + ' gates ok' + (failed ? ' · ' + failed + ' FAILED' : ''));
process.exit(failed === 0 ? 0 : 1);