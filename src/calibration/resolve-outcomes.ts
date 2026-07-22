// @see https://bun.com/docs/guides/process/argv
import { joinPath } from "../research/paths.ts";
import { loadOutcomesFile, runOutcomeResolution } from "./shadow-maintenance.ts";

if (import.meta.main) {
  const program = Bun.argv.find((a) => a.startsWith("--program="))?.slice("--program=".length);
  const fileArg = Bun.argv.find((a) => a.startsWith("--file="))?.slice("--file=".length);
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
