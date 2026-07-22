// @see https://bun.com/docs/guides/process/argv
import { parseMidArgs, runAutoToxicityMark, runToxicityMark } from "./shadow-maintenance.ts";

if (import.meta.main) {
  const program = Bun.argv.find((a) => a.startsWith("--program="))?.slice("--program=".length);
  if (!program) {
    console.error(
      "Usage: bun src/calibration/mark-toxicity.ts --program=pinnacle-nba [--fetch] [--force-due] [--mid=TICKER:52]",
    );
    process.exit(1);
  }
  const forceDue = Bun.argv.includes("--force-due");
  const fetch = Bun.argv.includes("--fetch");
  const manualMids = parseMidArgs(Bun.argv);

  if (fetch) {
    const result = await runAutoToxicityMark(program, {
      forceDue,
      fetch: {},
      manualMids,
    });
    console.log(
      `Toxicity: marked=${result.marked} pending=${result.pending} fetched=[${result.fetched.join(",")}] chainValid=${result.chainValid}`,
    );
  } else {
    if (!Object.keys(manualMids).length) {
      console.error("Provide --fetch (Kalshi mid pull) or --mid=TICKER:priceCents");
      process.exit(1);
    }
    const result = await runToxicityMark(program, manualMids, { forceDue });
    console.log(
      `Toxicity: marked=${result.marked} pending=${result.pending} chainValid=${result.chainValid}`,
    );
  }
}
