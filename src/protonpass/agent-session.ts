/**
 * Ensure a scoped Proton Pass PAT session for Kalshi Bot.
 * Uses `@factorywager/proton-pass` load/ensure + local force-reset on corrupt DB.
 *
 * @see https://protonpass.github.io/pass-cli/commands/login/
 * @see docs/PROTONPASS.md
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  createLogger,
  spawnWithTimeout,
  loadPatToken,
  ensureAgentSession,
  KALSHI_AGENT_SESSION,
  type AgentSessionResult,
} from '@factorywager/proton-pass';

const log = createLogger({ prefix: 'agent-session' });

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

async function forceResetSession(passCli: string): Promise<void> {
  await spawnWithTimeout(passCli, ['logout', '--force'], { timeoutMs: 8_000 });
  try {
    const { rm } = await import('node:fs/promises');
    await rm(KALSHI_SESSION_DIR, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  await Bun.write(join(KALSHI_SESSION_DIR, '.keep'), '');
}

/**
 * Apply Projects-style env for Kalshi agent session and login with PAT when available.
 * Retries once after force-reset when the local session DB is corrupt.
 */
export async function ensureKalshiAgentSession(passCli: string): Promise<AgentSessionResult> {
  const first = await ensureAgentSession(passCli, {
    ...KALSHI_AGENT_SESSION,
    tokensFile: PASS_TOKENS_FILE,
  });

  if (first.ok || first.mode === 'missing-token') {
    return first;
  }

  // Corrupted local DB → force reset + retry once
  log.warn('PAT login failed — force logout + retry', { detail: first.detail.slice(0, 120) });
  await forceResetSession(passCli);
  const second = await ensureAgentSession(passCli, {
    ...KALSHI_AGENT_SESSION,
    tokensFile: PASS_TOKENS_FILE,
  });
  return second;
}
