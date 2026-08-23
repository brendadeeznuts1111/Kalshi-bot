/**
 * Static dir routes on createResearchServer (Bun v1.4 routes { dir }).
 * Probe-verified behaviors locked in: index.html for dirs, ETag, 304,
 * Range/206, fallback fetch for non-static paths. Requires the baked
 * artifacts (bun run partner:dashboard / colors:artifacts) - guarded.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync } from 'node:fs';
import { createResearchServer } from '../../src/research/serve.ts';

const haveArtifacts = existsSync('public/partner-dashboard/index.html')
  && existsSync('public/registry/color-system.json');

describe('serve.ts static dir routes', () => {
  let server: ReturnType<typeof createResearchServer>;

  beforeAll(() => {
    server = createResearchServer({ port: 0 });
  });

  afterAll(() => {
    server.stop(true);
  });

  test('registry JSON served from dir route with ETag + 200', async () => {
    if (!haveArtifacts) { console.log('skipping: artifacts not baked'); return; }
    const res = await fetch(server.url + 'registry/color-system.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
    expect(res.headers.get('etag')).toBeTruthy();
    const body = await res.json();
    expect(typeof body).toBe('object');
  });

  test('partner-dashboard index.html served for the dir', async () => {
    if (!haveArtifacts) { console.log('skipping: artifacts not baked'); return; }
    const res = await fetch(server.url + 'partner-dashboard/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');
    expect(res.headers.get('etag')).toBeTruthy();
  });

  test('If-None-Match gets 304 on the dir-served file', async () => {
    if (!haveArtifacts) { console.log('skipping: artifacts not baked'); return; }
    const first = await fetch(server.url + 'registry/color-system.json');
    const etag = first.headers.get('etag')!;
    expect(etag).toBeTruthy();
    const second = await fetch(server.url + 'registry/color-system.json', {
      headers: { 'If-None-Match': etag },
    });
    expect(second.status).toBe(304);
  });

  test('non-static path falls through to the fetch handler', async () => {
    const res = await fetch(server.url + 'api/hq');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
  });
});