// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { planPromoteNotify } from '../../src/inventory/promote-notify.ts';

describe('planPromoteNotify', () => {
  test('first non-empty set should send', () => {
    const r = planPromoteNotify(['a', 'b'], null, { nowMs: 1000 });
    expect(r.shouldSend).toBe(true);
    expect(r.reason).toBe('first');
    expect(r.newIds).toEqual(['a', 'b']);
  });

  test('unchanged set does not send', () => {
    const prev = { candidateIds: ['a', 'b'], sentAtMs: 500 };
    const r = planPromoteNotify(['b', 'a'], prev, { nowMs: 2000 });
    expect(r.shouldSend).toBe(false);
    expect(r.reason).toBe('unchanged');
    expect(r.next.sentAtMs).toBe(500);
  });

  test('new id triggers send', () => {
    const prev = { candidateIds: ['a'], sentAtMs: 500 };
    const r = planPromoteNotify(['a', 'c'], prev, { nowMs: 3000 });
    expect(r.shouldSend).toBe(true);
    expect(r.reason).toBe('new_ids');
    expect(r.newIds).toEqual(['c']);
  });

  test('empty candidates skip', () => {
    const r = planPromoteNotify([], { candidateIds: ['a'], sentAtMs: 1 }, { nowMs: 2 });
    expect(r.shouldSend).toBe(false);
    expect(r.reason).toBe('no_candidates');
  });

  test('force sends when non-empty', () => {
    const prev = { candidateIds: ['a'], sentAtMs: 1 };
    const r = planPromoteNotify(['a'], prev, { nowMs: 9, force: true });
    expect(r.shouldSend).toBe(true);
    expect(r.reason).toBe('force');
  });
});
