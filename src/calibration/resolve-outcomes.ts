// @see https://bun.com/docs/guides/process/argv
import { parseArgs } from "node:util";
import { joinPath } from "../research/paths.ts";
import { loadOutcomesFile, runOutcomeResolution } from "./shadow-maintenance.ts";

if (import.meta.main) {
  const { values: rov } = parseArgs({ args: Bun.argv.slice(2), options: { program: { type: 'string' }, file: { type: 'string' } }, strict: false, allowPositionals: true });
  const program = typeof rov.program === 'string' ? rov.program : undefined;
  const fileArg = typeof rov.file === 'string' ? rov.file : undefined;
  if (!program || !fileArg) {
    console.error(
      "Usage: bun src/calibration/resolve-outcomes.ts --program=pinnacle-nba --file=outcomes.json",
    );
    process.exit(1);
  }
  const path = fileArg.startsWith("/") ? fileArg : joinPath(process.cwd(), fileArg);
  const outcomes = await loadOutcomesFile(path);
  const result = await runOutcomeResolution(program, outcomes);
  console.log(`Outcomes: updated=${result.updated} chainValid=${result.chainValid}`);
}
