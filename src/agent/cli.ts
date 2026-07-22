#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
// @see https://bun.com/docs/runtime/utils#bun-main
import { parseArgs } from "node:util";
import { runResearch, printResearchRunSummary } from "../research/cli.ts";
import {
  GitHubRateLimitError,
  buildGitHubErrorEnrichment,
  formatRateLimitRemediation,
  serializeGitHubApiError,
} from "../research/gh.ts";
import { isTtyStdout } from "../research/terminal-out.ts";
import { spawnResearch } from "./research-runner.ts";
import { formatAgentStatus, getAgentStatus } from "./agent-status.ts";
import {
  formatPatternReportMarkdown,
  loadRunForPatterns,
  patternReportBasename,
  runPatternExtract,
} from "./pattern-extract.ts";
import {
  formatAgentReportMarkdown,
  runAgentReport,
} from "./agent-report.ts";
import { openPatternExcerpt } from "./pattern-editor.ts";
import {
  formatArchitectureBlueprintMarkdown,
  runArchitectureBlueprint,
} from "./architecture-blueprint.ts";

export type AgentCommand =
  | "status"
  | "run-research"
  | "patterns"
  | "report"
  | "blueprint";

/** Drop leading `--` tokens so `agent status -- --dimension=x` still parses flags. */
export function stripLeadingDoubleDashes(args: string[]): string[] {
  let i = 0;
  while (i < args.length && args[i] === "--") i++;
  return args.slice(i);
}

export function parseAgentCommand(argv: string[]): {
  command: AgentCommand | null;
  rest: string[];
} {
  const [command, ...rest] = argv;
  if (
    command === "status" ||
    command === "run-research" ||
    command === "patterns" ||
    command === "report" ||
    command === "blueprint"
  ) {
    return { command, rest: stripLeadingDoubleDashes(rest) };
  }
  return { command: null, rest: argv };
}

function stringOpt(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export async function runAgentStatus(json: boolean, dimension?: string): Promise<number> {
  const status = getAgentStatus(dimension);
  if (json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    console.log(formatAgentStatus(status));
  }
  return 0;
}

export async function runAgentResearch(
  json: boolean,
  options?: { dimension?: string; inProcess?: boolean; exportAudit?: boolean },
): Promise<number> {
  const researchOpts = {
    json: false,
    exportAudit: options?.exportAudit !== false,
    dimension: options?.dimension,
  };

  const useSpawn = !json && !options?.inProcess && isTtyStdout();

  try {
    if (useSpawn) {
      const spawned = await spawnResearch(researchOpts);
      if (!spawned.ok) {
        if (json) {
          console.log(JSON.stringify({ ok: false, error: spawned.message, source: "local" }));
        } else {
          console.error(spawned.message);
        }
        return spawned.exitCode || 1;
      }
      if (json) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              runId: spawned.run.runId,
              shortlist: spawned.run.shortlist.length,
              generatedAt: spawned.run.generatedAt,
              source: "local",
              spawned: true,
            },
            null,
            2,
          ),
        );
      } else {
        printResearchRunSummary(spawned.run);
      }
      return 0;
    }

    const run = await runResearch(researchOpts);
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
      printResearchRunSummary(run);
    }
    return 0;
  } catch (err) {
    if (err instanceof GitHubRateLimitError) {
      const enrichment = buildGitHubErrorEnrichment(err);
      const wire = serializeGitHubApiError(err, enrichment);
      if (json) {
        console.log(JSON.stringify({ ok: false, runOrigin: "local", ...wire }, null, 2));
      } else {
        console.error(formatRateLimitRemediation(err, enrichment));
      }
      return 2;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (json) console.log(JSON.stringify({ ok: false, error: message, source: "local" }));
    else console.error(message);
    return 1;
  }
}

export async function runAgentPatterns(
  json: boolean,
  runId?: string,
  repo?: string,
  dimension?: string,
  noWrite?: boolean,
  openEditor?: boolean,
): Promise<number> {
  const run = loadRunForPatterns(runId, dimension);
  if (!run) {
    const scope = dimension ? `dimension=${dimension}` : runId ? `run=${runId}` : "latest";
    const msg = `No research run for ${scope}. Run: bun run research --dimension=<id>`;
    if (json) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(msg);
    return 1;
  }

  const report = await runPatternExtract({
    runId,
    dimension,
    repo,
    write: !noWrite,
  });
  if (!report) {
    const msg = "Pattern extraction failed";
    if (json) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(msg);
    return 1;
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatPatternReportMarkdown(report));
    if (!noWrite) {
      console.error(`\nWrote research/patterns/${patternReportBasename(report.dimension)}.md`);
    }
    if (openEditor) {
      const target = openPatternExcerpt(report, repo);
      console.error(`Opened in editor (${target.source}): ${target.path}${target.line ? `:${target.line}` : ""}`);
    }
  }
  return 0;
}

export async function runAgentReportCmd(
  json: boolean,
  dimension?: string,
  runId?: string,
  noWrite?: boolean,
): Promise<number> {
  const report = await runAgentReport({
    json,
    dimension,
    runId,
    write: !noWrite && !json,
  });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatAgentReportMarkdown(report));
    if (!noWrite) {
      console.error("\nWrote research/reports/agent-report.md (or scoped variant)");
    }
  }
  return 0;
}

export async function runAgentBlueprint(json: boolean, noWrite?: boolean): Promise<number> {
  const blueprint = await runArchitectureBlueprint({ write: !noWrite && !json });
  if (json) {
    console.log(JSON.stringify(blueprint, null, 2));
  } else {
    console.log(formatArchitectureBlueprintMarkdown(blueprint));
    if (!noWrite) {
      console.error("\nWrote research/reports/architecture-blueprint.md");
    }
  }
  return 0;
}

export function printAgentHelp(): void {
  console.log(`Kalshi agent tools (CLI over cache.db — no dashboard)

Usage:
  bun run agent status [--json] [--dimension <id>]
  bun run agent run-research [--json] [--in-process] [--dimension <id>] [--no-export-audit]
  bun run agent patterns [--json] [--run <run-id>] [--dimension <id>] [--repo <owner/name>] [--no-write] [--open]
  bun run agent report [--json] [--dimension <id>] [--run <run-id>] [--no-write]
  bun run agent blueprint [--json] [--no-write]

Flags go on the subcommand (no inner \`--\` needed):
  bun run agent status --dimension=market-making
  bun run agent run-research --dimension=price-data --no-export-audit

Environment:
  REPO_CLONE_ROOT   Local clone root for patterns --open (owner/repo subdirs)

Examples:
  bun run agent status
  bun run agent patterns --dimension=market-making
  bun run agent report
  bun run agent blueprint
  bun run agent run-research --dimension=price-data
`);
}

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
  const { command, rest } = parseAgentCommand(argv);
  if (!command) {
    printAgentHelp();
    return command === null && argv.length === 0 ? 0 : 1;
  }

  const { values } = parseArgs({
    args: rest,
    options: {
      json: { type: "boolean", default: false },
      "in-process": { type: "boolean", default: false },
      "export-audit": { type: "boolean", default: true },
      "no-export-audit": { type: "boolean", default: false },
      dimension: { type: "string" },
      run: { type: "string" },
      repo: { type: "string" },
      "no-write": { type: "boolean", default: false },
      open: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: false,
  });

  if (values.help === true) {
    printAgentHelp();
    return 0;
  }

  const json = values.json === true;
  const dimension = stringOpt(values.dimension);
  const runId = stringOpt(values.run);
  const repo = stringOpt(values.repo);
  const noWrite = values["no-write"] === true;
  const exportAudit = values["no-export-audit"] !== true && values["export-audit"] !== false;

  switch (command) {
    case "status":
      return runAgentStatus(json, dimension);
    case "run-research":
      return runAgentResearch(json, {
        dimension,
        inProcess: values["in-process"] === true,
        exportAudit,
      });
    case "patterns":
      return runAgentPatterns(json, runId, repo, dimension, noWrite, values.open === true);
    case "report":
      return runAgentReportCmd(json, dimension, runId, noWrite);
    case "blueprint":
      return runAgentBlueprint(json, noWrite);
    default:
      printAgentHelp();
      return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
