/**
 * Bun.Archive round-trip (tools/bun-backup.ts path): create a tarball via
 * Bun.Archive.write with BYTES values (BunFile values archive 0-byte
 * entries on 1.4.0 - probe-verified bug), extract, compare. The backup
 * tool depends on this invariant, so it is locked in a test.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'archive-test-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('Bun.Archive round-trip', () => {
  test('bytes values survive write -> extract intact', async () => {
    const payload = 'round-trip-content-' + 'x'.repeat(1000);
    const tarPath = join(dir, 'out.tar');
    const bytes = new TextEncoder().encode(payload);
    await Bun.Archive.write(tarPath, { 'data.txt': bytes });
    const archive = new Bun.Archive(await Bun.file(tarPath).bytes());
    const out = join(dir, 'extracted');
    const count = await archive.extract(out);
    expect(count).toBe(1);
    expect(readFileSync(join(out, 'data.txt'), 'utf8')).toBe(payload);
  });

  test('BunFile values archive as 0-byte entries on 1.4.0 (documented bug)', async () => {
    const src = join(dir, 'src.txt');
    writeFileSync(src, 'should-not-be-empty');
    const tarPath = join(dir, 'file.tar');
    await Bun.Archive.write(tarPath, { 'src.txt': Bun.file(src) });
    const archive = new Bun.Archive(await Bun.file(tarPath).bytes());
    const out = join(dir, 'extracted-file');
    await archive.extract(out);
    const size = (await Bun.file(join(out, 'src.txt')).stat()).size;
    // BunFile source -> 0-byte entry (the bug the tool works around).
    expect(size).toBe(0);
  });
});