// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  normalizeTennisFilterKey,
  passesMinimumSurfaceEdge,
  surfaceEdgePresentation,
} from '../../../src/research/hq-app/surface-edge.ts';

describe('passesMinimumSurfaceEdge', () => {
  test('floor 0 (or missing/NaN) = filter off', () => {
    expect(passesMinimumSurfaceEdge({ surfaceEdge: -50 }, 0)).toBe(true);
    expect(passesMinimumSurfaceEdge({ surfaceEdge: -50 }, undefined)).toBe(true);
    expect(passesMinimumSurfaceEdge({ surfaceEdge: -50 }, NaN)).toBe(true);
    expect(passesMinimumSurfaceEdge(undefined, 0)).toBe(true);
  });

  test('keeps matches at/above the floor, drops below', () => {
    expect(passesMinimumSurfaceEdge({ surfaceEdge: 42 }, 25)).toBe(true);
    expect(passesMinimumSurfaceEdge({ surfaceEdge: 25 }, 25)).toBe(true);
    expect(passesMinimumSurfaceEdge({ surfaceEdge: 24 }, 25)).toBe(false);
    expect(passesMinimumSurfaceEdge({ surfaceEdge: -10 }, 25)).toBe(false);
  });

  test('missing edge = 0, fails any positive floor', () => {
    expect(passesMinimumSurfaceEdge({}, 5)).toBe(false);
    expect(passesMinimumSurfaceEdge(null, 5)).toBe(false);
  });

  test('string floor is parsed numerically', () => {
    expect(passesMinimumSurfaceEdge({ surfaceEdge: 30 }, '25')).toBe(true);
    expect(passesMinimumSurfaceEdge({ surfaceEdge: 20 }, '25')).toBe(false);
  });
});

describe('surfaceEdgePresentation', () => {
  test('reliable positive edge -> positive tone, signed pp label', () => {
    const p = surfaceEdgePresentation({
      surfaceEdge: 42,
      surfaceEdgePlayers: ['Alcaraz', 'Sinner'],
      surfaceEdgeSamples: [10, 10],
      surfaceEdgeReliable: true,
      surfaceEdgeEvidence: 'ready',
    });
    expect(p.tone).toBe('positive');
    expect(p.label).toBe('+42pp');
    expect(p.title).toContain('Alcaraz');
    expect(p.title).toContain('10/10 samples');
  });

  test('negative edge -> negative tone', () => {
    const p = surfaceEdgePresentation({ surfaceEdge: -8, surfaceEdgeReliable: true, surfaceEdgeEvidence: 'ready' });
    expect(p.tone).toBe('negative');
    expect(p.label).toBe('-8pp');
  });

  test('zero edge -> neutral tone', () => {
    const p = surfaceEdgePresentation({ surfaceEdge: 0, surfaceEdgeReliable: true, surfaceEdgeEvidence: 'ready' });
    expect(p.tone).toBe('neutral');
  });

  test('unreliable or missing-surface -> unavailable dash', () => {
    const u = surfaceEdgePresentation({ surfaceEdge: 42, surfaceEdgeReliable: false, surfaceEdgeEvidence: 'low-sample' });
    expect(u.tone).toBe('unavailable');
    expect(u.label).toBe('—');
    const m = surfaceEdgePresentation({ surfaceEdge: 0, surfaceEdgeReliable: false, surfaceEdgeEvidence: 'missing-surface' });
    expect(m.tone).toBe('unavailable');
    expect(m.title).toContain('missing-surface');
  });

  test('null event is safe', () => {
    expect(surfaceEdgePresentation(null).tone).toBe('unavailable');
  });
});

describe('normalizeTennisFilterKey', () => {
  test('canonical keys pass through', () => {
    expect(normalizeTennisFilterKey('minSurfaceEdge')).toBe('minSurfaceEdge');
    expect(normalizeTennisFilterKey('when')).toBe('when');
  });

  test('snake/kebab/space + case variants canonicalize', () => {
    expect(normalizeTennisFilterKey('min_surface_edge')).toBe('minSurfaceEdge');
    expect(normalizeTennisFilterKey('MIN-SURFACE-EDGE')).toBe('minSurfaceEdge');
    expect(normalizeTennisFilterKey('min surface edge')).toBe('minSurfaceEdge');
    expect(normalizeTennisFilterKey('min_vol')).toBe('minVol');
    expect(normalizeTennisFilterKey('maxAsk')).toBe('maxAsk');
  });

  test('unknown keys pass through unchanged', () => {
    expect(normalizeTennisFilterKey('bogusKey')).toBe('bogusKey');
    expect(normalizeTennisFilterKey(null)).toBe('');
  });
});
