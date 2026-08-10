// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  formatEventValidate,
  validateEvent,
  verdictFromPlanes,
  type EventValidateReport,
  type PlaneResult,
} from '../../src/inventory/event-validate.ts';
import type { EventLookupResult } from '../../src/inventory/event-lookup.ts';

function plane(
  status: PlaneResult['status'],
  code: string
): PlaneResult {
  return { status, code, notes: [] };
}

function baseLookup(
  over: {
    eventId?: string;
    pandora?: Partial<EventLookupResult['pandora']>;
  } = {}
): EventLookupResult {
  const pandora: EventLookupResult['pandora'] = {
    probed: true,
    seconds: 8,
    subscribed: true,
    lineCount: 4,
    periods: [],
    lines: [],
    markets: [],
    eventDataKeys: ['db', 'kb', 's', 'x'],
    periodMissing: false,
    book: {
      eventId: 1,
      markets: [],
      offeredMarketCount: 2,
      offMarketCount: 0,
      lineCount: 4,
      offerFingerprint: 'x',
    },
    eventState: {
      eventId: 1,
      state: 0,
      stateLabel: 'bettable',
      wireState: 0,
      isStarted: true,
      isLive: null,
      isHalftime: null,
      hasLines: true,
      shard: 1,
      oddsCount: null,
      offTheBoard: false,
      sportId: '8',
      sportName: 'Tennis',
      countryId: '1',
      leagueId: '1',
      home: 'A',
      away: 'B',
      startTimeSec: null,
      path: ['8', '1', '1', '1'],
      blockedReason: null,
      donbestId: null,
    },
    eventDataBoard: null,
    ...over.pandora,
  };
  return {
    eventId: over.eventId ?? '1',
    periodId: null,
    pliveUrl: 'https://plive.example/#!/event/1',
    pliveUrlBare: 'https://plive.example/#!/event/1',
    plane: 'priced_only',
    sportHint: 'tennis',
    streamList: { hit: false, event: null },
    skinEvents: null,
    bookedCatalog: null,
    notes: [],
    pandora,
  };
}

describe('event-validate verdict', () => {
  test('market fail dominates (session not blamed)', () => {
    const { verdict, failedPlanes } = verdictFromPlanes({
      inventory: plane('warn', 'priced_only'),
      market: plane('fail', 'otb'),
      profile: plane('ok', 'not_blocked'),
      session: plane('fail', 'session_error'),
    });
    expect(verdict).toBe('market_off');
    expect(failedPlanes).toContain('market');
    expect(failedPlanes).toContain('session');
  });

  test('market ok session skip', () => {
    const { verdict } = verdictFromPlanes({
      inventory: plane('warn', 'priced_only'),
      market: plane('ok', 'bettable_with_lines'),
      profile: plane('ok', 'not_blocked'),
      session: plane('skip', 'no_creds'),
    });
    expect(verdict).toBe('market_ok_session_skip');
  });

  test('market ok session fail = poorly held seat', () => {
    const { verdict, failedPlanes } = verdictFromPlanes({
      inventory: plane('ok', 'inventory_hit'),
      market: plane('ok', 'bettable_with_lines'),
      profile: plane('ok', 'not_blocked'),
      session: plane('fail', 'session_error'),
    });
    expect(verdict).toBe('market_ok_session_fail');
    expect(failedPlanes).toEqual(['session']);
  });

  test('blocked profile is market_blocked', () => {
    const { verdict } = verdictFromPlanes({
      inventory: plane('warn', 'priced_only'),
      market: plane('fail', 'blocked'),
      profile: plane('fail', 'group_blocked'),
      session: plane('skip', 'no_creds'),
    });
    expect(verdict).toBe('market_blocked');
  });
});

describe('validateEvent integration (mocked lookup/session)', () => {
  test('otb market fails without calling real session creds path', async () => {
    const report = await validateEvent({
      eventId: '197548901',
      pandoraSeconds: 0,
      requireSession: false,
      lookupFn: async () =>
        baseLookup({
          eventId: '197548901',
          pandora: {
            lineCount: 0,
            book: {
              eventId: 197548901,
              markets: [],
              offeredMarketCount: 0,
              offMarketCount: 0,
              lineCount: 0,
              offerFingerprint: '',
            },
            eventState: {
              eventId: 197548901,
              state: 3,
              stateLabel: 'finished',
              wireState: 3,
              isStarted: null,
              isLive: null,
              isHalftime: null,
              hasLines: false,
              shard: 5,
              oddsCount: null,
              offTheBoard: true,
              sportId: '2',
              sportName: 'Basketball',
              countryId: '4',
              leagueId: '1',
              home: 'Shooters',
              away: 'Vikings',
              startTimeSec: null,
              path: ['2', '4', '1', '197548901'],
              blockedReason: null,
              donbestId: null,
            },
          },
        }),
      sessionProbeFn: async () => ({
        attempted: false,
        required: false,
        accountId: null,
        domain: null,
        tokenPresent: false,
        tokenLen: 0,
        loginOk: false,
        warmed: null,
        cookieCount: null,
        renewOk: null,
        placeBetUrlSet: false,
        liveDesktopHost: null,
        plane: plane('skip', 'no_creds'),
      }),
    });
    expect(report.verdict).toBe('market_off');
    expect(report.planes.market.code).toBe('otb');
    expect(report.failedPlanes).toContain('market');
    expect(report.planes.session.status).toBe('skip');
  });

  test('bettable market + soft session → market_ok_session_warn', async () => {
    const report = await validateEvent({
      eventId: '1',
      requireSession: false,
      lookupFn: async () => baseLookup(),
      sessionProbeFn: async () => ({
        attempted: true,
        required: false,
        accountId: 'out-1',
        domain: 'https://desk.example',
        tokenPresent: true,
        tokenLen: 40,
        loginOk: true,
        warmed: true,
        cookieCount: 0,
        renewOk: null,
        placeBetUrlSet: false,
        liveDesktopHost: 'desk.example',
        plane: {
          status: 'warn',
          code: 'session_soft',
          notes: ['cookie jar empty after warm'],
        },
      }),
    });
    expect(report.verdict).toBe('market_ok_session_warn');
    expect(report.planes.market.status).toBe('ok');
    expect(report.planes.session.code).toBe('session_soft');
  });

  test('formatEventValidate includes verdict and plane table', async () => {
    const report = await validateEvent({
      eventId: '1',
      lookupFn: async () => baseLookup(),
      sessionProbeFn: async () => ({
        attempted: false,
        required: false,
        accountId: null,
        domain: null,
        tokenPresent: false,
        tokenLen: 0,
        loginOk: false,
        warmed: null,
        cookieCount: null,
        renewOk: null,
        placeBetUrlSet: false,
        liveDesktopHost: null,
        plane: plane('skip', 'no_creds'),
      }),
    });
    const text = formatEventValidate(report);
    expect(text).toContain('verdict=market_ok_session_skip');
    expect(text).toContain('market');
    expect(text).toContain('session');
    expect(text).toContain('fix market, not password');
  });
});
