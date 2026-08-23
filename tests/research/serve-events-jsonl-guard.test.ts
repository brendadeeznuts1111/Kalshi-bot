/**
 * Path-traversal guard on /api/events.jsonl?file= (server-audit finding):
 * only bare log names inside LIVE_TRACKER_LOG_DIR are accepted; any
 * separator, dot-dot, or absolute path is rejected with 400.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createResearchServer } from '../../src/research/serve.ts';

describe('/api/events.jsonl path traversal guard', () => {
  let server: ReturnType<typeof createResearchServer>;

  beforeAll(() => { server = createResearchServer({ port: 0 }); });
  afterAll(() => { server.stop(true); });

  test('dot-dot traversal is rejected with 400', async () => {
    const r = await fetch(server.url + 'api/events.jsonl?file=..%2F..%2Fbunfig.toml');
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(String(body.error)).toContain('invalid log file name');
  });

  test('absolute path is rejected with 400', async () => {
    const r = await fetch(server.url + 'api/events.jsonl?file=%2Fetc%2Fpasswd');
    expect(r.status).toBe(400);
  });

  test('legitimate bare filename reaches the normal path (404 listing)', async () => {
    const r = await fetch(server.url + 'api/events.jsonl?file=no-such-log.jsonl');
    expect(r.status).toBe(404); // passes the guard, then no such file
    const body = await r.json() as { error: string; available?: string[] };
    expect(String(body.error)).toContain('no such log file');
    expect(Array.isArray(body.available)).toBe(true);
  });
});