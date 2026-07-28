/**
 * Startup gate — validates all required secrets/configs before execution.
 * Fails fast with actionable error messages.
 */

import { createLogger } from "./logger.ts";

const log = createLogger({ prefix: "gate" });

export type GateCheck = {
  name: string;
  test: () => boolean | Promise<boolean>;
  required: boolean;
  hint: string;
};

export type GateResult = {
  passed: boolean;
  checks: Array<{ name: string; status: "pass" | "fail" | "skip"; hint?: string }>;
  blockers: string[];
};

export const DEFAULT_GATE_CHECKS: GateCheck[] = [
  {
    name: "KALSHI_API_KEY_ID",
    test: () => Boolean((Bun.env.KALSHI_API_KEY_ID ?? Bun.env.KALSHI_ACCESS_KEY)?.trim()),
    required: false,
    hint: "Set KALSHI_API_KEY_ID for live Kalshi API (REST + WS). Public endpoints work without it.",
  },
  {
    name: "KALSHI_PRIVATE_KEY | KALSHI_PRIVATE_KEY_PATH",
    test: () => Boolean(Bun.env.KALSHI_PRIVATE_KEY?.trim() || Bun.env.KALSHI_PRIVATE_KEY_PATH?.trim()),
    required: false,
    hint: "Set KALSHI_PRIVATE_KEY (inline PEM) or KALSHI_PRIVATE_KEY_PATH for Kalshi auth.",
  },
  {
    name: "ODDS_API_KEY",
    test: () => Boolean(Bun.env.ODDS_API_KEY?.trim()),
    required: false,
    hint: "Set ODDS_API_KEY for Pinnacle consensus feed (tour-series shadow loop).",
  },
  {
    name: "GH_TOKEN | GITHUB_TOKEN",
    test: () => Boolean(Bun.env.GH_TOKEN?.trim() || Bun.env.GITHUB_TOKEN?.trim()),
    required: false,
    hint: "Set GH_TOKEN for GitHub research pipeline. Falls back to gh auth token.",
  },
  {
    name: "KALSHI_ENV",
    test: () => ["demo", "prod"].includes(Bun.env.KALSHI_ENV?.trim() ?? "demo"),
    required: false,
    hint: "KALSHI_ENV should be 'demo' or 'prod' (default: demo).",
  },
  {
    name: "ALPHA_LIVE safety",
    test: () => {
      const live = Bun.env.ALPHA_LIVE?.trim();
      if (!live) return true; // not set = safe
      const armed = Bun.env.KALSHI_PROD_ARMED === "1";
      return armed; // if ALPHA_LIVE is set, KALSHI_PROD_ARMED must be 1
    },
    required: true,
    hint: "ALPHA_LIVE is set but KALSHI_PROD_ARMED !== 1. Live trading BLOCKED.",
  },
];

export async function runStartupGate(
  checks: GateCheck[] = DEFAULT_GATE_CHECKS,
): Promise<GateResult> {
  const results: GateResult["checks"] = [];
  const blockers: string[] = [];

  log.info("Running startup gate", { checks: checks.length });

  for (const check of checks) {
    try {
      const ok = await Promise.resolve(check.test());
      if (ok) {
        results.push({ name: check.name, status: "pass" });
      } else if (check.required) {
        results.push({ name: check.name, status: "fail", hint: check.hint });
        blockers.push(`${check.name}: ${check.hint}`);
      } else {
        results.push({ name: check.name, status: "skip", hint: check.hint });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name: check.name, status: "fail", hint: msg });
      if (check.required) blockers.push(`${check.name}: ${msg}`);
    }
  }

  const passed = blockers.length === 0;

  if (passed) {
    log.info("Startup gate passed", { ok: results.filter((r) => r.status === "pass").length });
  } else {
    log.error("Startup gate failed", { blockers: blockers.length });
  }

  // Print summary
  console.log("\n=== Startup Gate ===\n");
  for (const r of results) {
    const icon = r.status === "pass" ? "✅" : r.status === "fail" ? "🔴" : "⚠️";
    console.log(`${icon} ${r.name}`);
    if (r.hint) console.log(`   ${r.hint}`);
  }

  if (!passed) {
    console.log("\n🔴 BLOCKERS — execution prevented:");
    for (const b of blockers) {
      console.log(`   • ${b}`);
    }
  }

  return { passed, checks: results, blockers };
}

export function assertGate(checks?: GateCheck[]): Promise<void> {
  return runStartupGate(checks).then((result) => {
    if (!result.passed) {
      process.exit(1);
    }
  });
}
