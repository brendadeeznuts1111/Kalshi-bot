/**
 * design-browser-safety.ts — regression guard for the "browser-safe kernel"
 * contract: in browser-targeted bundles, Bun must never be EXECUTED at
 * runtime. The rule, enforced by design:check:
 *
 *   1. NO file in the frontend module graph may reference Bun in code
 *      (comments, string literals, and `typeof Bun` guards are exempt).
 *   2. kernel.ts may call Bun.color ONLY inside the `if (HAS_BUN_COLOR)`
 *      guard (the environment adapter); every other runtime Bun reference
 *      would crash a browser bundle.
 *
 * convertColorFallback is the only browser path — this lint keeps it that
 * way when new code lands.
 */

export type BrowserSafetyViolation = {
  file: string;
  detail: string;
};

/**
 * Remove comments (keeping newlines so line numbers survive), line comments,
 * and string literals — Bun references inside any of those are not runtime
 * executions and are ignored by the rule.
 */
function stripNoise(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, ' ');
}

/** Index of the closing brace matching the `{` at openIndex (or -1). */
function matchingBrace(src: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Line number of a position in the noise-stripped source (≈ original). */
function lineAt(code: string, idx: number): number {
  return code.slice(0, idx).split('\n').length;
}

/**
 * Check one graph file for unguarded Bun references. kernel.ts is allowed
 * its single guarded Bun.color call (colorConvert's HAS_BUN_COLOR branch).
 */
export function checkFileBrowserSafety(file: string, src: string): BrowserSafetyViolation[] {
  const violations: BrowserSafetyViolation[] = [];
  // Parse-validity oracle (§47): Bun.Transpiler.scan() throws on syntax
  // errors — a file that doesn't parse can't be safely analyzed for Bun
  // references, so report it before the noise-stripped scan.
  // Parse oracle: a loader'd Bun.Transpiler.scan() throws on syntax errors
  // and HANDLES TS type annotations (a bare scan() defaults to jsx and
  // chokes on TS — probe §48; the { loader: "ts" } ctor fixes it). No emit,
  // so scan() is the lightest parse check.
  try {
    new Bun.Transpiler({ loader: "ts" }).scan(src);
  } catch {
    violations.push({ file, detail: 'file does not parse (Bun.Transpiler.scan with loader:ts threw) — browser-safety analysis unreliable' });
    return violations;
  }
  const code = stripNoise(src);
  const isKernel = file.endsWith('/color/kernel.ts') || file.endsWith('color\\kernel.ts');

  const refs = [...code.matchAll(/\bBun\./g)];
  const runtimeRefs = refs.filter((m) => {
    const idx = m.index ?? 0;
    const before = code.slice(Math.max(0, idx - 16), idx);
    return !/typeof\s+$/.test(before); // `typeof Bun.x` is safe without Bun
  });
  if (!runtimeRefs.length) return violations;

  if (!isKernel) {
    for (const m of runtimeRefs) {
      violations.push({
        file,
        detail: 'Bun reference outside kernel.ts (line ' + lineAt(code, m.index ?? 0) + ') — browser bundles must be Bun-free',
      });
    }
    return violations;
  }

  // kernel.ts: every runtime Bun reference must sit inside the HAS_BUN_COLOR guard.
  const guardIdx = code.indexOf('if (HAS_BUN_COLOR)');
  if (guardIdx === -1) {
    for (const m of runtimeRefs) violations.push({ file, detail: 'kernel.ts has Bun refs but no HAS_BUN_COLOR guard' });
    return violations;
  }
  const openBrace = code.indexOf('{', guardIdx);
  const closeBrace = openBrace === -1 ? -1 : matchingBrace(code, openBrace);
  for (const m of runtimeRefs) {
    const idx = m.index ?? 0;
    if (idx > guardIdx && idx < closeBrace) continue;
    violations.push({
      file,
      detail: 'unguarded Bun reference (line ' + lineAt(code, idx) + ') — must sit inside if (HAS_BUN_COLOR)',
    });
  }
  return violations;
}

/** Check a set of absolute graph file paths; returns all violations. */
export async function checkBrowserSafety(files: string[]): Promise<BrowserSafetyViolation[]> {
  const out: BrowserSafetyViolation[] = [];
  for (const file of files) {
    const src = await Bun.file(file).text().catch(() => '');
    if (!src) continue;
    out.push(...checkFileBrowserSafety(file, src));
  }
  return out;
}
