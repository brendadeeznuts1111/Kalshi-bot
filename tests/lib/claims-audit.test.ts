/**
 * claims-audit lib (src/lib/claims-audit.ts): verify pasted claims against
 * a reference document before acting on them (pitfalls sections 13/15).
 */
import { describe, test, expect } from 'bun:test';
import { auditClaims, htmlToText } from '../../src/lib/claims-audit.ts';

const SAMPLE = '<html><body><p>Bun 1.4 rewrites Bun from Zig to Rust. HTTP/2 is 2.7x faster. res.writeHeader is removed.</p></body></html>';


describe('auditClaims', () => {
  test('finds claims present in the reference (word-bounded)', () => {
    const { verdicts, absent } = auditClaims(
      ['rewrites Bun from Zig to Rust', 'res.writeHeader is removed'],
      SAMPLE,
    );
    expect(absent).toBe(0);
    expect(verdicts.every((v) => v.found)).toBe(true);
  });

  test('flags fabricated claims as absent', () => {
    const { verdicts, absent } = auditClaims(
      ['535,496 lines of Zig', '64 Claude agents', 'strangler-fig'],
      SAMPLE,
    );
    expect(absent).toBe(3);
    expect(verdicts.every((v) => !v.found)).toBe(true);
  });

  test('word-boundary avoids substring false positives', () => {
    // 'strangler' must NOT match 'strangler-fig'; '2.7x' must match
    const { verdicts } = auditClaims(['strangler', '2.7x'], SAMPLE);
    expect(verdicts[0]!.found).toBe(false);
    expect(verdicts[1]!.found).toBe(true);
  });

  test('all:true switches to substring matching', () => {
    // 'rewrite' is a prefix of 'rewrites': word-boundary misses it,
    // substring (all) matches.
    const bounded = auditClaims(['rewrite'], SAMPLE);
    expect(bounded.verdicts[0]!.found).toBe(false);
    const substring = auditClaims(['rewrite'], SAMPLE, { all: true });
    expect(substring.verdicts[0]!.found).toBe(true);
  });

  test('case-insensitive', () => {
    const { verdicts } = auditClaims(['BUN FROM ZIG'], SAMPLE);
    expect(verdicts[0]!.found).toBe(true);
  });
});

describe('htmlToText', () => {
  test('strips tags and entities', () => {
    const text = htmlToText('<p>a &amp; b &lt;c&gt; &quot;d&quot;</p>');
    expect(text).toContain('a & b <c> "d"');
  });
});