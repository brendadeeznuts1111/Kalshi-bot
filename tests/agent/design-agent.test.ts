// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { designAgent } from '../../src/agent/design-agent.ts';

describe('designAgent.audit', () => {
  test('token-only HTML passes', () => {
    expect(designAgent.audit('<div style="color: var(--fg)"></div>').ok).toBe(true);
  });

  test('hardcoded non-token hex fails', () => {
    const a = designAgent.audit('<div style="color: #123456"></div>');
    expect(a.ok).toBe(false);
    expect(a.issues[0]!.kind).toBe('hardcoded-color');
    expect(a.issues[0]!.value).toBe('#123456');
  });

  test('allowlist admits data-driven colors but not UI chrome', () => {
    const html = '<span style="color: #e64dcc">ASH</span><span style="color: #123456">x</span>';
    const withLegal = designAgent.audit(html, { legal: ['#e64dcc'] });
    expect(withLegal.ok).toBe(false);
    expect(withLegal.issues.map((i) => i.value)).toEqual(['#123456']);
    expect(designAgent.audit(html, { legal: ['#e64dcc', '#123456'] }).ok).toBe(true);
  });

  test('domain palette colors are legal (COLORS via TOKENS.palette)', () => {
    expect(designAgent.audit('<div style="color: #27ae60"></div>').ok).toBe(true); // tennis
    expect(designAgent.audit('<div style="color: #7dd3fc"></div>').ok).toBe(true); // kalshi
    expect(designAgent.audit('<div style="color: #ef4444"></div>').ok).toBe(true); // semverMajor
  });

  test('8-digit alpha hex normalizes to its 6-digit base', () => {
    expect(designAgent.audit('<div style="color: #f0b42955"></div>').ok).toBe(true); // deprecated@alpha
  });

  test('3-digit hex expands to 6-digit form', () => {
    expect(designAgent.audit('<div style="color: #fff"></div>').ok).toBe(true); // -> #ffffff (onDark)
  });

  test('rgba tints/scrims are legal; unknown rgba fails', () => {
    expect(designAgent.audit('<div style="color: rgba(63,178,127,.15)"></div>').ok).toBe(true); // okTint
    expect(designAgent.audit('<div style="color: rgba(0,0,0,.35)"></div>').ok).toBe(true); // scrim.soft
    const a = designAgent.audit('<div style="color: rgba(1,2,3,.5)"></div>');
    expect(a.ok).toBe(false);
    expect(a.issues[0]!.value).toBe('rgba(1,2,3,.5)');
  });

  test('hardcoded radius outside TOKENS.radius fails', () => {
    const a = designAgent.audit('<div style="border-radius: 7px"></div>');
    expect(a.ok).toBe(false);
    expect(a.issues[0]!.kind).toBe('hardcoded-radius');
  });

  test('multiple surfaces are audited together', () => {
    const a = designAgent.audit('clean: #3fb27f', 'dirty: #123456');
    expect(a.ok).toBe(false);
    expect(a.issues).toHaveLength(1);
  });

  test('live hq-app surfaces are token-compliant (no violations)', async () => {
    const files = ['index.html', 'styles.css', 'app.js', 'color-vars.css'];
    const root = new URL('../../src/research/hq-app/', import.meta.url).pathname;
    const surfaces = await Promise.all(files.map((f) => Bun.file(root + f).text().catch(() => '')));
    const a = designAgent.audit(...surfaces);
    expect(a.issues).toEqual([]);
  });
});
