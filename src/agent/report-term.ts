#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/markdown#ansi-terminal-output
// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
// @see https://bun.com/docs/guides/process/argv
import { parseArgs } from "node:util";
import { REPORT_DIR, joinPath } from "../research/paths.ts";

export type ReportTermOptions = {
  file: string;
  raw: boolean;
};

export function parseReportTermCli(argv: string[]): ReportTermOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      raw: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const file = positionals[0] ?? joinPath(REPORT_DIR, "latest.md");
  return { file, raw: values.raw === true };
}

export async function renderReportTerm(opts: ReportTermOptions): Promise<string> {
  const path = opts.file.startsWith("/") ? opts.file : joinPath(process.cwd(), opts.file);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Report not found: ${path}`);
  }
  const text = await file.text();
  if (opts.raw) return text;
  return Bun.markdown.ansi(text);
}

if (import.meta.main) {
  try {
    const opts = parseReportTermCli(Bun.argv.slice(2));
    const out = await renderReportTerm(opts);
    await Bun.write(Bun.stdout, out.endsWith("\n") ? out : `${out}\n`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
