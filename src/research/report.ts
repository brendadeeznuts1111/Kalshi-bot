// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
import { dimensionArtifactBasename, runDimension } from "./dimensions.ts";
import type { ResearchRun, RunDiff, ScoredRepo } from "./types.ts";
import { writeJson } from "./io.ts";
import { githubRepoWebUrl, localRepoPath } from "./patterns.ts";
import { OUTPUT_DIR, REPORT_DIR, joinPath } from "./paths.ts";
import { formatDiffMarkdown } from "./diff.ts";
import { formatDiscoveryMissMarkdown } from "./discovery-miss.ts";
import { formatDiscoverGateNote } from "./discover-gate.ts";
import { formatGateMissMarkdown } from "./gate-miss.ts";
import { buildRepoReport } from "./evidence.ts";
import { shortlistTagCoverage } from "./diversify.ts";
import { DEFAULT_MAX_PER_TAG, MAX_QUALITY_SCORE } from "./constants.ts";
import { formatPhaseTimings } from "./phase-timing.ts";

function reportFor(item: ScoredRepo): NonNullable<ScoredRepo["report"]> {
  return item.report ?? buildRepoReport(item);
}

function formatEvidenceBlock(item: ScoredRepo): string[] {
  const report = reportFor(item);
  const lines: string[] = ["", "#### Evidence & lift", "", `> ${report.liftNotes}`, ""];
  for (const d of report.detectors) {
    if (!d.evidence.length && d.pointsContributed === 0) continue;
    lines.push(`- **${d.id}** (${d.pointsContributed}/${d.maxPoints}): ${d.rationale}`);
    for (const e of d.evidence.slice(0, 5)) {
      lines.push(`  - \`${e.query}\` → \`${e.path}\``);
    }
  }
  lines.push("");
  return lines;
}

function licenseBadge(repo: ScoredRepo): string {
  if (repo.repo.license.unlicensed) return "**UNLICENSED**";
  const id = repo.repo.license.spdxId ?? repo.repo.license.name ?? "unknown";
  return repo.repo.license.preferred ? id : `${id} (non-preferred)`;
}

function repoMarkdownLink(item: ScoredRepo): string {
  const url = githubRepoWebUrl(item.repo.owner, item.repo.name);
  return `[${item.repo.fullName}](${url})`;
}

function formatRepoSection(item: ScoredRepo, rank: number): string[] {
  const lines: string[] = [
    `### ${rank}. ${repoMarkdownLink(item)} · [local](${localRepoPath(item.repo.owner, item.repo.name)})`,
    "",
  ];
  if (item.repo.license.unlicensed) {
    lines.push("> **License warning:** No usable open-source license detected. Not safe to lift code.", "");
  }
  lines.push(
    `- Stars: ${item.repo.stars} | Forks: ${item.repo.forks}`,
    `- License: ${licenseBadge(item)}`,
    `- Stack: ${item.signals.primaryLanguage ?? "unknown"}`,
    `- Strategy tags: ${item.signals.strategyTags.join(", ")}`,
    `- Quality score: **${item.score.total}/${MAX_QUALITY_SCORE}**`,
    `- Breakdown: auth ${item.score.authApi}, orders ${item.score.orderRealism}, tests ${item.score.testsCi}, docs ${item.score.docsSetup}, maintenance ${item.score.maintenance}, risk ${item.score.riskControls}, license -${item.score.licenseModifier}`,
    `- Last default-branch commit: ${item.signals.lastDefaultBranchCommitAt ?? "unknown"}`,
  );
  if (item.repo.description) lines.push(`- Description: ${item.repo.description}`);
  lines.push(...formatEvidenceBlock(item));
  return lines;
}

function formatTagCoverageMarkdown(run: ResearchRun): string[] {
  const rows = shortlistTagCoverage(run.shortlist, DEFAULT_MAX_PER_TAG);
  if (!rows.length) {
    return ["## Shortlist tag coverage", "", "_No strategy tags in shortlist._", ""];
  }
  const lines: string[] = [
    "## Shortlist tag coverage",
    "",
    `Per-tag cap: **${DEFAULT_MAX_PER_TAG}** (multi-tag repos count toward each tag).`,
    "",
    "| Tag | Count | Cap | At cap |",
    "|-----|-------|-----|--------|",
  ];
  for (const row of rows) {
    lines.push(`| ${row.tag} | ${row.count} | ${row.cap} | ${row.atCap ? "yes" : "no"} |`);
  }
  lines.push("");
  return lines;
}

export function formatReportMarkdown(run: ResearchRun, dimensionLabel?: string): string {
  const dimension = runDimension(run);
  const diffName = `${dimensionArtifactBasename(dimension)}.diff.md`;
  const lines: string[] = [
    "# Kalshi GitHub Bot Research Report",
    "",
    `Run: \`${run.runId}\``,
    `Dimension: \`${dimension}\`${dimensionLabel ? ` — ${dimensionLabel}` : ""}`,
    `Generated: ${run.generatedAt}`,
    "",
    `[local browser](/) · [latest diff](${diffName})`,
    "",
    "## Stats",
    `- Discovered: ${run.stats.discovered}`,
    `- Passed gate: ${run.stats.gated}`,
    `- Inspected: ${run.stats.inspected}`,
    `- Shortlist: ${run.stats.shortlist}`,
    ...(run.stats.cache
      ? [
          `- Cache: ETag ${run.stats.cache.searchEtagHits}, search stale ${run.stats.cache.searchDegradedHits}, inspect exact ${run.stats.cache.inspectExactHits}, inspect reuse ${run.stats.cache.inspectContentReuseHits}, inspect stale ${run.stats.cache.inspectDegradedHits}, api stale ${run.stats.cache.apiDegradedHits}`,
        ]
      : []),
    ...(() => {
      const timingLine = formatPhaseTimings(run.stats.timings ?? {});
      return timingLine ? [`- ${timingLine}`] : [];
    })(),
    "",
  ];

  if (run.config.discoverGate) {
    const note = formatDiscoverGateNote(run.config.gate, run.config.discoverGate);
    if (note) lines.push(`> ${note}`, "");
  }

  if (run.discoveryMiss) {
    lines.push(...formatDiscoveryMissMarkdown(run.discoveryMiss));
  }

  if (run.gateMiss) {
    lines.push(...formatGateMissMarkdown(run.gateMiss, run.config.gate));
  }

  lines.push(
    "## Shortlist",
    "",
    ...run.shortlist.flatMap((item, i) => formatRepoSection(item, i + 1)),
    ...formatTagCoverageMarkdown(run),
  );

  const unlicensed = run.shortlist.filter((s) => s.repo.license.unlicensed);
  if (unlicensed.length) {
    lines.push("## License alerts", ...unlicensed.map((s) => `- **${s.repo.fullName}** — unlicensed`), "");
  }

  if (run.excludedSdkOnly.length) {
    lines.push(
      "## SDK-only (excluded from shortlist)",
      ...run.excludedSdkOnly.slice(0, 10).map(
        (s) => `- ${repoMarkdownLink(s)} — score ${s.score.total}`,
      ),
      "",
    );
  }

  lines.push("## All scored repos", "", "| Rank | Repo | Score | License | Tags |", "|------|------|-------|---------|------|");
  run.scored
    .filter((s) => !s.signals.isSdkOnly)
    .sort((a, b) => b.score.total - a.score.total)
    .forEach((s, i) => {
      const lic = s.repo.license.unlicensed ? "UNLICENSED" : (s.repo.license.spdxId ?? "?");
      const local = localRepoPath(s.repo.owner, s.repo.name);
      lines.push(`| ${i + 1} | [${s.repo.fullName}](${local}) | ${s.score.total} | ${lic} | ${s.signals.strategyTags.join(", ")} |`);
    });

  return lines.join("\n");
}

export async function writeOutputs(
  run: ResearchRun,
  diff: RunDiff,
  options?: { dimensionLabel?: string },
): Promise<void> {
  const dimension = runDimension(run);
  const base = dimensionArtifactBasename(dimension);
  const report = formatReportMarkdown(run, options?.dimensionLabel);
  const diffMd = formatDiffMarkdown(diff, run);

  const writes: Promise<unknown>[] = [
    writeJson(joinPath(OUTPUT_DIR, `run_${run.runId}.json`), run),
    Bun.write(joinPath(REPORT_DIR, `run_${run.runId}.md`), report),
    writeJson(joinPath(OUTPUT_DIR, `${base}.json`), run),
    Bun.write(joinPath(REPORT_DIR, `${base}.md`), report),
    Bun.write(joinPath(REPORT_DIR, `${base}.diff.md`), diffMd),
  ];

  await Promise.all(writes);
}
