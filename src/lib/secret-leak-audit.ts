/**
 * secret-leak-audit.ts - repo-wide scan for plaintext-secret argv flags (S219).
 *
 * Extends the S218 fix (kalshi:secrets --key-secret gate) to the WHOLE repo:
 * scans CLI sources for flags that carry SECRET VALUES on the command line
 * (visible in ps). Flags that take a PATH (--key-file, --pem) are allowed -
 * the value is a path, not the secret. Uses argvSecretLeaks from the
 * registry for the flag-shape detection, then classifies path-vs-value.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { argvSecretLeaks } from './secret-registry.ts';
import { rgFiles } from './rg.ts';

export type SecretLeakFinding = { file: string; flags: string[] };

/**
 * Flags that take a PATH/name rather than the secret value itself - these
 * are NOT leaks (the value on the command line is a path, not the secret).
 */
const PATH_FLAGS = new Set([
  'key-file', 'pem', 'key-file-path', 'private-key-path', 'kalshi-private-key-path',
]);

/** Secret-bearing flag names that are known-safe (path or non-secret). */
const ALLOWED_SECRET_FLAGS = new Set([...PATH_FLAGS]);

/**
 * Scan a repo root for CLI sources with secret-value argv flags. Returns
 * per-file findings with the offending flag names (values never included).
 */
export function scanSecretLeaks(root: string): SecretLeakFinding[] {
  // rg exits 2 (empty result) when ANY path argument is missing (rg.ts trap) -
  // only pass dirs that exist.
  const dirs = ['tools', 'scripts', 'src'].map((d) => join(root, d)).filter((d) => existsSync(d));
  const files = rgFiles(root, 'Bun\.argv|process\.argv|argv', dirs, {});
  const out: SecretLeakFinding[] = [];
  for (const f of files) {
    // rgFiles returns paths relative to root; resolve before reading.
    const abs = join(root, f);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, 'utf8');
    const flagLeaks: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*(\/\/|\*|·|--)/.test(line)) continue; // comments/usage lines
      // '--name value' and '--name=value' forms where name is secret-bearing
      for (const m of line.matchAll(/--([a-z0-9-]*?(?:secret|token|password|private-key|api-key)[a-z0-9-]*?)(?:=|\s)/gi)) {
        const flag = m[1] ?? '';
        if (flag && !ALLOWED_SECRET_FLAGS.has(flag)) flagLeaks.push('--' + flag);
      }
    }
    if (flagLeaks.length) out.push({ file: abs, flags: [...new Set(flagLeaks)] });
  }
  return out;
}

export function secretLeakAuditPasses(findings: SecretLeakFinding[]): boolean {
  return findings.length === 0;
}

export function formatSecretLeakFindings(findings: SecretLeakFinding[]): string[] {
  return findings.flatMap((f) => [
    '  ' + f.file + ': ' + f.flags.join(', ') + ' - secret value on the command line (visible in ps)',
  ]);
}
