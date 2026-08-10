// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  formatEventLookup,
  lookupEvent,
  pliveEventUrl,
} from '../../src/inventory/event-lookup.ts';
import type { FetchFn } from '../../src/institutions/resilient-fetch.ts';

describe('event-lookup', () => {
  test('pliveEventUrl builds deep link', () => {
    expect(pliveEventUrl(197548901)).toContain(
      '#!/event/197548901?hideSidebar=true'
    );
  });

  test('lookupEvent finds stream-list inventory id (mock)', async () => {
    const fetchImpl: FetchFn = async () =>
      new Response(
        JSON.stringify({
          sports: {
            basketball: {
              events: {
                '39898549': {
                  sport: 'Basketball',
                  league: 'Test League',
                  competitiors: { home: 'Home', away: 'Away' },
                  stream_id: 39898549,
                  feed_id: 0,
                },
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );

    const r = await lookupEvent({
      eventId: '39898549',
      fetchImpl,
      skipDb: true,
      skipCatalog: true,
      skipPandora: true,
    });
    expect(r.plane).toBe('inventory');
    expect(r.streamList.hit).toBe(true);
    expect(r.streamList.event?.home).toBe('Home');
    expect(formatEventLookup(r)).toContain('stream-list ✓');
  });

  test('lookupEvent marks unknown when nothing hits', async () => {
    const fetchImpl: FetchFn = async () =>
      new Response(JSON.stringify({ sports: {} }), { status: 200 });
    const r = await lookupEvent({
      eventId: '111111111',
      fetchImpl,
      skipDb: true,
      skipCatalog: true,
      skipPandora: true,
    });
    expect(r.plane).toBe('unknown');
    expect(r.streamList.hit).toBe(false);
  });
});
