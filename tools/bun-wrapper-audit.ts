/**
 * `bun run bun:wrapper-audit` — find thin wrappers around Bun APIs that
 * could be direct Bun calls (pitfalls 31/33: 'use Bun's utils by
 * default').
 *
 * Detects: a function whose body is a SINGLE `return Bun.X(...)` on the
 * line after the signature (possibly with default params, comments).
 * These are pure passthroughs - callers could use Bun.X directly.
 *
 * Excludes enriched wrappers (defaults that TRANSFORM args, extra
 * logic, brand colors, error handling, multi-statement bodies) - those
 * add value and are intentionally not flagged.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { glob } from 'node:fs/promises';

const ROOT = join(import.meta.dir, '..');

type Hit = { file: string; line: number; fn: string; bunCall: string };

/**
 * Intentional seams - wrappers kept for DI/SSOT value even though they
 * are single-return Bun passthroughs. escapeHtml is injected as a
 * callback into gate-miss/discovery-miss and re-exported by views.ts;
 * direct Bun.escapeHTML calls would break the injection contract.
 */
const KEEP: ReadonlySet<string> = new Set(['escapeHtml']);

async function main(): Promise<number> {
  const hits: Hit[] = [];
  const files: string[] = [];
  for await (const f of glob('src/**/*.ts', { cwd: ROOT })) {
    if (!f.includes('wrapper-audit')) files.push(f);
  }
  for await (const f of glob('tools/**/*.ts', { cwd: ROOT })) {
    if (!f.includes('wrapper-audit')) files.push(f);
  }

  const sigRe = /export\s+(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*:\s*[^{]+\{\s*$/;
  const retRe = /^\s*return\s+(Bun\.[A-Za-z0-9_.]+)\s*\(/;

  for (const f of files) {
    const lines = readFileSync(join(ROOT, f), 'utf8').split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const sig = sigRe.exec(lines[i]!);
      if (!sig) continue;
      const fn = sig[1]!;
      // Body must be exactly: return Bun.X(...) then close brace.
      const ret = retRe.exec(lines[i + 1]!);
      if (!ret) continue;
      const close = lines[i + 2]?.trim() === '}';
      // Pure passthrough only: the Bun call must use the param names
      // UNCHANGED (no .toString(16), no options-object literals, no
      // COLORS[key] lookups). Flag only when the call args are exactly
      // the param identifiers, optionally comma-joined.
      const call = lines[i + 1]!;
      const params = (sig[0]!.match(/\(([^)]*)\)/)![1]!).split(',').map((p) => p.trim().split('=')[0]!.split(':')[0]!.trim()).filter(Boolean);
      const callArgs = call.slice(call.indexOf(ret[1]!) + ret[1]!.length + 1, call.lastIndexOf(')')).trim();
      const argList = callArgs.split(',').map((a) => a.trim()).filter(Boolean);
      const pure = params.length === argList.length && params.every((p, idx) => p === argList[idx]);
      if (!pure) continue; // defaults/transform - enriched, not thin
      if (!close) continue; // multi-statement body or more logic - enriched
      if (KEEP.has(fn)) continue; // intentional seam, not a thin passthrough
      hits.push({ file: f, line: i + 1, fn, bunCall: ret[1]! });
    }
  }

  // Second check: untyped 'as never' casts on Bun/process APIs (the
  // fully-typed class). bun-types 1.4 types memoryPressure, Bun.dns,
  // Bun.color etc - an 'as never' there means the handler/opts aren't
  // typed against the real types. Data-shape casts (Record/string[]) are
  // NOT flagged (legit).
  const castRe = /(process\.(on|removeListener)|Bun\.\w+)[^\n]*as never/;
  let castHits = 0;
  for (const f of files) {
    const lines = readFileSync(join(ROOT, f), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (castRe.test(lines[i]!)) {
        if (castHits === 0) console.log('wrapper-audit: untyped Bun/process casts (type against bun-types 1.4):');
        castHits++;
        console.log('  ' + f + ':' + (i + 1) + '  ' + lines[i]!.trim().slice(0, 80));
      }
    }
  }
  if (castHits > 0) return 1;

  if (!hits.length) {
    console.log('wrapper-audit: no thin Bun passthrough wrappers found');
    return 0;
  }
  console.log('wrapper-audit: ' + hits.length + ' thin Bun passthrough wrapper(s) - replace calls with Bun.' + ' directly:');
  for (const h of hits) {
    console.log('  ' + h.file + ':' + h.line + '  ' + h.fn + '() -> ' + h.bunCall);
  }
  return 1;
}

process.exit(await main());