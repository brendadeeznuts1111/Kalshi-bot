/**
 * Named agent session presets for the proton-pass CLI.
 * Hosts may still pass a custom AgentSessionConfig.
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  FACTORYWAGER_AGENT_SESSION,
  KALSHI_AGENT_SESSION,
  type AgentSessionConfig,
} from './session.ts';

export type NamedAgent =
  | 'factorywager'
  | 'kalshi'
  | 'kalshi-bot'
  | 'bet-ticker'
  | 'cascade'
  | 'cascade-mover'
  | 'cloudflare'
  | 'partners';

const HOME = homedir();
const SESSIONS = join(HOME, '.factorywager', 'pass-sessions');

/** Resolve CLI --agent name → session config. */
export function agentConfigFor(name: string): AgentSessionConfig {
  const n = name.trim().toLowerCase();
  switch (n) {
    case 'factorywager':
    case 'cloudflare':
      return FACTORYWAGER_AGENT_SESSION;
    case 'kalshi':
    case 'kalshi-bot':
      return KALSHI_AGENT_SESSION;
    case 'bet-ticker':
    case 'betticker':
      return {
        patEnv: 'PROTON_PASS_BET_TICKER_TOKEN',
        sessionDir: join(SESSIONS, 'bet-ticker'),
        acceptGenericPat: true,
      };
    case 'cascade':
    case 'cascade-mover':
      return {
        patEnv: 'PROTON_PASS_CASCADE_TOKEN',
        sessionDir: join(SESSIONS, 'cascade-mover'),
        acceptGenericPat: true,
      };
    case 'partners':
      return {
        patEnv: 'PROTON_PASS_PARTNERS_TOKEN',
        sessionDir: join(SESSIONS, 'partners'),
        acceptGenericPat: true,
      };
    default:
      throw new Error(
        `Unknown agent "${name}". Use: factorywager | kalshi | bet-ticker | cascade | partners | cloudflare`
      );
  }
}
