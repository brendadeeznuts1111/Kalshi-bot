// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import type { FetchFn } from '../../src/institutions/resilient-fetch.ts';
import {
  fingerprintSecret,
  formatSessionPlaneProbeReport,
  jwtSafeClaims,
  probeSessionPlanes,
  redactUrl,
} from '../../src/inventory/session-plane-probe.ts';

describe('session-plane-probe helpers', () => {
  test('fingerprintSecret never echoes full value', () => {
    const fp = fingerprintSecret('5dtp0926i2ccspn1gob68u51tb');
    expect(fp).toContain('…');
    expect(fp).not.toContain('5dtp0926i2ccspn1gob68u51tb');
    expect(fingerprintSecret('')).toBeNull();
  });

  test('redactUrl strips gsid and hash', () => {
    const u = redactUrl(
      'https://plive.sportswidgets.pro/live/?gsid=abc123secret&lang=en&hash=deadbeef'
    );
    expect(u).toContain('gsid=%3Credacted%3E');
    expect(u).toContain('hash=%3Credacted%3E');
    expect(u).not.toContain('abc123secret');
    expect(u).not.toContain('deadbeef');
  });

  test('jwtSafeClaims omits ip/userId', () => {
    const payload = {
      cid: 'gs6487',
      ipAddress: '1.2.3.4',
      userId: 2773445,
      domain: 'plive.sportswidgets.pro',
      iat: 100,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const b64 = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const token = `eyJhbGciOiJIUzI1NiJ9.${b64}.sig`;
    const claims = jwtSafeClaims(token);
    expect(claims?.domain).toBe('plive.sportswidgets.pro');
    expect(claims?.cid).toBe('gs6487');
    expect(claims).not.toHaveProperty('ipAddress');
    expect(claims).not.toHaveProperty('userId');
  });
});

describe('probeSessionPlanes', () => {
  test('classifies public list + gated token with mock fetch', async () => {
    const fetchImpl: FetchFn = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url.includes('stream-list-v2')) {
        return new Response(
          JSON.stringify({
            sports: {
              tennis: { count: 2, events: { '1': {}, '2': {} } },
              baseball: { count: 1, events: { '3': {} } },
            },
            error: 0,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.includes('/live/')) {
        return new Response('<html><title>GS Betting</title></html>', {
          status: 200,
          headers: {
            'content-type': 'text/html',
            'x-gsid': 'anonmintedsessionid0001',
            'set-cookie': 'GSID=anonmintedsessionid0001; path=/; secure',
          },
        });
      }
      if (url.includes('streamToken')) {
        if (headers.get('x-gsid')) {
          const payload = btoa(
            JSON.stringify({
              domain: 'plive.sportswidgets.pro',
              cid: 'gs1',
              exp: Math.floor(Date.now() / 1000) + 100,
            })
          )
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
          return new Response(`eyJhbGciOiJub25lIn0.${payload}.x`, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          });
        }
        return new Response(JSON.stringify({ e: 999, d: 'Operation failed' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('no', { status: 404 });
    };

    const report = await probeSessionPlanes({
      fetchImpl,
      gsid: 'boundgsidvalue1234567890',
      timeoutMs: 5_000,
    });

    expect(report.summary.inventoryPublicOk).toBe(true);
    expect(report.summary.streamTokenRequiresGsidOk).toBe(true);
    expect(report.summary.boundGsid).toBe('ok');
    expect(report.summary.allRequiredOk).toBe(true);

    const list = report.checks.find((c) => c.id === 'stream-list-v2')!;
    expect(list.detail.sportBuckets).toBe(2);
    expect(list.detail.eventApprox).toBe(3);

    const text = formatSessionPlaneProbeReport(report);
    expect(text).toContain('PASS');
    expect(text).not.toContain('boundgsidvalue1234567890');
    expect(text).not.toContain('anonmintedsessionid0001');
  });

  test('fails closed when stream-list is empty', async () => {
    const fetchImpl: FetchFn = async (input) => {
      const url = String(input);
      if (url.includes('stream-list')) {
        return new Response(JSON.stringify({ sports: {} }), { status: 200 });
      }
      if (url.includes('/live/')) {
        return new Response('ok', {
          status: 200,
          headers: { 'x-gsid': 'x'.repeat(20) },
        });
      }
      if (url.includes('streamToken')) {
        return new Response('no', { status: 403 });
      }
      return new Response('no', { status: 404 });
    };
    const report = await probeSessionPlanes({ fetchImpl });
    expect(report.summary.inventoryPublicOk).toBe(false);
    expect(report.summary.allRequiredOk).toBe(false);
  });
});
