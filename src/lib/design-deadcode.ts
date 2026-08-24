/**
 * design-deadcode.ts — "used exports / dead import" heuristic for the
 * frontend module graph. Bun 1.4's Bun.Transpiler.scanImports returns only
 * path/kind (no binding names), so import bindings are parsed manually:
 * for each import statement, the local binding names are checked for any
 * occurrence in the module body (import/export statements stripped).
 *
 * A binding with zero body occurrences is DEAD (or type-only in a way the
 * heuristic can't see) — reported as "dead-code potential". This is a
 * warning signal, never a hard gate.
 */

export type DeadImport = {
  file: string;
  specifier: string;
  name: string;
};

/**
 * One import statement; capture groups: 1 named bindings (no braces),
 * 2 namespace, 3 default, 4 second named group, 5 specifier.
 */
const IMPORT_STATEMENT = /import\s+(?:type\s+)?(?:\{([^}]*)\}|\*\s*as\s+(\w+)|(\w+))\s*(?:,\s*\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g;

function bindingsFromMatch(m: RegExpExecArray): Array<{ name: string; needle: string }> {
  const out: Array<{ name: string; needle: string }> = [];
  const ns = m[2];
  const def = m[3];
  const named = (m[1] ?? m[4] ?? '').split(',');
  if (ns) out.push({ name: '* as ' + ns, needle: ns });
  if (def) out.push({ name: def, needle: def });
  for (const raw of named) {
    const parts = raw.trim().split(/\s+as\s+/);
    const local = (parts[1] ?? parts[0])?.trim();
    if (local && !local.startsWith('type ')) out.push({ name: local, needle: local });
  }
  return out;
}

/**
 * Remove import statements so bindings aren't counted at their own
 * declaration. Exports are NOT stripped: `export const X = {...}` blocks can
 * span hundreds of lines (and contain usages), and `export { a } from 'x'`
 * re-exports are not import statements. A binding that appears only in an
 * export is used — correctly counted.
 */
function stripImportsExports(src: string): string {
  return src.replace(/import\s+[^;]+;/g, ' '); // imports terminate at ';' — multi-line braces included
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scan source files for imported bindings that never appear in the body.
 * files: absolute paths. Returns dead imports (best-effort heuristic).
 */
export async function scanDeadImports(files: string[]): Promise<DeadImport[]> {
  const out: DeadImport[] = [];
  for (const file of files) {
    const src = await Bun.file(file).text().catch(() => '');
    if (!src) continue;
    const body = stripImportsExports(src);
    for (const m of src.matchAll(IMPORT_STATEMENT)) {
      const specifier = m[5] ?? '';
      for (const { name, needle } of bindingsFromMatch(m)) {
        if (name === 'default') continue;
        const re = new RegExp('\\b' + escapeRegExp(needle) + '\\b');
        if (!re.test(body)) {
          out.push({ file, specifier, name });
        }
      }
    }
  }
  return out;
}
