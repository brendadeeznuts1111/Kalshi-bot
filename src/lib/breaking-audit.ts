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
import { rgFiles } from './rg.ts';

export type FindingStatus = 'ok' | 'warn' | 'fail';
export type BreakingFinding = { check: string; status: FindingStatus; detail: string };

// grepFiles -> shared rgFiles (src/lib/rg.ts): mandatory audit self-
// exclusion + escaping handled structurally (pitfalls 17/24/27).

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
  // Audit/probe machinery legitimately mentions removed APIs in check
  // Extra files that legitimately mention removed APIs in check labels /
  // probe names (not as calls): pre-commit.ts gate labels, runtime-
  // surface.ts probe names. The shared rgFiles already excludes the
  // audit glob by default; these ride the exclude option.
  const LABEL_FILES = ['**/pre-commit.ts', '**/runtime-surface.ts'];

  // 1. res.writeHeader removed (v1.4): any usage would crash at runtime.
  const wH = rgFiles(root, 'writeHeader', dirs, { exclude: LABEL_FILES });
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
  const yaml = rgFiles(root, 'Bun\\.YAML|yaml\.parse|YAML\.parse', dirs, { exclude: LABEL_FILES });
  findings.push({
    check: 'Bun.YAML is YAML 1.2 (yes/on/no no longer booleans)',
    status: yaml.length ? 'warn' : 'ok',
    detail: yaml.length ? 'YAML parsed in: ' + yaml.join(', ') + ' - check for 1.1-style keys' : 'no YAML parsing in src/tools',
  });

  // 5. Temporal API enabled (behavioral change vs Date).
  const temporal = rgFiles(root, 'Temporal\\.', dirs, { exclude: LABEL_FILES });
  findings.push({
    check: 'Temporal API enabled (behavioral change)',
    status: temporal.length ? 'warn' : 'ok',
    detail: temporal.length ? 'Temporal used in: ' + temporal.join(', ') : 'no Temporal usage',
  });

  // 6. TLS stricter: actual rejectUnauthorized:false overrides.
  const tls = rgFiles(root, 'rejectUnauthorized\\s*:\\s*false', dirs, { exclude: LABEL_FILES });
  findings.push({
    check: 'TLS stricter (ERR_TLS_CERT_ALTNAME_INVALID)',
    status: tls.length ? 'warn' : 'ok',
    detail: tls.length ? 'rejectUnauthorized:false in: ' + tls.join(', ') + ' - verify hostname-based, not IP' : 'no rejectUnauthorized:false overrides',
  });

  // 7. Native addons: real .node binaries or known addon deps.
  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const addonDeps = Object.keys(allDeps).filter((d) => /node-gyp|napi|better-sqlite3|sharp|bcrypt|canvas/.test(d));
  let addonFiles: string[] = [];
  try {
    const findOut = Bun.spawnSync(['find', src, tools, '-name', '*.node', '-type', 'f'], { stdout: 'pipe', stderr: 'pipe' });
    addonFiles = findOut.stdout.toString().split('\n').filter(Boolean).map((p) => p.replace(root + '/', ''));
  } catch {
    addonFiles = []; // find unavailable - treat as no addon files
  }
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