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
import { spawnSync } from 'node:child_process';

export type AdoptionCheck = { name: string; status: 'ok' | 'gap' | 'n/a'; detail: string };

function grepFiles(root: string, pattern: string, dirs: string[]): string[] {
  const out = spawnSync('rg', ['-l', '--glob', '!**/*audit*.ts', pattern, ...dirs], { encoding: 'utf8' });
  if (out.status !== 0) return [];
  return out.stdout.split('\n').filter(Boolean).map((p) => p.replace(root + '/', ''));
}

export function runAdoptionAudit(root: string): AdoptionCheck[] {
  const checks: AdoptionCheck[] = [];
  const src = join(root, 'src');
  const tools = join(root, 'tools');
  const dirs = [src, tools];

  // 1. Dir routes for static assets.
  const dirRoutes = grepFiles(root, '\\{ dir:', dirs);
  const hasStaticAssets = existsSync(join(root, 'public')) && readdirSync(join(root, 'public')).length > 0;
  checks.push({
    name: 'Bun.serve dir routes for static assets',
    status: dirRoutes.length ? 'ok' : hasStaticAssets ? 'gap' : 'n/a',
    detail: dirRoutes.length
      ? 'dir routes in: ' + dirRoutes.join(', ')
      : hasStaticAssets ? 'public/ exists but no routes { dir } - adopt for sendfile/ETag/Range' : 'no static assets dir - not applicable',
  });

  // 2. fetch() compress option.
  const compressUses = grepFiles(root, 'compress: ["\'](gzip|deflate|br|zstd)["\']', dirs);
  // Heuristic: does the repo POST bodies anywhere (would benefit)?
  const posts = grepFiles(root, 'method: ["\']POST["\']', dirs);
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
  const h2Uses = grepFiles(root, 'protocol: ("|\x27)http2(\x27|")', dirs);
  const h2Flag = grepFiles(root, 'BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT', [join(root, 'bunfig.toml'), join(root, '.env'), join(root, '.env.example')]);
  const fetchCalls = grepFiles(root, 'fetch\\(', dirs);
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