#!/usr/bin/env bash
# Pre-commit gate — typecheck, test, restore committed artifacts, block stray deletions.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root"

echo "pre-commit: check"
if [ "${SKIP_TEST_CHANGED:-}" = "1" ]; then
  echo "  ⏭️  SKIP_TEST_CHANGED=1 — skipping bun run check (reason + evidence go in the commit message)"
else
  bun run check
fi

echo "pre-commit: glossary"
bun run glossary:check

echo "pre-commit: partners"
bun run partners:validate

# Partner domain TOML gate when config / toml-config / example staged
partner_toml_staged="$(
  git diff --cached --name-only --diff-filter=ACM -- \
    'config/partners.toml' 'config/partners.example.toml' \
    'src/partner/toml-config.ts' 'tools/partner-toml.ts' \
    'tests/partner/toml-config.test.ts' 2>/dev/null || true
)"
if [[ -n "$partner_toml_staged" ]]; then
  echo "pre-commit: partner:toml:validate (partner TOML path staged)"
  bun run partner:toml:validate
  # Prefer live config if present; still validate example via script above
  if [[ -f config/partners.toml ]]; then
    bun run partner:toml -- --validate --path=config/partners.toml
  fi
fi

# Color bake gate when palette / kernel staged
color_staged="$(
  git diff --cached --name-only --diff-filter=ACM -- \
    'src/lib/color/' 'src/lib/design-colors.ts' \
    'scripts/generate-color-artifacts.ts' \
    'public/colors.css' 'public/registry/color-system.json' \
    'docs/COLORS.md' 'src/research/hq-app/color-vars.css' 2>/dev/null || true
)"
if [[ -n "$color_staged" ]]; then
  echo "pre-commit: colors:check (palette/kernel staged)"
  bun run colors:check
fi

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
