// @see https://bun.com/docs/test/writing-tests#matchers
// @see https://bun.com/docs/runtime/utils#bun-randomuuidv7
import { describe, expect, test } from 'bun:test';
import { isUuidV7, mintSortableId, mintSortableIdBuffer } from '../../src/lib/ids.ts';

describe('ids · mintSortableId', () => {
  test('mints UUID v7 hex strings', () => {
    const id = mintSortableId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(isUuidV7(id)).toBe(true);
  });

  test('sequential mints are lexicographically non-decreasing', () => {
    // Process-local monotonicity (Bun bumps counter / timestamp on collision).
    const a = mintSortableId();
    const b = mintSortableId();
    expect(a <= b).toBe(true);
    const t = Date.now();
    const c = mintSortableId(t);
    const d = mintSortableId(t);
    expect(c <= d).toBe(true);
    expect(isUuidV7(c)).toBe(true);
    expect(isUuidV7(d)).toBe(true);
  });

  test('buffer encoding is 16 bytes', () => {
    const buf = mintSortableIdBuffer();
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf).toHaveLength(16);
  });

  test('isUuidV7 rejects v4 and garbage', () => {
    expect(isUuidV7(crypto.randomUUID())).toBe(false);
    expect(isUuidV7('not-a-uuid')).toBe(false);
    expect(isUuidV7('')).toBe(false);
  });
});
