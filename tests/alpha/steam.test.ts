// Companion tests for src/alpha/steam.ts — cross-book steam detection.
import { describe, expect, test } from 'bun:test';
import {
  applySteamMove,
  clampedLogit,
  collectSteamMoves,
  computeLeadership,
  detectSteam,
  detectSteamFromEvents,
  steamScore,
} from '../../src/alpha/steam.ts';
import type { ClusterResult, OddsPrint } from '../../src/alpha/cluster/odds-vector.ts';
import type { OddsEvent } from '../../src/alpha/odds-types.ts';

function print(id: string, source: string, side: string, implied: number, ts: number): OddsPrint {
  return { id, source, eventId: 'ev1', side, implied, vig: 0.05, ts };
}

function clusterOf(prints: OddsPrint[]): ClusterResult {
  return {
    labels: prints.map((_, i) => i),
    prints: prints.map((p) => ({ ...p, label: 0 })),
    clusters: new Map([[0, prints.map((p) => ({ ...p }))]]),
    noiseCount: 0,
    epsilon: undefined,
  };
}

function event(id: string, prices: Array<[string, number]>): OddsEvent {
  return {
    id: id as never,
    sportKey: 'tennis',
    commenceTime: '2026-08-26T12:00:00Z',
    homeTeam: 'A',
    awayTeam: 'B',
    bookmakers: prices.map(([key, price]) => ({
      key,
      title: key,
      lastUpdate: '',
      markets: [{ key: 'h2h', outcomes: [{ name: 'A', price }, { name: 'B', price: -price }] }],
    })),
  };
}

describe('collectSteamMoves', () => {
  test('detects a move when a book implied changes; ignores unchanged and unseen', () => {
    const prev = new Map([
      ['p1', print('p1', 'pin', 'A', 0.6, 1000)],
      ['p2', print('p2', 'pin2', 'A', 0.55, 1000)],
    ]);
    const moves = collectSteamMoves(
      [print('p1', 'pin', 'A', 0.65, 2000), print('p2', 'pin2', 'A', 0.55, 2000), print('p3', 'pin3', 'A', 0.5, 2000)],
      prev,
    );
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ book: 'pin', side: 'A', oldImplied: 0.6, newImplied: 0.65, timestamp: 2000 });
    expect(moves[0]!.delta).toBeCloseTo(0.05, 5);
  });
});

describe('clampedLogit', () => {
  test('0.5 maps to 0; extremes clamp instead of Infinity/NaN', () => {
    expect(clampedLogit(0.5)).toBe(0);
    expect(Number.isFinite(clampedLogit(0))).toBe(true);
    expect(Number.isFinite(clampedLogit(1))).toBe(true);
    expect(clampedLogit(0)).toBeLessThan(0);
    expect(clampedLogit(1)).toBeGreaterThan(0);
  });
});

describe('detectSteam', () => {
  test('no moves returns an empty result', () => {
    const result = detectSteam([print('p1', 'pin', 'A', 0.6, 1000)], new Map());
    expect(result.leader).toBeNull();
    expect(result.followers).toEqual([]);
    expect(result.steamEvents).toEqual([]);
    expect(result.moves).toEqual([]);
  });

  test('single move: that book is the leader, no followers', () => {
    const prev = new Map([['p1', print('p1', 'pin', 'A', 0.6, 1000)]]);
    const result = detectSteam([print('p1', 'pin', 'A', 0.65, 2000)], prev);
    expect(result.leader).toBe('pin');
    expect(result.leaderSide).toBe('A');
    expect(result.followers).toEqual([]);
    expect(result.moves).toHaveLength(1);
  });

  test('two moves with different timestamps: correct lag + positive score', () => {
    const prev = new Map([
      ['p1', print('p1', 'pin', 'A', 0.6, 1000)],
      ['p2', print('p2', 'dk', 'A', 0.58, 1000)],
    ]);
    const result = detectSteam(
      [print('p1', 'pin', 'A', 0.65, 2000), print('p2', 'dk', 'A', 0.63, 2500)],
      prev,
    );
    expect(result.leader).toBe('pin');
    expect(result.followers).toHaveLength(1);
    const f = result.followers[0]!;
    expect(f).toMatchObject({ book: 'dk', side: 'A', lagMs: 500 });
    expect(f.delta).toBeCloseTo(0.05, 5);
    expect(f.score).toBeGreaterThan(0);
    expect(result.steamEvents[0]).toMatchObject({ leader: 'pin', leaderSide: 'A', book: 'dk' });
  });

  test('move outside the window is ignored', () => {
    const prev = new Map([
      ['p1', print('p1', 'pin', 'A', 0.6, 1000)],
      ['p2', print('p2', 'dk', 'A', 0.58, 1000)],
    ]);
    const result = detectSteam(
      [print('p1', 'pin', 'A', 0.65, 2000), print('p2', 'dk', 'A', 0.63, 9000)],
      prev,
    );
    expect(result.leader).toBe('pin');
    expect(result.followers).toEqual([]);
  });

  test('simultaneous moves: first in input order wins (stable reduce)', () => {
    const prev = new Map([
      ['p1', print('p1', 'pin', 'A', 0.6, 1000)],
      ['p2', print('p2', 'dk', 'A', 0.58, 1000)],
    ]);
    const result = detectSteam(
      [print('p1', 'pin', 'A', 0.65, 2000), print('p2', 'dk', 'A', 0.63, 2000)],
      prev,
    );
    expect(result.leader).toBe('pin'); // first in array order on ties
    expect(result.followers[0]!.lagMs).toBe(0);
  });

  test('score: larger logit magnitude and zero lag beat smaller/slower', () => {
    const mk = (delta: number, lagMs: number) => ({
      book: 'x', side: 'A', timestamp: 1000 + lagMs, delta, oldImplied: 0.5, newImplied: 0.5 + delta,
    });
    const big = steamScore(mk(0.2, 0), 0, 5000, 0.1);
    const small = steamScore(mk(0.01, 0), 0, 5000, 0.1);
    const slow = steamScore(mk(0.2, 4000), 4000, 5000, 0.1);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThan(0); // still in window
  });
});

describe('applySteamMove (immutability)', () => {
  test('updates leader + followers without mutating the input cluster', () => {
    const cluster = clusterOf([print('p1', 'pin', 'A', 0.6, 1000), print('p2', 'dk', 'A', 0.58, 1000)]);
    const beforePrints = cluster.prints.map((p) => ({ ...p }));
    const move = { book: 'pin', side: 'A', timestamp: 3000, delta: 0.05, oldImplied: 0.6, newImplied: 0.65 };
    const next = applySteamMove(cluster, move, ['dk'], 200);
    expect(next).not.toBe(cluster);
    expect(cluster.prints[0]!.implied).toBe(0.6); // original untouched
    expect(cluster.prints[0]!.ts).toBe(1000);
    const updated = next.prints.find((p) => p.id === 'p1')!;
    const follower = next.prints.find((p) => p.id === 'p2')!;
    expect(updated.implied).toBe(0.65);
    expect(updated.ts).toBe(3000);
    expect(follower.implied).toBe(0.65);
    expect(follower.ts).toBe(3200); // latency applied
    expect(next.clusters.get(0)).not.toBe(cluster.clusters.get(0));
    expect(beforePrints).toEqual(cluster.prints);
  });

  test('missing leader book returns the same cluster reference', () => {
    const cluster = clusterOf([print('p1', 'pin', 'A', 0.6, 1000)]);
    const move = { book: 'nope', side: 'A', timestamp: 3000, delta: 0.05, oldImplied: 0.6, newImplied: 0.65 };
    expect(applySteamMove(cluster, move, [], 0)).toBe(cluster);
  });
});

describe('detectSteamFromEvents', () => {
  test('parses OddsEvents and detects a cross-book move', () => {
    const events = [event('ev1', [['pin', 150], ['dk', 120]])];
    const prev = new Map<string, OddsPrint>([
      ['pin:ev1:A', print('pin:ev1:A', 'pin', 'A', 0.4, 1000)],
      ['dk:ev1:A', print('dk:ev1:A', 'dk', 'A', 0.45, 1000)],
    ]);
    // prices 150 -> implied 0.4; 120 -> 0.4545: the dk print should move.
    const result = detectSteamFromEvents(events, prev);
    expect(result.moves.length).toBeGreaterThanOrEqual(1);
    expect(result.moves[0]!.book).toBe('dk');
  });

  test('scopes parse errors', () => {
    expect(() => detectSteamFromEvents(null as never, new Map())).toThrow(/parse failed/);
  });
});

describe('computeLeadership', () => {
  test('correlated pair yields a leadership pair; low data yields none', () => {
    const mk = (ts: number, implied: number): OddsPrint => print('id' + ts, 'bk' + ts, 'A', implied, ts);
    // Two books moving in lockstep at the same timestamps.
    const shared = [1000, 2000, 3000, 4000];
    const a = shared.map((ts, i) => print('a' + ts, 'pinnacle', 'A', 0.4 + i * 0.02, ts));
    const b = shared.map((ts, i) => print('b' + ts, 'draftkings', 'A', 0.4 + i * 0.02 + 0.01, ts));
    const result = computeLeadership([clusterOf([...a, ...b])]);
    expect(result.leadershipPairs.length).toBe(1);
    const pair = result.leadershipPairs[0]!;
    expect(pair.leader).toBe('pinnacle');
    expect(pair.follower).toBe('draftkings');
    expect(pair.confidence).toBeGreaterThan(0.8);
    void mk;
    // Fewer than minPoints -> no pair.
    const sparse = computeLeadership([clusterOf([print('s1', 'x', 'A', 0.5, 1), print('s2', 'y', 'A', 0.5, 2)])]);
    expect(sparse.leadershipPairs).toEqual([]);
  });
});
