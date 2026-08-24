/**
 * security-page.ts — /bun/security: the Bun 1.4 Security Hardening widget.
 * Every claim from the release-blog security section probed against the
 * installed runtime (docs/AGENT-PITFALLS.md §28). Token-built audited page.
 */
import { renderWidgetPage, widgetTable, W_VERIFIED, W_NOTE } from '../lib/widget-page.ts';

export function renderSecurityPage(): string {
  const tls = widgetTable(['Claim', 'Probe'], [
    { cells: ['<code>fetch()</code> + <code>tls.checkServerIdentity</code> runs before request is written', W_VERIFIED + ' callback gets (hostname, cert); returning an Error rejects fetch ("pin mismatch") BEFORE the request goes out'] },
    { cells: ['runs again on each redirect hop', W_NOTE + ' requires a redirecting TLS peer to exercise — callback fires per handshake (probed once)'] },
    { cells: ['<code>tls.connect({host})</code> uses host as default servername', W_VERIFIED + ' by IP -> no servername sent, authorized=false; by localhost -> servername=localhost (matches Node)'] },
    { cells: ['IP/localhost vs cert for another name -> ERR_TLS_CERT_ALTNAME_INVALID', W_VERIFIED + ' probe: 127.0.0.1 vs CN=localhost fails exactly like the blog says'] },
    { cells: ['<code>Bun.connect({tls})</code> defaults rejectUnauthorized: true', W_VERIFIED + ' handshake opens with authorized=false, no data delivered (writes would -1); pass ca or rejectUnauthorized:false'] },
    { cells: ['NODE_TLS_REJECT_UNAUTHORIZED=0 honored', W_NOTE + ' env honored per blog; not exercised (repo never disables verification)'] },
  ]);
  const http = widgetTable(['Framing probe (raw TCP)', 'Result'], [
    { cells: ['valid GET', '200'] },
    { cells: ['Content-Length: abc', '400 Bad Request'] },
    { cells: ['Content-Length + Transfer-Encoding both set (smuggling)', '400 Bad Request'] },
    { cells: ['Content-Length: -1', '400 Bad Request'] },
    { cells: ['duplicate Content-Length (5 and 7)', '400 Bad Request'] },
    { cells: ['invalid chunk size in chunked body', '400 Bad Request (Connection: close)'] },
    { cells: ['valid chunked + trailer', '200, body parsed (length 5)'] },
  ]);
  const clients = widgetTable(['Client', 'TLS hostname verification'], [
    { cells: ['<code>fetch()</code>', W_VERIFIED + ' default on; ca alone does NOT bypass hostname check (probe: ERR_TLS_CERT_ALTNAME_INVALID)'] },
    { cells: ['<code>Bun.connect / upgradeTLS</code>', W_VERIFIED + ' rejectUnauthorized default true in 1.4'] },
    { cells: ['<code>Bun.listen(requestCert:true)</code>', W_NOTE + ' default true per blog — needs a client-cert test to exercise'] },
    { cells: ['RedisClient rediss://', W_NOTE + ' verifies hostname (per blog v1.3.14); no redis server in-repo to probe'] },
    { cells: ['Postgres / MySQL clients', W_NOTE + ' same behavior (documented; not probed here)'] },
  ]);
  const tarball = widgetTable(['Tarball extraction', 'Probe'], [
    { cells: ['github:/URL deps + bun create skip out-of-package entries', W_NOTE + ' path-traversal guard per blog (v1.3.6); needs a crafted tarball to exercise — the repo has no git deps'] },
  ]);
  return renderWidgetPage({
    title: 'Security Hardening',
    subtitle: 'Bun 1.4 release-blog security claims, probed against the installed runtime',
    badges: ['TLS defaults', 'framing 400s', 'checkServerIdentity'],
    links: ['/bun/overview', '/bun/networking', '/health'],
    sections: [
      { heading: 'TLS defaults (v1.3.13 – v1.4.0)', html: tls },
      { heading: 'HTTP request framing hardening (v1.3.4)', html: http + '<p class="muted">All probes were raw TCP against a local Bun.serve — browsers/curl/fetch never send these malformed framings, which is exactly why Bun can 400 them.</p>' },
      { heading: 'Client verification matrix', html: clients },
      { heading: 'Tarball extraction hardening (v1.3.6)', html: tarball },
    ],
    footer: 'Probes: docs/AGENT-PITFALLS.md §28 · probe CLI: bun run security:probe',
  });
}
