// @see https://bun.com/docs/runtime/color#flexible-input
// Property-based smoke for Bun.color: seeded PRNG (deterministic, no flake).
import { describe, expect, test } from 'bun:test';
import { tint } from '../../src/lib/color/kernel.ts';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMED = ['red', 'green', 'blue', 'black', 'white', 'transparent', 'rebeccapurple', 'tomato'];

function randomInput(rnd: () => number): string | number {
  const kind = Math.floor(rnd() * 6);
  if (kind === 0) {
    const n = Math.floor(rnd() * 0xffffff);
    return '#' + (kind === 0 ? n.toString(16).padStart(6, '0') : n);
  }
  if (kind === 1) {
    const hex = Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0');
    return rnd() > 0.5 ? '#' + hex : '#' + hex.toUpperCase();
  }
  if (kind === 2) {
    const c = [0, 0, 0].map(() => Math.floor(rnd() * 256));
    return `rgb(${c.join(', ')})`;
  }
  if (kind === 3) {
    const c = [0, 0, 0].map(() => Math.floor(rnd() * 256));
    return `rgba(${c.join(', ')}, ${(rnd() * 1).toFixed(2)})`;
  }
  if (kind === 4) {
    return `hsl(${Math.floor(rnd() * 360)}, ${Math.floor(rnd() * 101)}%, ${Math.floor(rnd() * 101)}%)`;
  }
  return NAMED[Math.floor(rnd() * NAMED.length)]!;
}

describe('Bun.color property-based (seeded fuzz)', () => {
  test('css output round-trips for every parseable random input', () => {
    const rnd = mulberry32(0xC0FFEE);
    let parsed = 0;
    for (let i = 0; i < 200; i++) {
      const input = randomInput(rnd);
      const css = Bun.color(input, 'css');
      if (css === null) continue; // unparseable input is legal (returns null)
      parsed++;
      expect(typeof css).toBe('string');
      expect(css.length).toBeGreaterThan(0);
      // The css output must itself be a valid color (round-trip).
      expect(Bun.color(css, 'HEX')).not.toBeNull();
    }
    expect(parsed).toBeGreaterThan(100); // most random inputs parse
  });

  test('HEX output is always canonical #RRGGBB when parseable', () => {
    const rnd = mulberry32(0xBEEF);
    for (let i = 0; i < 150; i++) {
      const input = randomInput(rnd);
      const hex = Bun.color(input, 'HEX');
      if (hex === null) continue;
      expect(String(hex)).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  test('tint() output is a parseable rgba() for random hex + alpha', () => {
    const rnd = mulberry32(0x7E57);
    for (let i = 0; i < 100; i++) {
      const hex = '#' + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0');
      const alpha = Math.round(rnd() * 100) / 100;
      const out = tint(hex, alpha);
      expect(out).toMatch(/^rgba\(\d{1,3},\d{1,3},\d{1,3},\.?\d+\)$/);
      expect(Bun.color(out, 'HEX')).not.toBeNull();
    }
  });
});
