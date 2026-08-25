/**
 * bun-shape (tools/bun-shape.json §168/§169) + bun-gates
 * (src/lib/bun-gates.ts §169/§170): the committed full-shape file must
 * stay fresh against the INSTALLED runtime, and the gate map must
 * resolve members (own gate, namespace inheritance, GAP).
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gateFor } from '../../src/lib/bun-gates.ts';

const shape = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'tools', 'bun-shape.json'), 'utf8'));

describe('bun-shape.json (§168/§169)', () => {
  test('shape file is pinned to the installed runtime (drift fails here)', () => {
    expect(shape.bunVersion).toBe(Bun.version);
    expect(shape.bunRevision).toBe(Bun.revision);
  });

  test('members carry valid kinds and no internal noise', () => {
    const valid = new Set(['function', 'class', 'object', 'namespace', 'type']);
    for (const m of shape.members) expect(valid.has(m.kind)).toBe(true);
    expect(shape.members.some((m: any) => m.name === '__internal')).toBe(false);
  });

  test('FFI is classified as a documented runtime extension', () => {
    const ffi = shape.members.find((m: any) => m.name === 'FFI' && !m.ns);
    expect(ffi?.extension).toBe(true);
    expect((Bun as any).FFI).toBeDefined();
  });

  test('declared top-level values exist at runtime (S2)', () => {
    const missing = shape.members.filter(
      (m: any) => !m.ns && !m.typeOnly && m.kind !== 'namespace' && !m.extension && (Bun as any)[m.name] === undefined
    );
    expect(missing).toEqual([]);
  });

  test('every live top-level member is mapped (S3)', () => {
    const names = new Set(shape.members.filter((m: any) => !m.ns).map((m: any) => m.name));
    expect(Object.keys(Bun).filter((k) => !names.has(k))).toEqual([]);
  });

  test('bun:* reference module plane present (§175)', () => {
    const mods = shape.modules ?? {};
    expect(mods['bun:sqlite']?.some((m: any) => m.name === 'Database' && !m.typeOnly)).toBe(true);
    expect(mods['bun:test']?.some((m: any) => m.name === 'expect')).toBe(true);
    expect(mods['bun:test']?.some((m: any) => m.name === 'expectTypeOf')).toBe(true);
    expect(mods['bun:ffi']?.some((m: any) => m.name === 'dlopen')).toBe(true);
    expect(mods['bun:jsc']?.some((m: any) => m.name === 'jscDescribe')).toBe(true);
  });
});

describe('bun-gates gateFor (§169/§170)', () => {
  test('own gate wins', () => {
    expect(gateFor({ name: 'file', ns: '' })).toBe('fs:probe');
    expect(gateFor({ name: 'serve', ns: '' })).toBe('serve-tls/routes');
  });

  test('namespace inheritance for sub-namespace members', () => {
    expect(gateFor({ name: 'parse', ns: 'TOML' })).toBe('format:probe (ns)');
    expect(gateFor({ name: 'satisfies', ns: 'semver' })).toBe('bun:apis-probe (ns)');
  });

  test('GAP when no gate applies', () => {
    expect(gateFor({ name: 'readableStreamToFormData', ns: '' })).toBe('runtime:probe'); // §171 closure
    expect(gateFor({ name: 'sleepSync', ns: '' })).toBe('runtime:probe');
    expect(gateFor({ name: 'someUnknown', ns: '' })).toBe('GAP');
  });
});
