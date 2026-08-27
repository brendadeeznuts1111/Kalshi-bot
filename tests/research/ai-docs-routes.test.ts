// AI docs layer — /tokens (markdown + JSON) and /llms.txt routes.
// Handlers are pure (exported from serve.ts); no server boot needed.
import { describe, expect, test } from 'bun:test';
import { handleLlmsTxt, handleTokens } from '../../src/research/serve.ts';

describe('AI docs layer', () => {
  test('/tokens?format=md renders the registry as a markdown table', async () => {
    const res = await handleTokens(new Request('http://x/tokens?format=md'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    const text = await res.text();
    expect(text).toContain('# Kalshi HQ tokens');
    expect(text).toContain('| `color.bg` | `#0b0e14` |');
    expect(text).toContain('| `color.acc` | `#4da3ff` |');
  });

  test('/tokens (no format) returns JSON with version + tokens', async () => {
    const res = await handleTokens(new Request('http://x/tokens'));
    const body = await res.json();
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.tokens.color.bg).toBe('#0b0e14');
    expect(body.tokens.color.acc).toBe('#4da3ff');
  });

  test('/llms.txt lists the machine-readable endpoints', async () => {
    const res = await handleLlmsTxt(new Request('http://x/llms.txt'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('/tokens?format=md');
    expect(text).toContain('/docs');
    expect(text).toContain('Registry version: 1.2.0.');
  });
});
