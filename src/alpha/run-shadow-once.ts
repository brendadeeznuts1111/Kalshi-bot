// @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
/** Run one shadow tick for an alpha program directory. */
import { parseArgs } from "node:util";
import { $ } from "bun";
import { joinPath } from "../research/paths.ts";

const ROOT = joinPath(import.meta.dir, "../..");

const { values: rsov } = parseArgs({ args: Bun.argv.slice(2), options: { program: { type: 'string' }, ticker: { type: 'string' }, price: { type: 'string' }, sport: { type: 'string' } }, strict: false, allowPositionals: true });
function arg(name: string): string | undefined {
  const v = rsov[name];
  return typeof v === 'string' ? v : undefined;
}

if (import.meta.main) {
  const program = arg("program");
  if (!program) {
    console.error(
      "Usage: bun src/alpha/run-shadow-once.ts --program=pinnacle-nba --ticker=KX... --price=55 [--sport=basketball_nba]",
    );
    process.exit(1);
  }

  const programDir = joinPath(ROOT, "alpha", program);
  const runOnce = joinPath(programDir, "src/run-once.ts");
  if (!(await Bun.file(runOnce).exists())) {
    console.error(`Missing ${runOnce} — bun run alpha:init ${program}`);
    process.exit(1);
  }

  const passthrough = Bun.argv.slice(2).filter((a) => !a.startsWith("--program="));
  const { exitCode } = await $`bun ${runOnce} ${passthrough}`.cwd(programDir).nothrow();
  process.exit(exitCode);
}
