#!/usr/bin/env bun
/**
 * Open files in the resolved editor (PATTERN_EDITOR env, Bun.which
 * auto-detect, or system default).
 *
 * Usage:
 *   bun run editor:open -- src/a.ts:42
 *   bun run editor:open -- src/a.ts:42:7
 *   bun run editor:open -- "src/a.ts:12:3: const x = 1"   # quote rg-style lines
 *   PATTERN_EDITOR=cursor bun run editor:open -- src/a.ts:42
 */
import { openTarget, parseOpenTarget } from "../src/lib/editor.ts";

const specs = Bun.argv.slice(2).filter((a) => !a.startsWith("--"));
if (specs.length === 0) {
  process.stderr.write("usage: bun run editor:open -- <file>[:line[:column]]\n");
  process.exit(1);
}
for (const spec of specs) openTarget(parseOpenTarget(spec));
