// @see https://bun.com/docs/guides/process/argv
import { parseArgs } from "node:util";
import { parseMidArgs, runAutoToxicityMark, runToxicityMark } from "./shadow-maintenance.ts";

if (import.meta.main) {
  const { values: mtv } = parseArgs({ args: Bun.argv.slice(2), options: { program: { type: 'string' }, 'force-due': { type: 'boolean' }, fetch: { type: 'boolean' }, mid: { type: 'string', multiple: true } }, strict: false, allowPositionals: true });
  const program = typeof mtv.program === 'string' ? mtv.program : undefined;
  if (!program) {
    console.error(
      "Usage: bun src/calibration/mark-toxicity.ts --program=pinnacle-nba [--fetch] [--force-due] [--mid=TICKER:52]",
    );
    process.exit(1);
  }
  const forceDue = mtv['force-due'] === true;
  if (forceDue && Bun.env.NODE_ENV !== "test") {
    console.error(
      "WARNING: --force-due marks outside the T+60s window — toxicity data will be wrong. Test env only.",
    );
  }
  const fetch = mtv.fetch === true;
  const manualMids = parseMidArgs(Bun.argv);

  if (fetch) {
    const result = await runAutoToxicityMark(program, {
      forceDue,
      fetch: {},
      manualMids,
    });
    console.log(
      `Toxicity: marked=${result.marked} pending=${result.pending} missed=${result.missed} fetched=[${result.fetched.join(",")}] chainValid=${result.chainValid}`,
    );
  } else {
    if (!Object.keys(manualMids).length) {
      console.error("Provide --fetch (Kalshi mid pull) or --mid=TICKER:priceCents");
      process.exit(1);
    }
    const result = await runToxicityMark(program, manualMids, { forceDue });
    console.log(
      `Toxicity: marked=${result.marked} pending=${result.pending} missed=${result.missed} chainValid=${result.chainValid}`,
    );
  }
}
