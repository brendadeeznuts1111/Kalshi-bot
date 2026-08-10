// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  bookedCatalogToMatchList,
  type BookedCatalogEntry,
} from '../../src/inventory/booked-catalog.ts';

describe('booked-catalog pure adapters', () => {
  test('bookedCatalogToMatchList maps entries', () => {
    const entries: BookedCatalogEntry[] = [
      {
        oddsEventId: '1',
        name: 'A vs B',
        sportName: 'Tennis',
        competition: 'ATP',
      },
      {
        oddsEventId: '2',
        name: 'C vs D',
        sportName: 'Table Tennis',
      },
    ];
    const list = bookedCatalogToMatchList(entries);
    expect(list).toEqual([
      {
        oddsEventId: '1',
        name: 'A vs B',
        sportName: 'Tennis',
        competition: 'ATP',
      },
      {
        oddsEventId: '2',
        name: 'C vs D',
        sportName: 'Table Tennis',
        competition: null,
      },
    ]);
  });
});
