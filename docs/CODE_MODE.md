# Code Mode — what it means and how it enhances our bash

## What "code mode" means (AI coding agents)

In AI coding tools (Claude Code is the canonical reference) an agent operates in a
**mode** that fixes its capability tier. The two that matter:

- **Plan mode** — read-only. The agent researches (reads files, greps, runs read-only
  queries) and produces a plan. It CANNOT edit files or execute mutating commands.
- **Code mode** (the default) — execution-enabled. The agent edits files and RUNS
  bash/shell commands to implement and verify. Command execution is still gated by a
  **permission tier** (ask / auto-accept / deny) per tool category (bash, edit, write,
  network).

Newer tools add specialized modes (architecture, review, debug), but the plan/code
axis is the core: **code mode is the execution tier; plan mode is the read-only tier**.

Sources:
- Claude Code cheatsheet (modes incl. Plan Mode) - https://support.claude.com/en/articles/14553413-claude-code-cheatsheet
- Claude Code permission system (ask/auto-accept/deny tiers per tool) - https://stevekinney.com/courses/ai-development/claude-code-permissions

## Why it enhances OUR bash

This repo's bash layer is already a gated execution stack (AGENTS.md authorized-
execution discipline; the bun-native guard; src/lib/run-bun.ts; src/lib/rg.ts). Code
mode gives it an explicit, testable **execution tier** on top:

| mode | bash tier | allows | blocks |
|---|---|---|---|
| plan | read-only | rg, grep, cat, sed -n, tsc, git status/diff/log, read-only bun test | writes, builds, network research, mutating commands |
| code | full | everything, via the repo's normal gates | nothing extra (runtime gates still apply - code mode can NEVER enable live trading execution) |

The tier gate (src/lib/bash-mode.ts) classifies a command's tier and, in plan mode,
blocks full-tier commands with an explicit `[plan mode] blocked` result - so a
plan-mode agent cannot mutate the tree by accident, while code mode keeps today's
full capability. This is the same discipline as Claude Code's permission system,
implemented natively with Bun.$ (no npm deps).

## Usage

```bash
bun run bash:mode --mode code -- bun run check        # full tier (today's behavior)
bun run bash:mode --mode plan -- rg 'TODO' src/       # read-only tier (allowed)
bun run bash:mode --mode plan -- bun install          # blocked: [plan mode] blocked
```

## Repo integration

- src/lib/bash-mode.ts - classifyBashTier(command) + runBashInMode(command, mode)
  (Bun.$ execution, .nothrow() so failures are reported not thrown).
- tools/bash-mode-cli.ts - `bun run bash:mode [--mode plan|code] -- <command...>`.
- Tests: tests/lib/bash-mode.test.ts (tier classification + plan-mode blocking).
- Live trading execution is NEVER affected by mode: the authorized-execution runtime
  gates (AGENTS.md) are independent of the bash tier.
