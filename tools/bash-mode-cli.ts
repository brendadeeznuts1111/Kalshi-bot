#!/usr/bin/env bun
/**
 * bash:mode - run a shell command through the code-mode tier gate (docs/CODE_MODE.md).
 */
import { runBashInMode, type AgentMode } from '../src/lib/bash-mode.ts';

const argv = Bun.argv.slice(2);
const modeIdx = argv.indexOf('--mode');
const mode: AgentMode = modeIdx >= 0 && (argv[modeIdx + 1] === 'plan' || argv[modeIdx + 1] === 'code') ? (argv[modeIdx + 1] as AgentMode) : 'code';
const dashIdx = argv.indexOf('--');
const command = dashIdx >= 0 ? argv.slice(dashIdx + 1).join(' ') : argv.filter((_a, i) => i !== modeIdx && i !== modeIdx + 1).join(' ');
if (!command.trim()) {
  console.error('usage: bun run bash:mode [--mode plan|code] -- <command...>');
  process.exit(2);
}
const r = await runBashInMode(command, mode);
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
if (r.blocked) process.exit(2);
process.exit(r.exitCode);