// @see https://bun.com/docs/test
import { describe, expect, test } from 'bun:test';
import {
  appendOutcomeResolutions,
  appendShadowLogEntry,
  brierScore,
  materializeShadowLines,
  normalizeShadowOutcome,
  readShadowLogEntries,
  voidOutcomeCount,
} from '../../src/institutions/shadow-line.ts';
import { joinPath } from '../../src/research/paths.ts';

describe('shadow ternary outcomes', () => {
  test('normalizeShadowOutcome accepts void/push', () => {
    expect(normalizeShadowOutcome(0)).toBe(0);
    expect(normalizeShadowOutcome(1)).toBe(1);
    expect(normalizeShadowOutcome('void')).toBe('void');
    expect(normalizeShadowOutcome('push')).toBe('void');
    expect(normalizeShadowOutcome('nope')).toBeUndefined();
  });

  test('void excluded from Brier; counted separately', async () => {
    const dir = joinPath(import.meta.dir, '.tmp-void-brier');
    await Bun.$`rm -rf ${dir}`.quiet();
    await Bun.$`mkdir -p ${dir}`.quiet();
    const logPath = joinPath(dir, 'shadow.jsonl');

    const book = {
      ts: 1,
      bids: [{ priceCents: 55, size: 10 }],
      asks: [{ priceCents: 57, size: 10 }],
      seq: 1,
    };
    const tox = { dueTs: -1, markedTs: null, midCents: null, movedAgainst: null };
    const decision = { action: 'trade' as const, side: 'yes' as const, contracts: 5, reason: 'test' };

    await appendShadowLogEntry(logPath, {
      kind: 'prediction',
      ts: 1,
      program: 'void-test',
      ticker: 'KXTEST-1',
      eventId: 'e-win',
      pModel: 0.8,
      components: {},
      book,
      decision,
      rawEdgeCents: 3,
      feePerContractCents: 1,
      vwapFillCents: 56,
      filledContracts: 5,
      midAtFillCents: 56,
      toxicity: tox,
      outcome: null,
    });
    await appendShadowLogEntry(logPath, {
      kind: 'prediction',
      ts: 2,
      program: 'void-test',
      ticker: 'KXTEST-2',
      eventId: 'e-void',
      pModel: 0.9,
      components: {},
      book,
      decision,
      rawEdgeCents: 3,
      feePerContractCents: 1,
      vwapFillCents: 56,
      filledContracts: 5,
      midAtFillCents: 56,
      toxicity: tox,
      outcome: null,
    });

    await appendOutcomeResolutions(logPath, 'void-test', {
      'e-win': 1,
      'e-void': 'void',
    });

    const lines = materializeShadowLines(await readShadowLogEntries(logPath));
    expect(lines.find(l => l.eventId === 'e-void')?.outcome).toBe('void');
    expect(lines.find(l => l.eventId === 'e-win')?.outcome).toBe(1);
    expect(voidOutcomeCount(lines)).toBe(1);
    // Brier only on win line: (0.8 - 1)^2 = 0.04
    expect(brierScore(lines)).toBeCloseTo(0.04, 5);

    await Bun.$`rm -rf ${dir}`.quiet();
  });
});
