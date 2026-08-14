/**
 * Ensure a scoped Proton Pass PAT session for Kalshi Bot.
 * Delegates entirely to `@factorywager/proton-pass` (force-reset + retry built-in).
 *
 * @see https://protonpass.github.io/pass-cli/commands/login/
 * @see docs/PROTONPASS.md
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  loadPatToken,
  ensureAgentSession,
  KALSHI_AGENT_SESSION,
  type AgentSessionResult,
} from '@factorywager/proton-pass';

export const KALSHI_SESSION_DIR = KALSHI_AGENT_SESSION.sessionDir;
export const KALSHI_TOKEN_ENV = KALSHI_AGENT_SESSION.patEnv;
export const PASS_TOKENS_FILE =
  KALSHI_AGENT_SESSION.tokensFile ?? join(homedir(), 'Projects', '.env.pass-tokens');

export type { AgentSessionResult };

export async function loadKalshiBotToken(): Promise<string | undefined> {
  return loadPatToken({
    ...KALSHI_AGENT_SESSION,
    tokensFile: PASS_TOKENS_FILE,
  });
}

/** PAT session for Kalshi — package owns corrupt-DB force-reset. */
export async function ensureKalshiAgentSession(passCli: string): Promise<AgentSessionResult> {
  return ensureAgentSession(passCli, {
    ...KALSHI_AGENT_SESSION,
    tokensFile: PASS_TOKENS_FILE,
  });
}
