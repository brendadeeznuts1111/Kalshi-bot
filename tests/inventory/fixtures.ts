// @see https://bun.com/docs/test/index#run-tests
/**
 * Shared inventory test fixtures (bulk SSOT).
 */
import { openEventStore } from '../../src/institutions/event-store/open-db.ts';
import type { CoefficientLine } from '../../src/partner/fantasy-ultra/coefficients.ts';
import type {
  FantasySessionAdapter,
  InventoryEvent,
  PartnerBookedEvent,
} from '../../src/partner/types.ts';
export { publicFantasyProfile } from '../../src/inventory/public-profile.ts';

export function memoryDb() {
  return openEventStore({ dbPath: ':memory:' });
}

export function liveEvent(
  inventoryId: number | string,
  sport: string,
  home: string,
  away: string,
  league = 'Test League'
): InventoryEvent {
  return {
    partner: 'fantasy402',
    sport,
    league,
    inventoryId: String(inventoryId),
    home,
    away,
    feedId: 0,
    donbestId: null,
  };
}

export function mockFantasyAdapter(
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

export function coeffLine(
  over: Partial<CoefficientLine> &
    Pick<CoefficientLine, 'period' | 'marketType' | 'selection' | 'decimal'>
): CoefficientLine {
  return {
    eventId: over.eventId ?? 1,
    period: over.period,
    marketType: over.marketType,
    selection: over.selection,
    decimal: over.decimal,
    american: over.american ?? -110,
    line: over.line,
    sideIndex: over.sideIndex,
  };
}
