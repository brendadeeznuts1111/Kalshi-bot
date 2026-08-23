/**
 * h2 integration for fetch-pool (src/lib/fetch-pool.ts). Verified in
 * docs/AGENT-PITFALLS.md section 14: 1.4.0 fetch supports protocol:
 * 'http2' over TLS (ALPN; plaintext h2c unsupported -> HTTP2Unsupported),
 * and 20 parallel h2 requests multiplex to ONE connection.
 */
import { describe, test, expect, afterAll } from 'bun:test';
import http2 from 'node:http2';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fetchText, fetchPool } from '../../src/lib/fetch-pool.ts';

let server: any = null;
let cert: string | undefined;
let key: string | undefined;
let conns = 0;

async function setup() {
  try {
    execSync('openssl req -x509 -newkey rsa:2048 -keyout /tmp/h2t-key.pem -out /tmp/h2t-cert.pem -days 1 -nodes -subj /CN=localhost 2>/dev/null');
    key = readFileSync('/tmp/h2t-key.pem', 'utf8');
    cert = readFileSync('/tmp/h2t-cert.pem', 'utf8');
  } catch {
    return false; // openssl unavailable - skip
  }
  conns = 0;
  server = http2.createSecureServer({ key, cert });
  server.on('session', () => { conns++; });
  server.on('stream', (stream: any) => { stream.respond({ ':status': 200 }); stream.end('h2-ok'); });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  return true;
}

describe('fetchPool protocol:http2', () => {
  test('multiplexes 12 parallel requests over ONE connection', async () => {
    if (!(await setup())) {
      console.log('skipping: openssl unavailable');
      return;
    }
    const port = (server.address() as any).port;
    const tls = { rejectUnauthorized: false };
    const urls = Array.from({ length: 12 }, (_, i) => 'https://127.0.0.1:' + port + '/p' + i);
    // fetchText path with per-request protocol
    const single = await fetchText(urls[0]!, { timeoutMs: 3000, protocol: 'http2', tls } as Parameters<typeof fetch>[1]);
    expect(single.ok).toBe(true);
    expect(single.text).toBe('h2-ok');
    // fetchPool path with protocol option
    const results = await fetchPool(urls, { concurrency: 4, protocol: 'http2', timeoutMs: 3000, warmDns: false, fetchInit: { tls } as Parameters<typeof fetch>[1] });
    expect(results).toHaveLength(12);
    expect(results.every((r) => r.ok && r.text === 'h2-ok')).toBe(true);
    expect(conns).toBe(1); // multiplexed: ONE TLS connection for all 12
  });
});

afterAll(() => {
  server?.close();
});