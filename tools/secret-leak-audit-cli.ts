#!/usr/bin/env bun
/**
 * secret:leak-audit - repo-wide gate for plaintext-secret argv flags (S219).
 *
 * Usage: bun run secret:leak-audit
 * Exits 1 with findings when any CLI passes a SECRET VALUE (not a path) via
 * an argv flag. Path-taking flags (--key-file, --pem) are allowed.
 */
import { joinPath } from '../src/research/paths.ts';
import {
  formatSecretLeakFindings,
  scanSecretLeaks,
  secretLeakAuditPasses,
} from '../src/lib/secret-leak-audit.ts';

const root = joinPath(import.meta.dir, '..');
const findings = scanSecretLeaks(root);
if (secretLeakAuditPasses(findings)) {
  console.log('secret:leak-audit - ok - no secret values on the command line');
  process.exit(0);
}
console.error('secret:leak-audit - ' + findings.length + ' finding(s):');
for (const l of formatSecretLeakFindings(findings)) console.error(l);
process.exit(1);
