// @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
/** Run one shadow tick for an alpha program directory. */
import { joinPath } from "../research/paths.ts";

const ROOT = joinPath(import.meta.dir, "../..");

function arg(name: string): string | undefined {
  return Bun.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
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
  const proc = Bun.spawn(["bun", runOnce, ...passthrough], {
    cwd: programDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await proc.exited);
}
