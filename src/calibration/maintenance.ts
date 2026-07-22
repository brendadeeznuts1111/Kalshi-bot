// @see https://bun.com/docs/guides/process/argv
import { joinPath } from "../research/paths.ts";
import {
  loadOutcomesFile,
  parseMidArgs,
  runAutoToxicityMark,
  runOutcomeResolution,
} from "./shadow-maintenance.ts";

if (import.meta.main) {
  const program = Bun.argv.find((a) => a.startsWith("--program="))?.slice("--program=".length);
  if (!program) {
    console.error(
      "Usage: bun src/calibration/maintenance.ts --program=pinnacle-nba [--fetch-toxicity] [--force-due] [--resolve=file.json]",
    );
    process.exit(1);
  }

  const forceDue = Bun.argv.includes("--force-due");
  const fetchToxicity = Bun.argv.includes("--fetch-toxicity");
  const resolveFile = Bun.argv.find((a) => a.startsWith("--resolve="))?.slice("--resolve=".length);
  const manualMids = parseMidArgs(Bun.argv);

  if (fetchToxicity || Object.keys(manualMids).length) {
    const tox = await runAutoToxicityMark(program, {
      forceDue,
      fetch: fetchToxicity ? {} : undefined,
      manualMids,
    });
    console.log(
      `Toxicity: marked=${tox.marked} pending=${tox.pending} missed=${tox.missed} fetched=[${tox.fetched.join(",")}] chainValid=${tox.chainValid}`,
    );
  }

  if (resolveFile) {
    const path = resolveFile.startsWith("/") ? resolveFile : joinPath(process.cwd(), resolveFile);
    const outcomes = await loadOutcomesFile(path);
    const res = await runOutcomeResolution(program, outcomes);
    console.log(`Outcomes: updated=${res.updated} chainValid=${res.chainValid}`);
  }

  if (!fetchToxicity && !Object.keys(manualMids).length && !resolveFile) {
    console.error("Nothing to do — pass --fetch-toxicity and/or --resolve=outcomes.json");
    process.exit(1);
  }
}
