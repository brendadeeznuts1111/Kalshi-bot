// @see https://bun.com/docs/guides/process/argv
import { parseArgs } from "node:util";
import { joinPath } from "../research/paths.ts";
import {
  loadOutcomesFile,
  parseMidArgs,
  runAutoToxicityMark,
  runOutcomeResolution,
} from "./shadow-maintenance.ts";

if (import.meta.main) {
  const { values: mntv } = parseArgs({ args: Bun.argv.slice(2), options: { program: { type: 'string' }, 'force-due': { type: 'boolean' }, 'fetch-toxicity': { type: 'boolean' }, resolve: { type: 'string' }, mid: { type: 'string', multiple: true } }, strict: false, allowPositionals: true });
  const program = typeof mntv.program === 'string' ? mntv.program : undefined;
  if (!program) {
    console.error(
      "Usage: bun src/calibration/maintenance.ts --program=pinnacle-nba [--fetch-toxicity] [--force-due] [--resolve=file.json]",
    );
    process.exit(1);
  }

  const forceDue = mntv['force-due'] === true;
  const fetchToxicity = mntv['fetch-toxicity'] === true;
  const resolveFile = typeof mntv.resolve === 'string' ? mntv.resolve : undefined;
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
