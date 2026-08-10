// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { enrichBookedEvents } from '../../src/inventory/enrich-booked.ts';
import {
  liveEvent,
  mockFantasyAdapter,
  publicFantasyProfile,
} from './fixtures.ts';

describe('enrichBookedEvents', () => {
  test('defaults to enrich-only + unlinked scope', async () => {
    const report = await enrichBookedEvents({
      dbPath: ':memory:',
      dryRun: true,
      adapter: mockFantasyAdapter(),
      profile: publicFantasyProfile(),
      bookedCatalog: [],
    });

    expect(report.enrichBookedScope).toBe('unlinked');
    expect(report.dryRun).toBe(true);
    expect(report.enrichCandidates).toBe(0);
    expect(report.enriched).toBe(0);
  });

  test('enrichOnly=false with board scope reports board', async () => {
    const report = await enrichBookedEvents({
      dbPath: ':memory:',
      dryRun: true,
      enrichOnly: false,
      enrichBookedScope: 'board',
      bookedCatalog: [
        {
          oddsEventId: '99',
          name: 'A - B',
          sportName: 'Table Tennis',
        },
      ],
      adapter: mockFantasyAdapter([
        liveEvent(1, 'Table Tennis', 'A', 'B', 'Setka'),
      ]),
      profile: publicFantasyProfile(),
    });

    expect(report.enrichBookedScope).toBe('board');
    expect(report.dryRun).toBe(true);
    expect(report.enrichCandidates).toBeGreaterThanOrEqual(0);
  });

  test('injected catalog with empty unlinked set matches nothing', async () => {
    const report = await enrichBookedEvents({
      dbPath: ':memory:',
      dryRun: true,
      enrichOnly: true,
      bookedCatalog: [
        {
          oddsEventId: '99',
          name: 'A - B',
          sportName: 'Table Tennis',
        },
      ],
      adapter: mockFantasyAdapter(),
      profile: publicFantasyProfile(),
    });

    expect(report.enrichBookedScope).toBe('unlinked');
    expect(report.enriched).toBe(0);
    expect(report.enrichCandidates).toBe(0);
  });
});
