// @see https://bun.com/docs/test/writing-tests#matchers
import { describe, expect, test } from 'bun:test';
import {
  buildTableSchemaDocument,
  formatInspectTableFromRows,
  formatMarkdownTable,
  projectTableRows,
  resolveTableColumns,
  type TableFieldSpec,
} from '../../src/lib/table-schema.ts';

const FIELDS = [
  { key: 'name', type: 'string', description: 'Name', group: 'id' },
  { key: 'score', type: 'number', description: 'Score', group: 'metrics', align: 'right' },
  { key: 'note', type: 'string', description: 'Note', group: 'id', maxWidth: 8 },
] as const satisfies readonly TableFieldSpec[];

describe('table-schema', () => {
  test('resolveTableColumns expands presets and all', () => {
    const all = ['name', 'score', 'note'] as const;
    const presets = { desk: ['name', 'score'] as const };
    expect(resolveTableColumns(undefined, presets, all, presets.desk)).toEqual(['name', 'score']);
    expect(resolveTableColumns(['all'], presets, all, presets.desk)).toEqual(['name', 'score', 'note']);
    expect(resolveTableColumns(['desk'], presets, all, presets.desk)).toEqual(['name', 'score']);
    expect(resolveTableColumns(['score', 'name'], presets, all, presets.desk)).toEqual([
      'score',
      'name',
    ]);
  });

  test('project + markdown align numbers and truncate', () => {
    const rows = projectTableRows(
      [{ name: 'a', score: 12, note: 'abcdefghij' }],
      ['name', 'score', 'note'],
    );
    const md = formatMarkdownTable(rows, ['name', 'score', 'note'], {
      fields: FIELDS,
    });
    expect(md).toContain('| name | score | note |');
    expect(md).toMatch(/\| --- \| ---: \| --- \|/);
    expect(md).toContain('abcdefg…'); // maxWidth 8
  });

  test('inspect table returns non-empty', () => {
    const out = formatInspectTableFromRows([{ a: 1, b: 'x' }], ['a', 'b'], {
      colors: false,
    });
    expect(out).toContain('a');
    expect(out).toContain('x');
  });

  test('schema document groups fields', () => {
    const doc = buildTableSchemaDocument({
      schemaVersion: 1,
      description: 'test',
      fields: FIELDS,
      presets: { desk: ['name', 'score'] },
      defaultColumns: ['name', 'score'],
    });
    expect(doc.groups?.id).toEqual(['name', 'note']);
    expect(doc.groups?.metrics).toEqual(['score']);
    expect(doc.allColumns).toEqual(['name', 'score', 'note']);
  });
});
