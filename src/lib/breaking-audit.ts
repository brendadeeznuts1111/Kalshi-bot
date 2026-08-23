/**
 * Breaking-changes audit core (Bun v1.4) — pure-ish, importable.
 *
 * Runs the section-16 checks against a repo root and returns findings:
 *   - res.writeHeader removed (use writeHead)
 *   - bun.lock v2 (written by 1.4; v1 is safe only under frozenLockfile)
 *   - .env not auto-loaded under the node interpreter
 *   - Bun.YAML is YAML 1.2 (yes/on/no no longer booleans)
 *   - Temporal API enabled
 *   - TLS stricter (rejectUnauthorized:false overrides)
 *   - NODE_MODULE_VERSION 147 (native addons need rebuild)
 *
 * Traps (docs/AGENT-PITFALLS.md section 17): exclude the tool's own
 * source from rg; find -name '*.node' instead of rg '\\.node' (matches
 * table.nodeId columns); openssl CLI '-servername' is SNI, not a TLS
 * override.
 *
 * CLI wrapper: tools/bun-breaking-audit.ts (bun:breaking-audit).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export type FindingStatus = 'ok' | 'warn' | 'fail';
export type BreakingFinding = { check: string; status: FindingStatus; detail: string };

/** Ripgrep file list for a pattern under dirs, excluding globs. */
function grepFiles(root: string, pattern: string, dirs: string[], exclude: string[] = []): string[] {
  const args = ['-l', ...exclude.flatMap((e) => ['--glob', '!' + e]), pattern, ...dirs];
  const out = spawnSync('rg', args, { encoding: 'utf8' });
  if (out.status !== 0) return [];
  return out.stdout.split('\n').filter(Boolean).map((p) => p.replace(root + '/', ''));
}

/**
 * Audit a repo root against the Bun 1.4 breaking changes.
 * @param root repo root (with package.json, bun.lock, bunfig.toml)
 * @returns findings (ok/warn/fail each) — caller decides gating
 */
export function runBreakingAudit(root: string): BreakingFinding[] {
  const findings: BreakingFinding[] = [];
  const src = join(root, 'src');
  const tools = join(root, 'tools');
  const dirs = [src, tools];
  // Audit/label text legitimately mentions removed APIs (check names) -
  // exclude those files from the call-site scan.
  const SELF_EXCLUDE = ['**/bun-breaking-audit.ts', '**/breaking-audit.ts', '**/pre-commit.ts'];

  // 1. res.writeHeader removed (v1.4): any usage would crash at runtime.
  const wH = grepFiles(root, 'writeHeader', dirs, SELF_EXCLUDE);
  findings.push({
    check: 'res.writeHeader (removed in 1.4)',
    status: wH.length ? 'fail' : 'ok',
    detail: wH.length ? 'USED in ' + wH.join(', ') : 'no usage (Response/Bun.serve handlers only)',
  });

  // 2. bun.lock version: 1.4 writes v2; v1 is safe only when frozen.
  const lockPath = join(root, 'bun.lock');
  let lockVersion = 'absent';
  let frozen = false;
  if (existsSync(lockPath)) {
    const head = readFileSync(lockPath, 'utf8').slice(0, 400);
    const m = head.match(/"lockfileVersion"\s*:\s*(\d+)/);
    lockVersion = m ? m[1]! : 'unknown';
  }
  const bf = join(root, 'bunfig.toml');
  if (existsSync(bf)) {
    frozen = /frozenLockfile\s*=\s*true/.test(readFileSync(bf, 'utf8'));
  }
  findings.push({
    check: 'bun.lock version (1.4 writes v2; old Bun cannot read it)',
    status: lockVersion === '1' && frozen ? 'ok' : 'warn',
    detail: 'lockfileVersion=' + lockVersion + (frozen ? ' (frozenLockfile=true, safe)' : ' (NOT frozen - unfreeze dance would rewrite to v2)'),
  });

  // 3. node interpreter in scripts: .env NOT auto-loaded under node.
  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try { pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); } catch { /* not a repo */ }
  const scripts = pkg.scripts ?? {};
  const nodeScripts = Object.entries(scripts).filter(([, v]) => /(^|[^a-z])node([^a-z]|$)/.test(v ?? ''));
  findings.push({
    check: '.env not auto-loaded under the node interpreter',
    status: nodeScripts.length ? 'warn' : 'ok',
    detail: nodeScripts.length ? 'scripts use node: ' + nodeScripts.map(([k]) => k).join(', ') : 'no node interpreter in package.json scripts',
  });

  // 4. Bun.YAML now YAML 1.2: 1.1-style yes/on/no booleans break.
  const yaml = grepFiles(root, 'Bun\\.YAML|yaml\.parse|YAML\.parse', dirs, SELF_EXCLUDE);
  findings.push({
    check: 'Bun.YAML is YAML 1.2 (yes/on/no no longer booleans)',
    status: yaml.length ? 'warn' : 'ok',
    detail: yaml.length ? 'YAML parsed in: ' + yaml.join(', ') + ' - check for 1.1-style keys' : 'no YAML parsing in src/tools',
  });

  // 5. Temporal API enabled (behavioral change vs Date).
  const temporal = grepFiles(root, 'Temporal\\.', dirs, SELF_EXCLUDE);
  findings.push({
    check: 'Temporal API enabled (behavioral change)',
    status: temporal.length ? 'warn' : 'ok',
    detail: temporal.length ? 'Temporal used in: ' + temporal.join(', ') : 'no Temporal usage',
  });

  // 6. TLS stricter: actual rejectUnauthorized:false overrides.
  const tls = grepFiles(root, 'rejectUnauthorized\\s*:\\s*false', dirs, SELF_EXCLUDE);
  findings.push({
    check: 'TLS stricter (ERR_TLS_CERT_ALTNAME_INVALID)',
    status: tls.length ? 'warn' : 'ok',
    detail: tls.length ? 'rejectUnauthorized:false in: ' + tls.join(', ') + ' - verify hostname-based, not IP' : 'no rejectUnauthorized:false overrides',
  });

  // 7. Native addons: real .node binaries or known addon deps.
  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const addonDeps = Object.keys(allDeps).filter((d) => /node-gyp|napi|better-sqlite3|sharp|bcrypt|canvas/.test(d));
  const findOut = spawnSync('find', [src, tools, '-name', '*.node', '-type', 'f'], { encoding: 'utf8' });
  const addonFiles = (findOut.stdout ?? '').split('\n').filter(Boolean).map((p) => p.replace(root + '/', ''));
  findings.push({
    check: 'Native addons (NODE_MODULE_VERSION 147 rebuild)',
    status: addonDeps.length || addonFiles.length ? 'warn' : 'ok',
    detail: addonDeps.length || addonFiles.length
      ? 'addon deps: ' + (addonDeps.join(', ') || 'none') + '; .node files: ' + (addonFiles.join(', ') || 'none')
      : 'no native addon dependencies or .node files',
  });

  return findings;
}

/** True when every finding is ok (usable as a gate). */
export function breakingAuditPasses(findings: BreakingFinding[]): boolean {
  return findings.every((f) => f.status === 'ok');
}