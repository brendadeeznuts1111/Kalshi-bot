#!/usr/bin/env bash
# Pre-commit gate — typecheck, test, restore committed artifacts, block stray deletions.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root"

echo "pre-commit: check"
bun run check

echo "pre-commit: glossary"
bun run glossary:check

protected=(
  research/audit-evidence/*.jsonl
  research/reports/latest.md
  research/reports/latest.diff.md
)
deleted="$(
  {
    git diff --name-only --diff-filter=D -- "${protected[@]}"
    git diff --cached --name-only --diff-filter=D -- "${protected[@]}"
  } 2>/dev/null | sort -u
)"
if [[ -n "$deleted" ]]; then
  echo "pre-commit: tests deleted committed artifacts:"
  echo "$deleted"
  echo "Fix fixtures or run: bun run artifacts:restore"
  exit 1
fi

echo "pre-commit: ok"
