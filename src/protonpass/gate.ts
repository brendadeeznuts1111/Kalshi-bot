/**
 * Kalshi startup gate — host DEFAULT_GATE_CHECKS + package runner.
 */
export {
  runStartupGate,
  assertGate,
  type GateCheck,
  type GateResult,
} from '@factorywager/proton-pass';

import type { GateCheck } from '@factorywager/proton-pass';

/** Kalshi product env checks (not in the portable package). */
export const DEFAULT_GATE_CHECKS: GateCheck[] = [
  {
    name: 'KALSHI_API_KEY_ID',
    test: () => Boolean((Bun.env.KALSHI_API_KEY_ID ?? Bun.env.KALSHI_ACCESS_KEY)?.trim()),
    required: false,
    hint: 'Set KALSHI_API_KEY_ID for live Kalshi API (REST + WS). Public endpoints work without it.',
  },
  {
    name: 'KALSHI_PRIVATE_KEY | KALSHI_PRIVATE_KEY_PATH',
    test: () =>
      Boolean(Bun.env.KALSHI_PRIVATE_KEY?.trim() || Bun.env.KALSHI_PRIVATE_KEY_PATH?.trim()),
    required: false,
    hint: 'Set KALSHI_PRIVATE_KEY (inline PEM) or KALSHI_PRIVATE_KEY_PATH for Kalshi auth.',
  },
  {
    name: 'ODDS_API_KEY',
    test: () => Boolean(Bun.env.ODDS_API_KEY?.trim()),
    required: false,
    hint: 'Set ODDS_API_KEY for Pinnacle consensus feed (out-series shadow loop).',
  },
  {
    name: 'GH_TOKEN | GITHUB_TOKEN',
    test: () => Boolean(Bun.env.GH_TOKEN?.trim() || Bun.env.GITHUB_TOKEN?.trim()),
    required: false,
    hint: 'Set GH_TOKEN for GitHub research pipeline. Falls back to gh auth token.',
  },
  {
    name: 'KALSHI_ENV',
    test: () => ['demo', 'prod'].includes(Bun.env.KALSHI_ENV?.trim() ?? 'demo'),
    required: false,
    hint: "KALSHI_ENV should be 'demo' or 'prod' (default: demo).",
  },
  {
    name: 'ALPHA_LIVE safety',
    test: () => {
      const live = Bun.env.ALPHA_LIVE?.trim();
      if (!live) return true;
      const armed = Bun.env.KALSHI_PROD_ARMED === '1';
      return armed;
    },
    required: true,
    hint: 'ALPHA_LIVE is set but KALSHI_PROD_ARMED !== 1. Live trading BLOCKED.',
  },
];
