export type ProgramStatus = "shadow" | "pilot" | "live" | "killed";

/** baseline = measuring-stick tenant (pinnacle-novig); never graduates. */
export type ProgramRole = "baseline" | "alpha";

export type ProgramGates = {
  shadowMinSignals: number;
  shadowMinWeeks: number;
  pilotMaxContracts: number;
  /** Pre-committed kill — gross miscalibration vs baseline Brier (sanity check, not edge proof). */
  killBrierDriftPct: number;
  /** Graduation primary metric — mean realized edge after fees, cents per filled contract. */
  graduationMinRealizedEdgeCentsPerFill: number;
  /** Minimum resolved fills before graduation is considered. */
  graduationMinFills: number;
  /** Minimum distinct eventId values among resolved lines — blocks tick-spam on one game. */
  graduationMinDistinctEvents: number;
};

export type ProgramManifest = {
  name: string;
  dimension: string;
  status: ProgramStatus;
  baseline: string;
  created: string;
  shadowLog: string;
  hypothesisFile: string;
  gates: ProgramGates;
  minContracts?: number;
  role?: ProgramRole;
};

export function isBaselineProgram(manifest: ProgramManifest): boolean {
  return manifest.role === "baseline";
}

export async function loadProgramManifest(
  path = "program.json",
): Promise<ProgramManifest> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Missing program manifest: ${path}`);
  }
  const raw = (await file.json()) as ProgramManifest & { id?: string };
  if (!raw.name && raw.id) raw.name = raw.id;
  if (!raw.gates) {
    throw new Error("program.json missing gates — pre-commit kill threshold at birth");
  }
  if (
    raw.gates.graduationMinRealizedEdgeCentsPerFill == null ||
    raw.gates.graduationMinFills == null ||
    raw.gates.graduationMinDistinctEvents == null
  ) {
    throw new Error(
      "program.json missing graduationMinRealizedEdgeCentsPerFill / graduationMinFills / graduationMinDistinctEvents — watcher needs breadth + edge gates",
    );
  }
  return raw;
}
