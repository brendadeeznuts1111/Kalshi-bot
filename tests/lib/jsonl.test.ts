// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  JsonlChunkParser,
  parseJsonlText,
  readJsonlFile,
} from '../../src/lib/jsonl.ts';

const enc = new TextEncoder();

describe('parseJsonlText', () => {
  test('parses clean multi-line JSONL', () => {
    const { values, errors } = parseJsonlText('{"a":1}\n{"b":2}\n');
    expect(values).toEqual([{ a: 1 }, { b: 2 }]);
    expect(errors).toEqual([]);
  });

  test('skip-and-continue: bad line mid-file keeps values AFTER it', () => {
    // Regression guard: raw Bun.JSONL.parse truncates at the first bad line
    // (returns [{"a":1}] silently); the helper must keep [{"c":3}].
    const { values, errors } = parseJsonlText('{"a":1}\nNOT_JSON\n{"c":3}\n');
    expect(values).toEqual([{ a: 1 }, { c: 3 }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.line).toBe(2);
    expect(errors[0]!.raw).toBe('NOT_JSON');
  });

  test('all-bad input yields no values and one error per line', () => {
    const { values, errors } = parseJsonlText('BAD\nWORSE\n');
    expect(values).toEqual([]);
    expect(errors.map((e) => e.line)).toEqual([1, 2]);
  });

  test('blank lines are ignored, line numbers stay 1-based', () => {
    const { values, errors } = parseJsonlText('\n{"a":1}\n\nBAD\n{"b":2}\n');
    expect(values).toEqual([{ a: 1 }, { b: 2 }]);
    expect(errors[0]!.line).toBe(4);
  });

  test('scalars, BOM, and multibyte UTF-8 values', () => {
    const scalars = parseJsonlText('1\n"hi"\ntrue\nnull\n[1,2]\n');
    expect(scalars.values).toEqual([1, 'hi', true, null, [1, 2]]);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('{"x":9}\n')]);
    const fromBytes = parseJsonlText(new TextDecoder().decode(bom));
    expect(fromBytes.values).toEqual([{ x: 9 }]);
    const mb = parseJsonlText('{"s":"héllo"}\n');
    expect(mb.values).toEqual([{ s: 'héllo' }]);
  });
});

describe('JsonlChunkParser (streaming)', () => {
  test('arbitrary chunk splits yield the same result as whole input', () => {
    const data = enc.encode('{"a":1}\n{"b":2}\n{"c":3}\n{"d":4}\n');
    const p = new JsonlChunkParser<Record<string, number>>();
    for (let i = 0; i < data.length; i += 3) {
      p.feed(data.slice(i, i + 3));
    }
    const values = p.finish();
    expect(values).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }]);
    expect(p.errors).toEqual([]);
  });

  test('skips a bad line that spans a chunk boundary and continues', () => {
    const data = enc.encode('{"a":1}\nBAD_LINE\n{"c":3}\n');
    const p = new JsonlChunkParser<Record<string, number>>();
    for (let i = 0; i < data.length; i += 2) {
      p.feed(data.slice(i, i + 2));
    }
    const values = p.finish();
    expect(values).toEqual([{ a: 1 }, { c: 3 }]);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0]!.raw).toBe('BAD_LINE');
  });

  test('final line without trailing newline is parsed by finish()', () => {
    const p = new JsonlChunkParser<Record<string, number>>();
    p.feed(enc.encode('{"a":1}\n'));
    const rest = p.finish(); // finish() returns all accumulated values
    expect(rest).toEqual([{ a: 1 }]);
    const p2 = new JsonlChunkParser<Record<string, number>>();
    p2.feed(enc.encode('{"a":1}\n{"b":2}'));
    expect(p2.finish()).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test('incomplete value at chunk end waits for more bytes', () => {
    const p = new JsonlChunkParser<Record<string, number>>();
    expect(p.feed(enc.encode('{"a":1}\n{"b'))).toEqual([{ a: 1 }]);
    expect(p.feed(enc.encode('":2}\n'))).toEqual([{ b: 2 }]);
  });

  test('string chunks are accepted (UTF-8 encoded internally)', () => {
    const p = new JsonlChunkParser<Record<string, number>>();
    p.feed('{"a":1}\n');
    p.feed('{"b":2}\n');
    expect(p.finish()).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test('multibyte string content survives the byte-based parser', () => {
    const p = new JsonlChunkParser<Record<string, string>>();
    p.feed('{"s":"héllo"}\n');
    p.feed('{"t":"wörld"}\n');
    expect(p.finish()).toEqual([{ s: 'héllo' }, { t: 'wörld' }]);
  });

  test('a bad line in the first chunk does not stall later feeds (error-loop guard)', () => {
    // The naive buffer.slice(read) pattern loops forever on a bad line
    // because read never advances past the error; the parser must skip it.
    const p = new JsonlChunkParser<Record<string, number>>();
    expect(p.feed(enc.encode('{"a":1}\nBAD\n'))).toEqual([{ a: 1 }]);
    expect(p.errors).toHaveLength(1);
    expect(p.feed(enc.encode('{"c":3}\n'))).toEqual([{ c: 3 }]);
    expect(p.finish()).toEqual([{ a: 1 }, { c: 3 }]);
    expect(p.errors).toHaveLength(1);
  });
});

describe('readJsonlFile', () => {
  test('streams a file with a bad line, reporting errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jsonl-'));
    const path = join(dir, 'events.jsonl');
    await Bun.write(path, '{"a":1}\nBROKEN\n{"c":3}\n');
    const { values, errors, bytes } = await readJsonlFile<Record<string, number>>(path);
    expect(values).toEqual([{ a: 1 }, { c: 3 }]);
    expect(errors[0]!.raw).toBe('BROKEN');
    expect(bytes).toBe(23);
    await rm(dir, { recursive: true, force: true });
  });

  test('empty file yields empty result', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jsonl-'));
    const path = join(dir, 'empty.jsonl');
    await Bun.write(path, '');
    const { values, errors } = await readJsonlFile(path);
    expect(values).toEqual([]);
    expect(errors).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });
});
