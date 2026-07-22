#!/usr/bin/env bash
# Pre-commit gate — typecheck, test, restore committed artifacts, block stray deletions.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root"

echo "pre-commit: typecheck"
bun run typecheck

echo "pre-commit: test"
bun test

echo "pre-commit: restore committed artifacts"
bun tools/restore-committed-artifacts.ts

protected=(
  research/audit-evidence/*.jsonl
  research/reports/latest.md
  research/reports/latest.diff.md
)
deleted="$(git diff --name-only --diff-filter=D -- "${protected[@]}" 2>/dev/null || true)"
if [[ -n "$deleted" ]]; then
  echo "pre-commit: tests deleted committed artifacts:"
  echo "$deleted"
  echo "Fix fixtures or run: bun run artifacts:restore"
  exit 1
fi

echo "pre-commit: ok"
