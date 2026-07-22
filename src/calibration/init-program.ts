// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
/**
 * Instantiate alpha/<name>/ from .bun-create/alpha-program/ (no nested git).
 * Prefer: bun create alpha-program alpha/<name> --no-git
 */
import { joinPath } from "../research/paths.ts";
import type { ProgramGates, ProgramManifest } from "../institutions/program-manifest.ts";

const ROOT = joinPath(import.meta.dir, "../..");
const TEMPLATE_ROOT = joinPath(ROOT, ".bun-create/alpha-program");

export type InitProgramOptions = {
  name: string;
  dimension?: string;
  baseline?: string;
  role?: "baseline" | "alpha";
  gates?: Partial<ProgramGates>;
  minContracts?: number;
};

export async function initAlphaProgram(options: InitProgramOptions): Promise<string> {
  const dest = joinPath(ROOT, "alpha", options.name);
  if (await Bun.file(joinPath(dest, "program.json")).exists()) {
    throw new Error(`Program already exists: alpha/${options.name}`);
  }

  await copyTree(TEMPLATE_ROOT, dest);

  const manifest: ProgramManifest = {
    name: options.name,
    dimension: options.dimension ?? "sports-soccer",
    status: "shadow",
    baseline: options.baseline ?? "pinnacle-novig",
    role: options.role ?? "alpha",
    created: new Date().toISOString().slice(0, 10),
    shadowLog: "shadow-log.jsonl",
    hypothesisFile: "hypothesis.md",
    minContracts: options.minContracts ?? 5,
    gates: {
      shadowMinSignals: 100,
      shadowMinWeeks: 3,
      pilotMaxContracts: 5,
      killBrierDriftPct: 15,
      graduationMinRealizedEdgeCentsPerFill: 2,
      graduationMinFills: 30,
      ...options.gates,
    },
  };

  const pkg = {
    name: options.name,
    private: true,
    type: "module",
    scripts: {
      test: "bun test src/signal.test.ts",
      "run-once": "bun src/run-once.ts",
    },
  };
  await Bun.write(joinPath(dest, "program.json"), JSON.stringify(manifest, null, 2) + "\n");
  await Bun.write(joinPath(dest, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  return dest;
}

async function copyTree(src: string, dest: string): Promise<void> {
  const glob = new Bun.Glob("**/*");
  for await (const rel of glob.scan({ cwd: src, onlyFiles: true })) {
    if (rel === "program.json") continue;
    const from = joinPath(src, rel);
    const to = joinPath(dest, rel);
    await Bun.write(to, Bun.file(from));
  }
}

if (import.meta.main) {
  const name = Bun.argv[2];
  if (!name) {
    console.error("Usage: bun src/calibration/init-program.ts <name> [--dimension=sports-soccer]");
    process.exit(1);
  }
  const dimension = Bun.argv.find((a) => a.startsWith("--dimension="))?.slice("--dimension=".length);
  const roleArg = Bun.argv.find((a) => a.startsWith("--role="))?.slice("--role=".length);
  const role = roleArg === "baseline" || roleArg === "alpha" ? roleArg : undefined;
  const dest = await initAlphaProgram({ name, dimension, role });
  console.log(`Created ${dest} — complete hypothesis.md before code.`);
}
