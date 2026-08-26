// @see https://bun.com/docs/guides/process/argv
import { parseArgs } from "node:util";
import { scanProgramsForArtifacts, writeCalibrationArtifacts } from "./watcher.ts";

if (import.meta.main) {
  const { values: clv } = parseArgs({ args: Bun.argv.slice(2), options: { json: { type: 'boolean' } }, strict: false, allowPositionals: true });
  const json = clv.json === true;
  const artifacts = await scanProgramsForArtifacts();
  const dir = await writeCalibrationArtifacts(artifacts);
  if (json) {
    console.log(JSON.stringify({ dir, artifacts }, null, 2));
  } else {
    console.log(`Calibration artifacts: ${dir}`);
    for (const a of artifacts) {
      console.log(`  [${a.kind}] ${a.program}: ${a.recommendation}`);
    }
  }
}
