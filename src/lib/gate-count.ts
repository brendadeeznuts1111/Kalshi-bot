/**
 * Structural gate-count derivation - count the elements of the gates
 * array in tools/verify-contracts.ts with the TypeScript compiler API.
 * Immune to formatting: multi-line entries, single OR double quotes,
 * comments between entries - none of it can silently drift the count.
 * Shared by docs:check (FAIL side) and docs:sync-counts (FIX side) so
 * both derive from ONE source of truth. §167.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const DEFAULT_VC = join(import.meta.dir, '..', '..', 'tools', 'verify-contracts.ts');

/** @returns the number of elements in the gates array (throws if absent). */
export function countGates(vcPath: string = DEFAULT_VC): number {
  const sourceText = readFileSync(vcPath, 'utf8');
  const sf = ts.createSourceFile(vcPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found: number | null = null;
  function visit(node: ts.Node): void {
    if (found !== null) return;
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sf) === "gates" &&
      node.initializer !== undefined
    ) {
      // The gates array is declared `as const` - unwrap the AsExpression.
      let init = node.initializer;
      if (ts.isAsExpression(init)) init = init.expression;
      if (ts.isArrayLiteralExpression(init)) {
        found = init.elements.length;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (found === null) {
    throw new Error("countGates: cannot locate the gates array in " + vcPath);
  }
  return found;
}
