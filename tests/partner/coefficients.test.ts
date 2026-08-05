// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { CoefficientStore } from '../../src/partner/fantasy-ultra/coefficient-store.ts';
import {
  applyCoefficientDiff,
  decodePandoraAttachment,
  eventIdFromCoefficientRoom,
  extractCoefficientLines,
  parseBinaryEventHeader,
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
