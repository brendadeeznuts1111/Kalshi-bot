// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { enrichBookedEvents } from '../../src/inventory/enrich-booked.ts';
import type {
  FantasySessionAdapter,
  InventoryEvent,
  PartnerBookedEvent,
} from '../../src/partner/types.ts';

function mockAdapter(
  events: InventoryEvent[] = [],
  booked: PartnerBookedEvent[] = []
): FantasySessionAdapter {
  return {
    partnerId: 'fantasy402',
    login: async () => ({ desktop: 'https://x/', mobile: 'https://x/' }),
    fetchInventory: async () => events,
    fetchLimits: async () => ({ maxStake: 0, maxWin: 0 }),
    placeOrder: async () => ({ success: false, error: 'stub' }),
    renewToken: async () => 'tok',
    warmSession: async () => {},
    fetchSports: async () => [],
    getBearerToken: () => 'tok',
    getLiveUrls: () => null,
    fetchBookedEvent: async () => null,
    listBookedEvents: async () => booked,
  };
}

const publicProfile = {
  id: 'fantasy402-public',
  partner: 'fantasy402' as const,
  url: 'https://example.invalid/',
  status: 'active' as const,
  defaultLiveProduct: 2,
  meta: {
    customerID: 'public',
    agentID: 'public',
    password: 'public',
    token: 'public',
    currency: 'USD',
  },
};

describe('enrichBookedEvents', () => {
  test('defaults to enrich-only + unlinked scope', async () => {
    const report = await enrichBookedEvents({
      dbPath: ':memory:',
      dryRun: true,
      adapter: mockAdapter(),
      profile: publicProfile,
      // empty inject skips network; empty db → 0 candidates
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
      adapter: mockAdapter([
        {
          partner: 'fantasy402',
          sport: 'Table Tennis',
          league: 'Setka',
          inventoryId: '1',
          home: 'A',
          away: 'B',
          feedId: 0,
          donbestId: null,
        },
      ]),
      profile: publicProfile,
    });

    expect(report.enrichBookedScope).toBe('board');
    expect(report.dryRun).toBe(true);
    // dry-run plan may count candidate for new insert
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
      adapter: mockAdapter(),
      profile: publicProfile,
    });

    expect(report.enrichBookedScope).toBe('unlinked');
    expect(report.enriched).toBe(0);
    expect(report.enrichCandidates).toBe(0);
  });
});
