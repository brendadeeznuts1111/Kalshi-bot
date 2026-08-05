import { describe, expect, test } from 'bun:test';
import { handleRequest } from '../playground/funding-playground.ts';

describe('funding playground server', () => {
  test('serves html on /', async () => {
    const res = await handleRequest(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  test('serves javascript bundle', async () => {
    const res = await handleRequest(new Request('http://localhost/funding-playground.js'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  test('reports environment on /api/env', async () => {
    const res = await handleRequest(new Request('http://localhost/api/env'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.env).toBeDefined();
    expect(typeof json.base).toBe('string');
    expect(String(json.base)).toContain('kalshi');
  });

  test('health endpoint returns ok', async () => {
    const res = await handleRequest(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.status).toBe('ok');
    expect(typeof json.credentialsLoaded).toBe('boolean');
  });

  test('unknown route returns 404', async () => {
    const res = await handleRequest(new Request('http://localhost/api/unknown'));
    expect(res.status).toBe(404);
  });
});