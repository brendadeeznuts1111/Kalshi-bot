// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { CoefficientStore } from '../../src/partner/fantasy-ultra/coefficient-store.ts';
import {
  analyzeCoefficientBook,
  applyCoefficientDiff,
  calculateEffectiveEventState,
  decodeEventOfferability,
  decodePandoraAttachment,
  describePandoraEventState,
  diffEventDataOfferability,
  diffOfferFingerprints,
  eventIdFromCoefficientRoom,
  extractCoefficientLines,
  findEventInEventDataBoard,
  isEventDataBoardPayload,
  isEventOffTheBoard,
  parseBinaryEventHeader,
  parseEventDataDiffPath,
  parseLiveSportsNames,
  parsePandoraBlocked,
  scanEventDataBoard,
  summarizeEventDataBoard,
  PANDORA_EVENT_STATES,
} from '../../src/partner/fantasy-ultra/coefficients.ts';

describe('pandora coefficient decode', () => {
  test('parseBinaryEventHeader 451- wire form', () => {
    const h = parseBinaryEventHeader(
      '451-["live.main.U0VWU1NWUkJSMFU9.eventCoefficients.174125551",{"_placeholder":true,"num":0}]',
    );
    expect(h?.attachmentCount).toBe(1);
    expect(h?.eventName).toContain('eventCoefficients.174125551');
  });

  test('eventIdFromCoefficientRoom', () => {
    expect(
      eventIdFromCoefficientRoom(
        'live.main.U0VWU1NWUkJSMFU9.eventCoefficients.174125551',
      ),
    ).toBe(174125551);
    expect(eventIdFromCoefficientRoom('live.sports')).toBeNull();
  });

  test('decodePandoraAttachment + extractCoefficientLines', () => {
    const envelope = {
      isDiff: false,
      payload: {
        id: 174125551,
        m: 1,
        c: {
          m: {
            '3': { cls: { '0': 8 }, o: { '1': 1.315457, '2': 3.08 } },
            '5': {
              cls: { _d: 13 },
              o: { '17.5': [1.699301, 1.990099] },
              r: 18.5,
            },
          },
        },
      },
      ti: { h: 'abc', t: 1 },
    };
    const gz = Bun.gzipSync(JSON.stringify(envelope));
    const b64 = Buffer.from(gz).toString('base64');
    const decoded = decodePandoraAttachment(b64);
    expect(decoded.isDiff).toBe(false);
    const lines = extractCoefficientLines(174125551, decoded.payload);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const ml1 = lines.find(
      (l) => l.marketType === '3' && l.selection === '1',
    );
    expect(ml1?.decimal).toBeCloseTo(1.315, 2);
    expect(typeof ml1?.american).toBe('number');
    expect(ml1!.american).toBeLessThan(0); // favorite
    const tot = lines.find(
      (l) => l.marketType === '5' && l.selection === '17.5' && l.sideIndex === 0,
    );
    expect(tot?.line).toBe(17.5);
  });

  test('analyzeCoefficientBook offered vs empty o + cls limit class', () => {
    const book = analyzeCoefficientBook(1, {
      id: 1,
      c: {
        m: {
          '3': { cls: { '0': 2 }, o: { '1': 1.5, '2': 2.5 } },
          '5': { cls: { _d: 6 }, o: {}, r: 10.5 },
        },
      },
    });
    expect(book.offeredMarketCount).toBe(1);
    expect(book.offMarketCount).toBe(1);
    expect(book.markets.find(m => m.marketType === '5')?.offered).toBe(false);
    expect(book.markets.find(m => m.marketType === '3')?.clsDefault).toBeNull();
    expect(book.markets.find(m => m.marketType === '5')?.clsDefault).toBe(6);
  });

  test('diffOfferFingerprints detects selection_off and price_change', () => {
    const prev = extractCoefficientLines(1, {
      c: { m: { '3': { o: { '1': 1.5, '2': 2.5 } } } },
    });
    const next = extractCoefficientLines(1, {
      c: { m: { '3': { o: { '1': 1.6 } } } },
    });
    const t = diffOfferFingerprints(prev, next);
    expect(t.some(x => x.kind === 'selection_off' && x.selection === '2')).toBe(
      true
    );
    expect(t.some(x => x.kind === 'price_change' && x.selection === '1')).toBe(
      true
    );
  });

  test('EVENT_STATES and isEventOffTheBoard', () => {
    expect(describePandoraEventState(PANDORA_EVENT_STATES.bettable)).toBe(
      'bettable'
    );
    expect(isEventOffTheBoard({ state: 0, oddsCount: 4 })).toBe(false);
    expect(isEventOffTheBoard({ state: 2, oddsCount: 4 })).toBe(true);
    expect(isEventOffTheBoard({ state: 0, oddsCount: 0 })).toBe(true);
    expect(isEventOffTheBoard({ state: 3, oddsCount: 2 })).toBe(true);
    // board hasLines proxy when oddsCount absent
    expect(isEventOffTheBoard({ state: 0, hasLines: true })).toBe(false);
    expect(isEventOffTheBoard({ state: 0, hasLines: false })).toBe(true);
  });

  test('eventData board find + decode offerability (mainapp s-tree)', () => {
    const board = {
      db: { '101': 197488581 },
      kb: { '9': 197488581 },
      x: [false, false],
      s: {
        '8': {
          '341': {
            '30868': {
              '197488581': [
                ['Lewis Mary', '', '', 1, '', '', ''],
                ['Mia Wainwright', '', '', 2, '', '', ''],
                1786354200,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                { ip: true, l: true, n: 3, s: 0 },
              ],
              '197502861': [
                ['A', '', '', 1],
                ['B', '', '', 2],
                1786352760,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                { ip: true, l: false, n: 1, s: 0 },
              ],
            },
          },
        },
        '2': {
          '4': {
            '30651': {
              '197548901': [
                ['Shooters'],
                ['Vikings Club'],
                1786354501,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                { l: false, n: 5, s: 3 },
              ],
            },
          },
        },
      },
    };

    expect(isEventDataBoardPayload(board)).toBe(true);
    const summary = summarizeEventDataBoard(board)!;
    expect(summary.sportCount).toBe(2);
    expect(summary.eventCount).toBe(3);
    expect(summary.dbCount).toBe(1);

    const live = findEventInEventDataBoard(board, 197488581)!;
    expect(live.home).toBe('Lewis Mary');
    expect(live.away).toBe('Mia Wainwright');
    expect(live.sportId).toBe('8');
    expect(live.dynamic?.s).toBe(0);
    expect(live.dynamic?.l).toBe(true);
    const liveOff = decodeEventOfferability(live);
    expect(liveOff.offTheBoard).toBe(false);
    expect(liveOff.stateLabel).toBe('bettable');

    const finished = decodeEventOfferability(
      findEventInEventDataBoard(board, 197548901)!
    );
    expect(finished.state).toBe(3);
    expect(finished.offTheBoard).toBe(true);
    expect(finished.hasLines).toBe(false);

    const noLines = decodeEventOfferability(
      findEventInEventDataBoard(board, 197502861)!
    );
    expect(noLines.state).toBe(0);
    expect(noLines.hasLines).toBe(false);
    expect(noLines.offTheBoard).toBe(true);

    expect(findEventInEventDataBoard(board, 999)).toBeNull();
  });

  test('parseEventDataDiffPath + offerability transitions', () => {
    const p = parseEventDataDiffPath('/s/8/340/14358/197502861/12/l');
    expect(p.eventId).toBe(197502861);
    expect(p.field).toBe('l');

    const p2 = parseEventDataDiffPath('/s/2/4/30651/197548901/12/s');
    expect(p2.eventId).toBe(197548901);
    expect(p2.field).toBe('s');

    const a = {
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
      canonicalSportId: 'tennis',
      countryId: '1',
      countryName: null,
      leagueId: '1',
      leagueName: null,
      home: 'A',
      away: 'B',
      startTimeSec: null,
      path: ['8', '1', '1', '1'],
      blockedReason: null,
      donbestId: null,
    };
    const b = { ...a, hasLines: false, offTheBoard: true };
    const t = diffEventDataOfferability(a, b);
    expect(t.some(x => x.kind === 'lines_flag' && x.hasLines === false)).toBe(
      true
    );
  });

  test('scanEventDataBoard + blocked sport overlay (TT 93)', () => {
    const board = {
      db: { '55': 197418461 },
      kb: {},
      x: [false],
      s: {
        '8': {
          '1': {
            '10': {
              '100': [
                ['A'],
                ['B'],
                1,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                { s: 0, l: true, ip: true, n: 1 },
              ],
            },
          },
        },
        '93': {
          '4': {
            '20': {
              '197418461': [
                ['Karelov'],
                ['Sydorenko'],
                1,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                { s: 0, l: true, ip: true, n: 1 },
              ],
            },
          },
        },
      },
    };
    const sportsNames = parseLiveSportsNames({
      '8': { n: 'Tennis' },
      '93': { n: 'Table Tennis' },
    });
    const blocked = parsePandoraBlocked({
      sports: { '93': true },
      leagues: {},
      events: {},
      markets: {},
    });
    expect(blocked.sports.has('93')).toBe(true);

    const scan = scanEventDataBoard(board, { sportsNames, blocked })!;
    expect(scan.summary.eventCount).toBe(2);
    const tennis = scan.events.find(e => e.eventId === 100)!;
    expect(tennis.offTheBoard).toBe(false);
    expect(tennis.sportName).toBe('Tennis');
    expect(tennis.state).toBe(0);

    const tt = scan.events.find(e => e.eventId === 197418461)!;
    expect(tt.wireState).toBe(0);
    expect(tt.state).toBe(PANDORA_EVENT_STATES.notBettable);
    expect(tt.blockedReason).toBe('blocked_sport:93');
    expect(tt.offTheBoard).toBe(true);
    expect(tt.canonicalSportId).toBe('table_tennis');
    expect(tt.donbestId).toBe('55');
    expect(scan.blockedOverlayCount).toBe(1);
    expect(tennis.canonicalSportId).toBe('tennis');

    const eff = calculateEffectiveEventState(0, {
      eventId: 197418461,
      sportId: '93',
      leagueId: '20',
      dynamic: { s: 0, l: true },
    }, { blocked });
    expect(eff.state).toBe(2);
    expect(eff.blockedReason).toBe('blocked_sport:93');
  });

  test('applyCoefficientDiff replace paths', () => {
    const snap = {
      c: { m: { '3': { o: { '1': 1.3, '2': 3.0 } } } },
      id: 1,
    };
    const next = applyCoefficientDiff(snap, [
      { op: 'replace', path: '/c/m/3/o/1', value: 1.5 },
    ]);
    expect((next.c as { m: { '3': { o: { '1': number } } } }).m['3'].o['1']).toBe(
      1.5,
    );
    // original untouched
    expect(
      (snap.c as { m: { '3': { o: { '1': number } } } }).m['3'].o['1'],
    ).toBe(1.3);
  });
});

describe('CoefficientStore', () => {
  const snapshotPayload = {
    id: 174125551,
    c: {
      m: {
        '3': { o: { '1': 1.315457, '2': 3.08 } },
        '5': { o: { '17.5': [1.7, 1.99] }, r: 18.5 },
      },
    },
  };

  test('ingest snapshot → PartnerMarket ML', () => {
    const store = new CoefficientStore();
    const lines = extractCoefficientLines(174125551, snapshotPayload);
    store.ingest({
      room: 'live.main.TOK.eventCoefficients.174125551',
      eventId: 174125551,
      envelope: { isDiff: false, payload: snapshotPayload },
      lines,
    });
    expect(store.pricedEventCount()).toBe(1);
    expect(store.lineCount()).toBeGreaterThanOrEqual(4);
    const markets = store.toPartnerMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0]!.ticker).toBe('f402:174125551:m:3');
    expect(markets[0]!.homePrice).toBeTypeOf('number');
    expect(markets[0]!.awayPrice).toBeTypeOf('number');
    expect(store.marketsForEvent('174125551')).toHaveLength(1);
  });

  test('ingest diff patches last snapshot', () => {
    const store = new CoefficientStore();
    store.ingest({
      room: 'live.main.TOK.eventCoefficients.1',
      eventId: 1,
      envelope: {
        isDiff: false,
        payload: { id: 1, c: { m: { '3': { o: { '1': 1.3, '2': 3.0 } } } } },
      },
      lines: extractCoefficientLines(1, {
        id: 1,
        c: { m: { '3': { o: { '1': 1.3, '2': 3.0 } } } },
      }),
    });
    store.ingest({
      room: 'live.main.TOK.eventCoefficients.1',
      eventId: 1,
      envelope: {
        isDiff: true,
        payload: [{ op: 'replace', path: '/c/m/3/o/1', value: 1.5 }],
      },
      lines: [],
    });
    const ml1 = store.getLines(1).find(
      (l) => l.marketType === '3' && l.selection === '1',
    );
    expect(ml1?.decimal).toBeCloseTo(1.5, 5);
  });
});
