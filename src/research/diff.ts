import type { ResearchRun, RunDiff } from "./types.ts";
import { readJsonFile } from "./io.ts";
import { dimensionArtifactBasename, normalizeDimensionId, runDimension } from "./dimensions.ts";
import { isResearchRun, loadLatestRunFromDb, loadRunFromDb, isProductionRunId } from "./cache.ts";
import { OUTPUT_DIR, joinPath } from "./paths.ts";

async function loadRunFromFile(runId: string, dimension?: string): Promise<ResearchRun | null> {
  const direct = await readJsonFile<ResearchRun>(joinPath(OUTPUT_DIR, `run_${runId}.json`));
  if (direct) return direct;
  const base = dimensionArtifactBasename(normalizeDimensionId(dimension));
  const scoped = await readJsonFile<ResearchRun>(joinPath(OUTPUT_DIR, `${base}.json`));
  if (scoped?.runId === runId) return scoped;
  const latest = await readJsonFile<ResearchRun>(joinPath(OUTPUT_DIR, "latest.json"));
  if (latest?.runId === runId) return latest;
  return null;
}

export async function loadRunById(runId: string, dimension?: string): Promise<ResearchRun | null> {
  const fromDb = loadRunFromDb(runId);
  if (fromDb) return fromDb;
  return loadRunFromFile(runId, dimension);
}

export async function loadPreviousRun(dimension = "all"): Promise<ResearchRun | null> {
  const fromDb = loadLatestRunFromDb({ dimension: normalizeDimensionId(dimension) });
  if (fromDb) return fromDb;
  const base = dimensionArtifactBasename(normalizeDimensionId(dimension));
  const fromFile = await readJsonFile<ResearchRun>(joinPath(OUTPUT_DIR, `${base}.json`));
  return fromFile && isResearchRun(fromFile) && isProductionRunId(fromFile.runId) ? fromFile : null;
}

export function diffRuns(previous: ResearchRun | null, current: ResearchRun): RunDiff {
  if (!previous) {
    return {
      previousRunId: null,
      newEntrants: current.scored.map((s) => s.repo.fullName),
      dropped: [],
      scoreDeltas: current.scored.map((s) => ({
        fullName: s.repo.fullName,
        previous: null,
        current: s.score.total,
        delta: null,
      })),
      shortlistChanges: {
        added: current.shortlist.map((s) => s.repo.fullName),
        removed: [],
      },
    };
  }

  const prevMap = new Map(previous.scored.map((s) => [s.repo.fullName, s.score.total]));
  const currMap = new Map(current.scored.map((s) => [s.repo.fullName, s.score.total]));

  const newEntrants = [...currMap.keys()].filter((k) => !prevMap.has(k));
  const dropped = [...prevMap.keys()].filter((k) => !currMap.has(k));

  const scoreDeltas = [...currMap.entries()]
    .map(([fullName, currentScore]) => {
      const previousScore = prevMap.get(fullName) ?? null;
      return {
        fullName,
        previous: previousScore,
        current: currentScore,
        delta: previousScore === null ? null : currentScore - previousScore,
      };
    })
    .filter((d) => d.delta !== null && d.delta !== 0)
    .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));

  const prevShort = new Set(previous.shortlist.map((s) => s.repo.fullName));
  const currShort = new Set(current.shortlist.map((s) => s.repo.fullName));

  return {
    previousRunId: previous.runId,
    newEntrants,
    dropped,
    scoreDeltas,
    shortlistChanges: {
      added: [...currShort].filter((x) => !prevShort.has(x)),
      removed: [...prevShort].filter((x) => !currShort.has(x)),
    },
  };
}

export function formatDiffMarkdown(diff: RunDiff, current: ResearchRun): string {
  const lines: string[] = [];
  lines.push(`# Kalshi Bot Research Diff`);
  lines.push("");
  lines.push(`Run: \`${current.runId}\``);
  lines.push(`Dimension: \`${runDimension(current)}\``);
  lines.push(`Generated: ${current.generatedAt}`);
  lines.push("");

  if (!diff.previousRunId) {
    lines.push("First run — no prior snapshot to compare.");
    return lines.join("\n");
  }

  lines.push(`Previous run: \`${diff.previousRunId}\``);
  lines.push("");

  lines.push("## Shortlist changes");
  if (!diff.shortlistChanges.added.length && !diff.shortlistChanges.removed.length) {
    lines.push("- No shortlist membership changes.");
  } else {
    for (const repo of diff.shortlistChanges.added) lines.push(`- Added: ${repo}`);
    for (const repo of diff.shortlistChanges.removed) lines.push(`- Removed: ${repo}`);
  }
  lines.push("");

  lines.push("## New entrants");
  if (!diff.newEntrants.length) lines.push("- None");
  else diff.newEntrants.forEach((r) => lines.push(`- ${r}`));
  lines.push("");

  lines.push("## Dropped repos");
  if (!diff.dropped.length) lines.push("- None");
  else diff.dropped.forEach((r) => lines.push(`- ${r}`));
  lines.push("");

  lines.push("## Score deltas");
  if (!diff.scoreDeltas.length) lines.push("- No score changes.");
  else {
    lines.push("| Repo | Previous | Current | Delta |");
    lines.push("|------|----------|---------|-------|");
    for (const row of diff.scoreDeltas.slice(0, 30)) {
      lines.push(`| ${row.fullName} | ${row.previous ?? "—"} | ${row.current} | ${row.delta ?? "—"} |`);
    }
  }

  return lines.join("\n");
}
