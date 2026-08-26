/**
 * url-authority.ts — standards-compliant host/authority parsing and comparison.
 *
 * Encodes RFC 3986 §3.2.2 host handling through the WHATWG URL parser
 * (verified on Bun 1.4.0):
 *   - NEVER split an authority on ':' manually — IPv6 contains colons
 *     internally; URL.hostname carries the brackets.
 *   - hostname is lowercased; the path remains case-sensitive.
 *   - WHATWG parses exotic IPv4 forms (hex/octal/integer, e.g. 0x7f.1,
 *     2130706433, 0177.0.0.1) and NORMALIZES them to dotted decimal
 *     (127.0.0.1) — comparing url.hostname is therefore safe.
 *   - A reg-name whose last label is numeric but not valid IPv4
 *     (e.g. "example.1") is an INVALID URL in WHATWG/Bun — it throws.
 */
export type UrlAuthority = {
  protocol: string;
  hostname: string; // normalized, lowercase, IPv6 includes brackets
  host: string;     // hostname[:port]
  port: string;     // '' when default/absent
  isIpv6: boolean;
  /** Canonical dotted-decimal IPv4, or null for IPv6/reg-name. */
  ipv4: string | null;
};

/** Parse a URL and extract the normalized authority. Throws on invalid URLs. */
export function parseAuthority(input: string): UrlAuthority {
  const url = new URL(input);
  const hostname = url.hostname;
  const isIpv6 = hostname.startsWith('[');
  let ipv4: string | null = null;
  if (!isIpv6 && /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    ipv4 = hostname; // WHATWG already normalized exotic forms to dotted decimal
  }
  return { protocol: url.protocol, hostname, host: url.host, port: url.port, isIpv6, ipv4 };
}

/** Host equality for security decisions: normalized (lowercase + IPv4-canonical). */
export function hostsEqual(a: string, b: string): boolean {
  try {
    return parseAuthority(a.startsWith('http') ? a : 'https://' + a).hostname ===
           parseAuthority(b.startsWith('http') ? b : 'https://' + b).hostname;
  } catch {
    return false;
  }
}
