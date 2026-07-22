#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
// @see https://bun.com/docs/runtime/utils#bun-main
import { parseArgs } from "node:util";
import { runResearch } from "../research/cli.ts";
import {
  captureEvidence,
  DEFAULT_CAPTURE_DIR,
  normalizeCaptureUrl,
} from "./capture-evidence.ts";
import {
  dashboardBaseUrl,
  formatAgentStatus,
  getAgentStatus,
  triggerResearchViaApi,
} from "./dashboard-client.ts";
import {
  formatSuggestLift,
  loadRunForSuggest,
  suggestLiftWithRotor,
} from "./suggest-lift.ts";
import {
  auditListFromRun,
  formatAuditList,
  loadRunForAuditList,
} from "./audit-list.ts";
import {
  formatVerifyDashboard,
  verifyDashboard,
  type VerifyDashboardOptions,
} from "./verify-dashboard.ts";

export type AgentCommand =
  | "status"
  | "run-research"
  | "suggest-lift"
  | "audit-list"
  | "capture-evidence"
  | "verify-dashboard";

export function parseAgentCommand(argv: string[]): {
  command: AgentCommand | null;
  rest: string[];
} {
  const [command, ...rest] = argv;
  if (
    command === "status" ||
    command === "run-research" ||
    command === "suggest-lift" ||
    command === "audit-list" ||
    command === "capture-evidence" ||
    command === "verify-dashboard"
  ) {
    return { command, rest };
  }
  return { command: null, rest: argv };
}

function stringOpt(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export async function runAgentStatus(json: boolean): Promise<number> {
  const status = await getAgentStatus();
  if (json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    console.log(formatAgentStatus(status));
  }
  return 0;
}

export async function runAgentResearch(json: boolean, local: boolean): Promise<number> {
  if (!local) {
    const remote = await triggerResearchViaApi();
    if (remote) {
      if (json) {
        console.log(JSON.stringify(remote, null, 2));
      } else if (remote.ok) {
        console.log(`Research complete via dashboard (${remote.runId})`);
        console.log(`Shortlist: ${remote.shortlist}`);
      } else {
        console.error(remote.error ?? "Research failed");
      }
      return remote.ok ? 0 : 1;
    }
    if (!json) {
      console.error(`Dashboard not reachable at ${dashboardBaseUrl()} — running locally`);
    }
  }

  try {
    const run = await runResearch({ json: false, exportAudit: true });
    const payload = {
      ok: true,
      runId: run.runId,
      shortlist: run.shortlist.length,
      generatedAt: run.generatedAt,
      source: "local" as const,
    };
    if (json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`Research complete: ${run.runId}`);
      console.log(`Shortlist (${run.shortlist.length}):`);
      for (const [i, s] of run.shortlist.entries()) {
        console.log(`  ${i + 1}. ${s.repo.fullName} — ${s.score.total}`);
      }
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (json) console.log(JSON.stringify({ ok: false, error: message, source: "local" }));
    else console.error(message);
    return 1;
  }
}

export async function runAgentSuggestLift(
  json: boolean,
  runId?: string,
  dimension?: string,
): Promise<number> {
  const run = loadRunForSuggest(runId, dimension);
  if (!run) {
    const scope = dimension ? `dimension=${dimension}` : runId ? `run=${runId}` : "latest (all)";
    const msg = `No research run for ${scope}. Run: bun run research -- --dimension=<id>`;
    if (json) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(msg);
    return 1;
  }

  const result = await suggestLiftWithRotor(run);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatSuggestLift(result));
  }
  return 0;
}

export async function runAgentAuditList(
  json: boolean,
  runId?: string,
  repo?: string,
  dimension?: string,
): Promise<number> {
  const run = loadRunForAuditList(runId, dimension);
  if (!run) {
    const scope = dimension ? `dimension=${dimension}` : runId ? `run=${runId}` : "latest (all)";
    const msg = `No research run for ${scope}. Run: bun run research -- --dimension=<id>`;
    if (json) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(msg);
    return 1;
  }

  const result = await auditListFromRun(run, { repo });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatAuditList(result));
  }
  return 0;
}

export async function runAgentCaptureEvidence(
  argv: string[],
  json: boolean,
): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: "string" },
      market: { type: "string" },
      out: { type: "string" },
      "wait-ms": { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: false,
  });

  const target = stringOpt(values.url) ?? stringOpt(values.market);
  if (!target) {
    console.error("Usage: bun run agent capture-evidence -- --url=<https://...> | --market=<ticker>");
    return 1;
  }

  const outDir = stringOpt(values.out)?.trim() || DEFAULT_CAPTURE_DIR;
  const waitMsRaw = stringOpt(values["wait-ms"]);
  const waitMs = waitMsRaw ? Number(waitMsRaw) : undefined;

  try {
    const url = normalizeCaptureUrl(target);
    const manifest = await captureEvidence({ url, outDir, waitMs });
    if (json || values.json) {
      console.log(JSON.stringify(manifest, null, 2));
    } else {
      console.log(`Captured ${url}`);
      console.log(`Image:     ${manifest.imagePath}`);
      console.log(`Digest:    sha3-256:${manifest.digest}`);
      if (manifest.title) console.log(`Title:     ${manifest.title}`);
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (json || values.json) console.log(JSON.stringify({ ok: false, error: message }));
    else console.error(message);
    return 1;
  }
}

export function printAgentHelp(): void {
  console.log(`Kalshi agent tools

Usage:
  bun run agent status [--json]
  bun run agent run-research [--json] [--local]
  bun run agent suggest-lift [--json] [--run <run-id>] [--dimension <id>]
  bun run agent audit-list [--json] [--run <run-id>] [--dimension <id>] [--repo <owner/name>]
  bun run agent capture-evidence -- --url=<url> | --market=<ticker> [--out=dir] [--wait-ms=N] [--json]
  bun run agent verify-dashboard [--json] [--max-age-days=N] [--require-pulse]

Environment:
  DASHBOARD_URL              Dashboard base (default http://127.0.0.1:3457)
  DASHBOARD_PORT               Port when DASHBOARD_URL unset
  DASHBOARD_VERIFY_MAX_AGE_DAYS  Freshness window (default 21)
  DASHBOARD_VERIFY_REQUIRE_PULSE Set 1 to fail when pulse.log missing/failing
  ROTOR_ROOT                   Monorepo root for pulse.log + audit catalog
  AUDIT_CATALOG_PATH           Override path to tools/audit-catalog.json

Examples:
  bun run agent status
  bun run agent verify-dashboard
  bun run agent suggest-lift --json
  bun run agent audit-list
  bun run agent run-research -- --local
  bun run agent capture-evidence -- --market=KXHIGHNY-25JAN01
`);
}

export async function runAgentVerifyDashboard(
  json: boolean,
  opts: VerifyDashboardOptions,
): Promise<number> {
  const result = await verifyDashboard(opts);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatVerifyDashboard(result));
  }
  return result.ok ? 0 : 1;
}

export async function runAgentCli(argv: string[]): Promise<number> {
  const { command, rest } = parseAgentCommand(argv);

  if (!command || rest.includes("--help") || rest.includes("-h")) {
    printAgentHelp();
    return command ? 0 : 1;
  }

  const { values } = parseArgs({
    args: rest,
    options: {
      json: { type: "boolean", default: false },
      local: { type: "boolean", default: false },
      run: { type: "string" },
      repo: { type: "string" },
      dimension: { type: "string" },
      "max-age-days": { type: "string" },
      "require-pulse": { type: "boolean", default: false },
    },
    strict: false,
    allowPositionals: true,
  });

  switch (command) {
    case "status":
      return runAgentStatus(values.json === true);
    case "run-research":
      return runAgentResearch(values.json === true, values.local === true);
    case "suggest-lift":
      return runAgentSuggestLift(
        values.json === true,
        stringOpt(values.run),
        stringOpt(values.dimension),
      );
    case "audit-list":
      return runAgentAuditList(
        values.json === true,
        stringOpt(values.run),
        stringOpt(values.repo),
        stringOpt(values.dimension),
      );
    case "capture-evidence":
      return runAgentCaptureEvidence(rest, values.json === true);
    case "verify-dashboard": {
      const maxAgeRaw = stringOpt(values["max-age-days"]);
      const verifyOpts: VerifyDashboardOptions = {
        maxAgeDays: maxAgeRaw ? Number(maxAgeRaw) : undefined,
        requirePulse: values["require-pulse"] === true,
      };
      return runAgentVerifyDashboard(values.json === true, verifyOpts);
    }
    default:
      printAgentHelp();
      return 1;
  }
}

if (import.meta.main) {
  const code = await runAgentCli(Bun.argv.slice(2));
  process.exit(code);
}
