// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { argValue, argValues, hasFlag } from '../../src/cli/argv.ts';

describe('cli argv SSOT', () => {
  const argv = [
    'bun',
    'tool.ts',
    '--json',
    '--id=99',
    '--period',
    'm',
    '--event-type',
    'A,B',
    '--event-type',
    'C',
  ];

  test('hasFlag / argValue / argValues', () => {
    expect(hasFlag('json', argv)).toBe(true);
    expect(hasFlag('missing', argv)).toBe(false);
    expect(argValue('id', argv)).toBe('99');
    expect(argValue('period', argv)).toBe('m');
    expect(argValues('event-type', argv)).toEqual(['A', 'B', 'C']);
  });
});
