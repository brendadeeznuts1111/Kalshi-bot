#!/usr/bin/env bun
/**
 * `bun run agent:probe [file]` — run Bun code from a repo-local temp file.
 *
 * Frictions solved:
 *   - the run_code worker is plain Node (Bun globals undefined there) ->
 *     this runs under bun.
 *   - /tmp scripts resolve relative imports against /tmp -> the temp file is
 *     created INSIDE the repo (.probe-tmp.ts), so './src/...' imports work.
 *   - argument quoting for tricky code -> code is read from a file or stdin,
 *     never from argv.
 *
 * Usage:
 *   bun run agent:probe -- <code-file>     # code from a file
 *   bun run agent:probe < code.ts           # code from stdin
 *
 * Create the code file with tools.write (or base64 via agent:encode) then
 * probe it. The temp is deleted after the run.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TMP = join(ROOT, ".probe-tmp.ts");

const arg = process.argv.slice(2).find((a) => a !== "--");
const input = arg ? readFileSync(arg, "utf8") : readFileSync(0, "utf8");
if (!input.trim()) {
  console.error("usage: bun run agent:probe -- <code-file>  (or pipe code on stdin)");
  process.exit(2);
}

writeFileSync(TMP, input + "\n");
let code = 1;
try {
  // Capture + forward stdout/stderr (process.exit inside try would bypass
  // finally and strand the temp file).
  const r = Bun.spawnSync(["bun", ".probe-tmp.ts"], { cwd: ROOT });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  code = r.exitCode ?? 1;
} finally {
  rmSync(TMP, { force: true });
}
process.exit(code);
