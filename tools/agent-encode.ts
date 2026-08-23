#!/usr/bin/env bun
/**
 * `bun run agent:encode [file]` - emit lexer-safe base64 for run_code payloads.
 *
 * Reads stdin (or the file given as argv[2]) and prints a single-line base64
 * string ([A-Za-z0-9+/=] only - no backticks, no ${, no quotes, no newlines).
 * Paste the output into a run_code program, then decode at the destination:
 *
 *   echo '<out>' | base64 -d > target.ts
 *   # or pure Bun: bun -e "... Buffer.from((await Bun.file('/tmp/x.b64').text()).trim(), 'base64') ..."
 *
 * Use whenever file content or a command contains backticks or ${ - the
 * harness lexer parses run_code program text before Bun runs, so those
 * sequences must never appear raw. See docs/AGENT-PITFALLS.md section 8.
 */
import { readFileSync } from "node:fs";

const decode = process.argv.includes("--decode");
const fileArg = process.argv.slice(2).find((a) => a !== "--decode");
const arg = fileArg && fileArg !== "-" ? fileArg : null;
const input = arg ? readFileSync(arg, "utf8") : readFileSync(0, "utf8");
if (decode) {
  process.stdout.write(Buffer.from(input.trim(), "base64").toString("utf8"));
} else {
  process.stdout.write(Buffer.from(input, "utf8").toString("base64") + "\n");
}
