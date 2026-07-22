#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
import { parseArgs } from "node:util";
import { normalizeDimensionId } from "./dimensions.ts";
import { loadConfig } from "./discover.ts";
import { loadRunById, loadPreviousRun } from "./diff.ts";
import { ensureCacheDir } from "./cache.ts";
import {
  verifyLocalAuditExport,
  writeAuditExports,
} from "./export-audit.ts";

export type ExportAuditCliOptions = {
  runId?: string;
  latest: boolean;
  verify?: string;
  repo?: string;
  dimension?: string;
};

export function parseExportAuditCli(argv: string[]): ExportAuditCliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      run: { type: "string" },
      latest: { type: "boolean", default: false },
      verify: { type: "string" },
      repo: { type: "string" },
      dimension: { type: "string" },
    },
    strict: false,
  });

  const dimensionRaw =
    typeof values.dimension === "string"
      ? values.dimension
      : Bun.env.RESEARCH_DIMENSION?.trim() || undefined;

  return {
    runId: typeof values.run === "string" ? values.run : undefined,
    latest: values.latest === true,
    verify: typeof values.verify === "string" ? values.verify : undefined,
    repo: typeof values.repo === "string" ? values.repo : undefined,
    dimension: dimensionRaw,
  };
}

export async function runExportAuditCli(opts: ExportAuditCliOptions): Promise<number> {
  if (opts.verify) {
    const result = await verifyLocalAuditExport(opts.verify);
    if (result.ok) {
      console.log(`OK: ${opts.verify}`);
      return 0;
    }
    for (const err of result.errors) console.error(err);
    return 1;
  }

  await ensureCacheDir();
  const config = await loadConfig();

  let run = opts.runId ? await loadRunById(opts.runId, opts.dimension) : null;
  if (!run && opts.latest) {
    run = await loadPreviousRun(normalizeDimensionId(opts.dimension));
  }
  if (!run && opts.runId) {
    console.error(`No run found: ${opts.runId}`);
    return 1;
  }
  if (!run) {
    console.error("Specify --run <id> or --latest");
    return 1;
  }

  const dir = await writeAuditExports(run, config, { repo: opts.repo });
  if (!dir) {
    console.error(
      opts.repo
        ? `No audit export for repo: ${opts.repo} (needs high-value or watchlist tier)`
        : "No high-value or watchlist shortlist candidates to export",
    );
    return 2;
  }

  const verified = await verifyLocalAuditExport(dir);
  if (!verified.ok) {
    for (const err of verified.errors) console.error(err);
    return 1;
  }

  console.log(`Audit export: ${dir}`);
  console.log(`Rotor bundle: ${dir}/rotor-ingest.json`);
  return 0;
}

if (import.meta.main) {
  const code = await runExportAuditCli(parseExportAuditCli(Bun.argv.slice(2)));
  process.exit(code);
}
