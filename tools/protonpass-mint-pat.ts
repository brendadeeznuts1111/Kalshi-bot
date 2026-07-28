#!/usr/bin/env bun
/**
 * Print (or verify) the Kalshi Bot Proton Pass PAT mint workflow.
 * Does not create the PAT — that requires a main-account interactive session.
 *
 * Usage:
 *   bun tools/protonpass-mint-pat.ts
 *   bun tools/protonpass-mint-pat.ts --check
 *
 * @see https://protonpass.github.io/pass-cli/commands/personal-access-token/
 * @see docs/PROTONPASS.md
 */
import { loadKalshiBotToken, PASS_TOKENS_FILE, KALSHI_TOKEN_ENV } from "../src/protonpass/agent-session.ts";

const check = Bun.argv.includes("--check");

if (check) {
  const token = await loadKalshiBotToken();
  if (token) {
    console.log(`✅ ${KALSHI_TOKEN_ENV} present (${token.slice(0, 12)}…)`);
    console.log(`   Source: env or ${PASS_TOKENS_FILE}`);
    process.exit(0);
  }
  console.log(`❌ ${KALSHI_TOKEN_ENV} not found`);
  console.log(`   Expected in env or ${PASS_TOKENS_FILE}`);
  process.exit(1);
}

console.log(`# Kalshi Bot PAT mint — run in Terminal.app (main Proton account)
# Docs: https://protonpass.github.io/pass-cli/commands/personal-access-token/

pass-cli logout --force 2>/dev/null || true
pass-cli login   # browser — main account (NOT a service PAT)

pass-cli pat create --name kalshi-bot --expiration 1y
# Save the printed pst_…::… immediately (shown once).

pass-cli pat access grant \\
  --pat-name kalshi-bot \\
  --vault-name "Kalshi Bot" \\
  --role viewer

pass-cli pat access list-access --pat-name kalshi-bot

# Register (gitignored):
cat >> ${PASS_TOKENS_FILE} <<'EOF'
${KALSHI_TOKEN_ENV}='pst_PASTE_TOKEN_HERE'
EOF

# Prove (from Kalshi-bot):
#   source ~/Projects/scripts/agent-env.sh kalshi-bot
#   bun run protonpass:check
`);
