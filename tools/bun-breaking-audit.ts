/**
 * `bun run bun:breaking-audit` — audit THIS repo against Bun v1.4 breaking
 * changes (docs/AGENT-PITFALLS.md section 16).
 *
 * Greps the codebase for every v1.4 break and probes runtime facts:
 *   - res.writeHeader removed (use writeHead)
 *   - bun.lock v2 (written by 1.4; ours stays v1 under frozenLockfile)
 *   - .env not auto-loaded under the node interpreter
 *   - Bun.YAML is now YAML 1.2 (yes/on/no no longer booleans)
 *   - Temporal API enabled
 *   - TLS stricter (ERR_TLS_CERT_ALTNAME_INVALID for IP/localhost)
 *   - NODE_MODULE_VERSION 147 (native addons need rebuild)
 *
 * Exits 0 when nothing needs action, 1 when a finding needs attention.
 *
 * @see docs/AGENT-PITFALLS.md (sections 13-16: verify, then act)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertBunAtLeast } from '../src/research/bun-native.ts';

assertBunAtLeast('1.4.0', 'bun:breaking-audit');

const ROOT = join(import.meta.dir, '..');
const SELF = join(import.meta.dir, 'bun-breaking-audit.ts');
const SRC = join(ROOT, 'src');
const TOOLS = join(ROOT, 'tools');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

type Finding = { check: string; status: 'ok' | 'warn' | 'fail'; detail: string };

/** Ripgrep file list for a pattern, excluding this tool's own source. */
function grepFiles(pattern: string, dirs: string[]): string[] {
  const { spawnSync } = require('node:child_process');
  const out = spawnSync('rg', ['-l', '--glob', '!**/bun-breaking-audit.ts', pattern, ...dirs], { encoding: 'utf8' });
  if (out.status !== 0) return [];
  return out.stdout.split('\n').filter(Boolean);
}

function rel(path: string): string {
  return path.replace(ROOT + '/', '');
}

function main(): number {
  const findings: Finding[] = [];

  // 1. res.writeHeader removed (v1.4): any usage would crash at runtime.
  const wH = grepFiles('writeHeader', [SRC, TOOLS]);
  findings.push({
    check: 'res.writeHeader (removed in 1.4)',
    status: wH.length ? 'fail' : 'ok',
    detail: wH.length ? 'USED in ' + wH.map(rel).join(', ') : 'no usage (Response/Bun.serve handlers only)',
  });

  // 2. bun.lock version: 1.4 writes v2; ours must stay v1 under frozen policy.
  const lockPath = join(ROOT, 'bun.lock');
  let lockVersion = 'absent';
  let frozen = false;
  if (existsSync(lockPath)) {
    const head = readFileSync(lockPath, 'utf8').slice(0, 400);
    const m = head.match(/"lockfileVersion"\s*:\s*(\d+)/);
    lockVersion = m ? m[1]! : 'unknown';
  }
  const bf = join(ROOT, 'bunfig.toml');
  if (existsSync(bf)) {
    frozen = /frozenLockfile\s*=\s*true/.test(readFileSync(bf, 'utf8'));
  }
  findings.push({
    check: 'bun.lock version (1.4 writes v2; old Bun cannot read it)',
    status: lockVersion === '1' && frozen ? 'ok' : 'warn',
    detail: 'lockfileVersion=' + lockVersion + (frozen ? ' (frozenLockfile=true, safe)' : ' (NOT frozen - unfreeze dance would rewrite to v2)'),
  });

  // 3. node interpreter in scripts: .env NOT auto-loaded under node.
  const scripts = PKG.scripts ?? {};
  const nodeScripts = Object.entries(scripts).filter(([, v]) => /(^|[^a-z])node([^a-z]|$)/.test(v ?? ''));
  findings.push({
    check: '.env not auto-loaded under the node interpreter',
    status: nodeScripts.length ? 'warn' : 'ok',
    detail: nodeScripts.length ? 'scripts use node: ' + nodeScripts.map(([k]) => k).join(', ') : 'no node interpreter in package.json scripts',
  });

  // 4. Bun.YAML now YAML 1.2: 1.1-style yes/on/no booleans break.
  const yaml = grepFiles('Bun\\.YAML|from .yaml.|yaml\.parse|YAML\.parse', [SRC, TOOLS]);
  findings.push({
    check: 'Bun.YAML is YAML 1.2 (yes/on/no no longer booleans)',
    status: yaml.length ? 'warn' : 'ok',
    detail: yaml.length ? 'YAML parsed in: ' + yaml.map(rel).join(', ') + ' - check for 1.1-style keys' : 'no YAML parsing in src/tools',
  });

  // 5. Temporal API enabled (behavioral change vs Date).
  const temporal = grepFiles('Temporal\\.', [SRC, TOOLS]);
  findings.push({
    check: 'Temporal API enabled (behavioral change)',
    status: temporal.length ? 'warn' : 'ok',
    detail: temporal.length ? 'Temporal used in: ' + temporal.map(rel).join(', ') : 'no Temporal usage',
  });

  // 6. TLS stricter (IP/localhost cert altname checks): look for actual
  //    TLS option objects (rejectUnauthorized:false in code), not the
  //    word servername (openssl CLI SNI arg is a legit use).
  const tls = grepFiles('rejectUnauthorized\\s*:\\s*false', [SRC, TOOLS]);
  findings.push({
    check: 'TLS stricter (ERR_TLS_CERT_ALTNAME_INVALID)',
    status: tls.length ? 'warn' : 'ok',
    detail: tls.length ? 'rejectUnauthorized:false in: ' + tls.map(rel).join(', ') + ' - verify hostname-based, not IP' : 'no rejectUnauthorized:false overrides',
  });

  // 7. Native addons (NODE_MODULE_VERSION 147): real .node binaries or
  //    known addon deps. (Beware false positives: table.nodeId etc.)
  const allDeps = { ...(PKG.dependencies ?? {}), ...(PKG.devDependencies ?? {}) };
  const addonDeps = Object.keys(allDeps).filter((d) => /node-gyp|napi|better-sqlite3|sharp|bcrypt|canvas/.test(d));
  const { spawnSync } = require('node:child_process');
  const findOut = spawnSync('find', [SRC, TOOLS, '-name', '*.node', '-type', 'f'], { encoding: 'utf8' });
  const addonFiles = (findOut.stdout ?? '').split('\n').filter(Boolean);
  findings.push({
    check: 'Native addons (NODE_MODULE_VERSION 147 rebuild)',
    status: addonDeps.length || addonFiles.length ? 'warn' : 'ok',
    detail: addonDeps.length || addonFiles.length
      ? 'addon deps: ' + (addonDeps.join(', ') || 'none') + '; .node files: ' + (addonFiles.map(rel).join(', ') || 'none')
      : 'no native addon dependencies or .node files',
  });

  let problems = 0;
  for (const f of findings) {
    const mark = f.status === 'ok' ? 'ok   ' : f.status === 'warn' ? 'WARN ' : 'FAIL ';
    if (f.status !== 'ok') problems++;
    console.log('  ' + mark + f.check + ': ' + f.detail);
  }
  console.log('breaking-audit: ' + (problems === 0 ? 'ok - no v1.4 breakage in this repo' : problems + ' finding(s) need attention') + ' · 7 checks');
  return problems === 0 ? 0 : 1;
}

process.exit(main());