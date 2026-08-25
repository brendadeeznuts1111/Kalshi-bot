#!/usr/bin/env bun
/**
 * verify:contracts — run ALL offline contract gates in parallel via
 * Bun-native Bun.spawn (Bun.which('bun') resolve, like runBunGate).
 * These are the pre-commit-conditional gates promoted to full CI:
 *   deps:check · docs:check · content:check · bun:blog-map (offline)
 *   colors:check · design:check
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
] as const;

const run = async (name: string, args: readonly string[]): Promise<boolean> => {
  const env = name === 'docs:api' ? { STRICT: '1' } : undefined;
  const r = await runBunCommand(['run', name, ...args], { cwd: ROOT, ...(env ? { env } : {}) });
  console.log((r.ok ? 'ok   ' : 'FAIL ') + name.padEnd(16) + r.lastLine.slice(0, 100));
  return r.ok;
};

const results = await Promise.all(gates.map(([name, ...args]) => run(name, args as readonly string[])));
const failed = results.filter((ok) => !ok).length;
console.log('verify:contracts — ' + (gates.length - failed) + '/' + gates.length + ' gates ok' + (failed ? ' · ' + failed + ' FAILED' : ''));
process.exit(failed === 0 ? 0 : 1);