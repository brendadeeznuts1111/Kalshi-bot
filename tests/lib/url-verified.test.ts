// Locks the RFC 3986 / WHATWG URL host behaviors verified on Bun 1.4.0.
import { describe, expect, test } from 'bun:test';
import { parseAuthority, hostsEqual } from '../../src/lib/url-authority.ts';

describe('URL host verified patterns (Bun 1.4.0)', () => {
  test('IPv6 hostname carries brackets; host/port/origin separate correctly', () => {
    const a = parseAuthority('https://[2001:db8::1]:8443/odds');
    expect(a.hostname).toBe('[2001:db8::1]');
    expect(a.host).toBe('[2001:db8::1]:8443');
    expect(a.port).toBe('8443');
    expect(a.isIpv6).toBe(true);
    expect(a.ipv4).toBeNull();
  });

  test('DNS hostnames are lowercased; paths stay case-sensitive', () => {
    expect(parseAuthority('https://API.EXAMPLE.COM:8443/odds').hostname).toBe('api.example.com');
    expect(parseAuthority('https://API.EXAMPLE.COM:8443/odds').host).toBe('api.example.com:8443');
    expect(new URL('https://example.com/Odds').pathname).not.toBe(new URL('https://example.com/odds').pathname);
  });

  test('exotic IPv4 forms are NORMALIZED to dotted decimal by the parser', () => {
    expect(parseAuthority('http://0x7f.1/').hostname).toBe('127.0.0.1');
    expect(parseAuthority('http://2130706433/').hostname).toBe('127.0.0.1');
    expect(parseAuthority('http://0177.0.0.1/').hostname).toBe('127.0.0.1');
    expect(parseAuthority('http://0x7f.1/').ipv4).toBe('127.0.0.1');
  });

  test('a numeric last label that is not valid IPv4 is an INVALID URL', () => {
    expect(() => new URL('http://example.1/')).toThrow();
  });

  test('hostsEqual compares normalized hosts (case + IPv4 canonical)', () => {
    expect(hostsEqual('API.EXAMPLE.COM', 'api.example.com')).toBe(true);
    expect(hostsEqual('http://0x7f.1/', 'http://127.0.0.1/')).toBe(true);
    expect(hostsEqual('api.example.com', 'example.com')).toBe(false);
  });

  test('fetch accepts tls.serverName + Host override (identity vs destination)', async () => {
    const res = await fetch('https://bun.sh/logo.png', {
      tls: { serverName: 'bun.sh' } as any,
      headers: { Host: 'bun.sh' } as any,
      protocol: 'http2',
    });
    expect(res.status).toBe(200);
  });

  test('URLPattern hostname wildcards are NOT supported in Bun 1.4.0 (pathname groups only)', () => {
    // Documented limitation: {subdomain} / * in hostname never matches; the
    // repo relies on pathname groups (tests: URLPattern blog vectors v1.3.4).
    expect(new URLPattern('https://{subdomain}.example.com/x').test('https://api.example.com/x')).toBe(false);
    expect(new URLPattern('https://example.com/files/*').test('https://example.com/files/a')).toBe(true);
  });
});
