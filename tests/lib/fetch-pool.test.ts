/**
 * fetch-pool defaults (src/lib/fetch-pool.ts): bounded concurrency, body
 * consumption, per-request timeout, DNS warm-up, error capture.
 * Findings backing these defaults: docs/AGENT-PITFALLS.md section 11
 * (HTTP/1.1 only on 1.4.0 -> each concurrent fetch = one TCP connection,
 * so the bound is the peak socket count; unread bodies block reuse).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { fetchText, fetchPool, warmDns } from '../../src/lib/fetch-pool.ts';

let server: ReturnType<typeof Bun.serve> | null = null;
let peak = 0;
let active = 0;
let requests = 0;
const body = 'pool-test-' + 'x'.repeat(1000);

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch() {
      requests++;
      active++;
      peak = Math.max(peak, active);
      return new Promise((resolve) => {
        setTimeout(() => {
          active--;
          resolve(new Response(body));
        }, 20);
      });
    },
  });
});

afterAll(() => {
  server?.stop(true);
});

describe('fetchPool', () => {
  test('bounds concurrent fetches to the requested limit', async () => {
    peak = 0;
    const port = server!.port;
    const urls = Array.from({ length: 12 }, (_, i) => 'http://127.0.0.1:' + port + '/p' + i);
    const results = await fetchPool(urls, { concurrency: 3, warmDns: false });
    expect(results).toHaveLength(12);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // concurrency actually happens
    expect(results.every((r) => r.ok && r.text === body)).toBe(true);
    // order preserved (HTTP/1.1, aligned results)
    expect(results[0]!.url.endsWith('/p0')).toBe(true);
    expect(results[11]!.url.endsWith('/p11')).toBe(true);
  });

  test('captures per-URL failures without throwing', async () => {
    const results = await fetchPool(
      ['http://127.0.0.1:1/closed', 'http://127.0.0.1:' + server!.port + '/ok'],
      { concurrency: 2, warmDns: false, timeoutMs: 2000 },
    );
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toBeTruthy();
    expect(results[1]!.ok).toBe(true);
    expect(results[1]!.text).toBe(body);
  });

  test('empty input returns empty', async () => {
    expect(await fetchPool([])).toEqual([]);
  });
});

describe('fetchText', () => {
  test('consumes the body and reports bytes', async () => {
    const r = await fetchText('http://127.0.0.1:' + server!.port + '/t', { timeoutMs: 2000 });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.bytes).toBe(body.length);
    expect(r.text).toBe(body);
  });

  test('times out a hanging host (AbortSignal.timeout)', async () => {
    const hung = Bun.serve({
      port: 0,
      fetch() { return new Promise(() => {}); },
    });
    try {
      await expect(
        fetchText('http://127.0.0.1:' + hung.port + '/hang', { timeoutMs: 150 }),
      ).rejects.toThrow();
    } finally {
      hung.stop(true);
    }
  });

  test('compress option sets Content-Encoding and round-trips', async () => {
    // Echo server: reports the Content-Encoding it saw and returns the
    // (still-compressed) body so the client can gunzip-verify.
    const echo = Bun.serve({
      port: 0,
      async fetch(req) {
        const r = req as unknown as { headers: Headers; arrayBuffer(): Promise<ArrayBuffer> };
        const enc = r.headers.get('content-encoding') ?? '';
        const raw = new Uint8Array(await r.arrayBuffer());
        return new Response(JSON.stringify({ enc, bytes: raw.byteLength, b64: Buffer.from(raw).toString('base64') }));
      },
    } as Parameters<typeof Bun.serve>[0]);
    try {
      const payload = 'compress-me-'.repeat(1000); // 12KB, compressible
      const r = await fetchText('http://127.0.0.1:' + echo.port + '/c', { method: 'POST', body: payload, compress: 'gzip', timeoutMs: 3000 });
      expect(r.ok).toBe(true);
      const seen = JSON.parse(r.text) as { enc: string; bytes: number; b64: string };
      expect(seen.enc).toBe('gzip');
      expect(seen.bytes).toBeLessThan(payload.length); // compressed smaller
      const gunzipped = new TextDecoder().decode(Bun.gunzipSync(Buffer.from(seen.b64, 'base64')));
      expect(gunzipped).toBe(payload);
    } finally {
      echo.stop(true);
    }
  });
});

describe('warmDns', () => {
  test('never throws, even for nonsense targets', () => {
    expect(() => warmDns(['definitely-not-a-real-host.invalid', { hostname: '127.0.0.1', port: 1 }])).not.toThrow();
  });
});