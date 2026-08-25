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
 *   - Bun.serve port fed straight from env (1.4: RangeError on bad port)
 *   - server-side websocket routes / server.upgrade() (426 + upgrade()
 *     false + unmasked-frame 1006 semantics)
 *   - fetch redirect:'error' (1.4: resolves on 304/other 3xx)
 *   - Bun.spawn killSignal:0 / timeout:NaN / argv0 (validation throws)
 *   - Response.error() in handlers (answers 500 via error())
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
  const LABEL_FILES = ['**/pre-commit.ts', '**/runtime-surface.ts', '**/defaults-probe.ts']; // defaults-probe legitimately probes Temporal (§88)

  // TLS probe-only exception: host-discover reads leaf SANs from ANY cert
  // (same semantics as the openssl s_client -showcerts it replaced). You
  // cannot chain-verify a host you are probing to identify for the first
  // time; the SANs only inform a host->skin suggestion and carry no secrets.
  // All other connections must keep chain + hostname verification.
  // docs-validate.ts deliberately uses Bun.YAML (1.2) to validate doc
  // code-block examples with the SAME parser the runtime uses - a 1.1-style
  // yes/on/no key in a doc block is exactly what should be flagged, not
  // hidden (the validator is report-only).
  const YAML_ALLOWLIST = ['**/docs-validate.ts'];
  const TLS_OVERRIDE_ALLOWLIST = [
    '**/host-discover.ts',
    // security:probe deliberately connects with rejectUnauthorized:false to
    // VERIFY the untrusted-handshake path (authorized=false probe) and the
    // ca-alone-does-not-bypass-hostname behavior — a local throwaway cert,
    // no secrets; security-page.ts only DOCUMENTS the pattern (§28).
    '**/tools/security-probe.ts',
    '**/src/research/security-page.ts',
  ];

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
  const yaml = rgFiles(root, 'Bun\.YAML|yaml\.parse|YAML\.parse', dirs, { exclude: [...LABEL_FILES, ...YAML_ALLOWLIST] });
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
  const tls = rgFiles(root, 'rejectUnauthorized\\s*:\\s*false', dirs, { exclude: [...LABEL_FILES, ...TLS_OVERRIDE_ALLOWLIST] });
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
    // Native glob instead of `find` subprocess (deepest Bun pattern): results
    // are root-relative like the old find output; cwd=root so missing dirs
    // simply match nothing.
    addonFiles = [...new Set([
      ...new Bun.Glob('src/**/*.node').scanSync({ cwd: root, onlyFiles: true }),
      ...new Bun.Glob('tools/**/*.node').scanSync({ cwd: root, onlyFiles: true }),
    ])];
  } catch {
    addonFiles = []; // glob unavailable - treat as no addon files
  }
  findings.push({
    check: 'Native addons (NODE_MODULE_VERSION 147 rebuild)',
    status: addonDeps.length || addonFiles.length ? 'warn' : 'ok',
    detail: addonDeps.length || addonFiles.length
      ? 'addon deps: ' + (addonDeps.join(', ') || 'none') + '; .node files: ' + (addonFiles.join(', ') || 'none')
      : 'no native addon dependencies or .node files',
  });

  // 8. Bun.serve port fed straight from env: 1.4 throws RangeError for
  // non-integer/negative/out-of-range ports (NaN from a garbage PORT env
  // now fails at startup instead of binding a random port). Numeric
  // strings still work, so the safe pattern is Number(...) + validate.
  const envPort = rgFiles(root, 'port\\s*:\\s*(Bun\\.env|process\\.env)', dirs, { exclude: LABEL_FILES });
  findings.push({
    check: 'Bun.serve port from raw env (1.4 RangeError on bad port)',
    status: envPort.length ? 'warn' : 'ok',
    detail: envPort.length
      ? 'Bun.serve port reads env directly in: ' + envPort.join(', ') + ' - NaN/garbage now throws RangeError at startup; wrap in Number()'
      : 'no Bun.serve port fed directly from env (serve.ts wraps PORT in Number())',
  });

  // 9. Server-side websocket routes / upgrade(): 1.4 makes server.upgrade()
  // return false unless Upgrade: websocket + well-formed Sec-WebSocket-Key
  // (426 for Sec-WebSocket-Version != 13), closes 1006 on unmasked frames,
  // and ws.subscribe/unsubscribe return false on a closed socket.
  // Deliberate live channel (probe-verified AGENT-PITFALLS §23): /api/live
  // upgrade in serve.ts handles upgrade() false with 400; live-channel.ts
  // uses the standard open/message/close + subscribe/publish surface;
  // live-page.ts only DOCUMENTS the surface. These are the sanctioned
  // usage - the fixture in breaking-audit.test.ts (src/ws.ts) still warns.
  const WS_ALLOWLIST = [
    '**/src/research/serve.ts',
    '**/src/institutions/live-channel.ts',
    '**/src/research/live-page.ts',
    '**/src/research/map-page.ts', // documents server.upgrade() H3 caveat (§39), not a call
  ];
  const wsRoutes = rgFiles(root, 'websocket\\s*:\\s*\\{|\\bupgrade\\(', dirs, { exclude: [...LABEL_FILES, ...WS_ALLOWLIST] });
  findings.push({
    check: 'Bun.serve websocket routes / server.upgrade() (1.4 semantics)',
    status: wsRoutes.length ? 'warn' : 'ok',
    detail: wsRoutes.length
      ? 'server websocket in: ' + wsRoutes.join(', ') + ' - handle upgrade() false + 426 + unmasked-frame 1006'
      : 'no unexpected server-side websocket routes or upgrade() calls (live channel allowlisted)',
  });

  // 10. fetch redirect:'error': 1.4 narrows it to 301/302/303/307/308 only;
  // other 3xx (e.g. 304) now RESOLVE instead of rejecting. Callers that
  // use it to reject all 3xx must check res.status.
  const redirErr = rgFiles(root, 'redirect\\s*:\\s*["\']error["\']', dirs, { exclude: LABEL_FILES });
  findings.push({
    check: 'fetch redirect:"error" (1.4: 304/other 3xx now resolve)',
    status: redirErr.length ? 'warn' : 'ok',
    detail: redirErr.length
      ? 'redirect:"error" in: ' + redirErr.join(', ') + ' - 304 and other 3xx now resolve; check res.status'
      : 'no redirect:"error" usage (repo uses redirect:"follow")',
  });

  // 11. Bun.spawn/SpawnSync validation traps: timeout:NaN and
  // killSignal:0 now throw (before: no-op timeout / no-op signal), NUL
  // bytes in argv0/cwd throw, and an already-aborted signal throws
  // AbortError without creating a process.
  const spawnTraps = rgFiles(root, 'killSignal\\s*:\\s*0\\b|timeout\\s*:\\s*NaN\\b|argv0\\s*:', dirs, { exclude: LABEL_FILES });
  findings.push({
    check: 'Bun.spawn validation traps (timeout NaN / killSignal 0 / argv0)',
    status: spawnTraps.length ? 'warn' : 'ok',
    detail: spawnTraps.length
      ? 'spawn trap patterns in: ' + spawnTraps.join(', ') + ' - timeout:NaN / killSignal:0 / argv0:NUL now throw'
      : 'no spawn timeout:NaN / killSignal:0 / argv0 usage',
  });

  // 12. Response.error() / out-of-range status returned from a handler:
  // 1.4 treats it like a thrown error - goes to error() and answers 500.
  const respErr = rgFiles(root, 'Response\\.error\\(', dirs, { exclude: LABEL_FILES });
  findings.push({
    check: 'Response.error() in handlers (answers 500 via error())',
    status: respErr.length ? 'warn' : 'ok',
    detail: respErr.length
      ? 'Response.error() in: ' + respErr.join(', ') + ' - 1.4 routes it to error() (500 by default)'
      : 'no Response.error() usage in handlers',
  });

  return findings;
}

/** True when every finding is ok (usable as a gate). */
export function breakingAuditPasses(findings: BreakingFinding[]): boolean {
  return findings.every((f) => f.status === 'ok');
}