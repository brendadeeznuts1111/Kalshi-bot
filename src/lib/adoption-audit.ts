/**
 * adoption-audit core: check how much of Bun v1.4's stable networking
 * stack the repo actually uses (docs/AGENT-PITFALLS.md section 19 + the
 * server-networking summary paste):
 *   1. Bun.serve dir routes (routes { dir }) for static assets
 *   2. fetch() compress option (request-body compression)
 *   3. fetch() protocol:'http2' (experimental h2 client)
 *
 * This is a COVERAGE report (which features are adopted), not a hard
 * gate: every check has ok (used), 'n/a' (feature not applicable to this
 * repo's shape - e.g. no static assets, no large uploads), or 'gap'
 * (feature exists AND applies but is unused - a real adoption
 * opportunity). Only 'gap' is actionable; the CLI reports them.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { rgFiles } from './rg.ts';

export type AdoptionCheck = { name: string; status: 'ok' | 'gap' | 'n/a'; detail: string };

// grepFiles -> shared rgFiles (src/lib/rg.ts): audit self-exclusion is
// structural there (pitfalls 17/24/27).

export function runAdoptionAudit(root: string): AdoptionCheck[] {
  const checks: AdoptionCheck[] = [];
  const src = join(root, 'src');
  const tools = join(root, 'tools');
  const dirs = [src, tools];

  // 1. Dir routes for static assets.
  const dirRoutes = rgFiles(root, '\\{ dir:', dirs);
  const hasStaticAssets = existsSync(join(root, 'public')) && readdirSync(join(root, 'public')).length > 0;
  checks.push({
    name: 'Bun.serve dir routes for static assets',
    status: dirRoutes.length ? 'ok' : hasStaticAssets ? 'gap' : 'n/a',
    detail: dirRoutes.length
      ? 'dir routes in: ' + dirRoutes.join(', ')
      : hasStaticAssets ? 'public/ exists but no routes { dir } - adopt for sendfile/ETag/Range' : 'no static assets dir - not applicable',
  });

  // 2. fetch() compress option.
  const compressUses = rgFiles(root, 'compress: ["\'](gzip|deflate|br|zstd)["\']', dirs);
  // Heuristic: does the repo POST bodies anywhere (would benefit)?
  const posts = rgFiles(root, 'method: ["\']POST["\']', dirs);
  checks.push({
    name: 'fetch() compress option (request-body compression)',
    status: compressUses.length ? 'ok' : posts.length ? 'gap' : 'n/a',
    detail: compressUses.length
      ? 'compress used in: ' + compressUses.join(', ')
      : posts.length ? 'POST bodies exist (' + posts.length + ' files) but none use compress - only worth it for LARGE bodies (>~100KB); inspect before adopting' : 'no POST bodies found - not applicable',
  });

  // 3. fetch() protocol:'http2' OR the global env flag (paste: 'check
  //    if protocol:http2 appears, OR if BUN_FEATURE_FLAG_EXPERIMENTAL_
  //    HTTP2_CLIENT is set in environment').
  const h2Uses = rgFiles(root, 'protocol: ("|\x27)http2(\x27|")', dirs);
  // rgFiles needs EXISTING dirs; .env is gitignored so a fresh clone
  // lacks it - rg exits 2 on a missing path and rgFiles returns []
  // (recon finding, MEDIUM). Filter to files that actually exist.
  const h2FlagFiles = ['bunfig.toml', '.env', '.env.example']
    .map((f) => join(root, f))
    .filter((f) => existsSync(f));
  const h2Flag = h2FlagFiles.length ? rgFiles(root, 'BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT', h2FlagFiles) : [];
  const fetchCalls = rgFiles(root, 'fetch\\(', dirs);
  const h2Adopted = h2Uses.length > 0 || h2Flag.length > 0;
  checks.push({
    name: 'fetch() protocol:http2 (experimental h2 client)',
    status: h2Adopted ? 'ok' : fetchCalls.length ? 'gap' : 'n/a',
    detail: h2Adopted
      ? h2Uses.length ? 'protocol:http2 in: ' + h2Uses.join(', ') : 'BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT in: ' + h2Flag.join(', ')
      : fetchCalls.length ? fetchCalls.length + ' files call fetch() without protocol:http2 or the env flag - experimental, optional' : 'no fetch calls - not applicable',
  });

  return checks;
}

/** True when no check is a 'gap' (n/a and ok both pass). */
export function adoptionAuditPasses(checks: AdoptionCheck[]): boolean {
  return checks.every((c) => c.status !== 'gap');
}