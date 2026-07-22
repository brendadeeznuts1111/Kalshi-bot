/**
 * Architecture blueprint — dimension-scoped Bun stack recommendations from pattern + lift data.
 */
// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
import type { ScoreComponentKey } from "../research/constants.ts";
import type { GateOptions } from "../research/gate.ts";
import type { GateMissStats } from "../research/gate-miss.ts";
import { formatGateMissMarkdown } from "../research/gate-miss.ts";
import { loadResearchRun } from "../research/cache.ts";
import { loadDimensionsFile } from "../research/dimensions.ts";
import { joinPath, RESEARCH_ROOT, ROOT } from "../research/paths.ts";
import {
  attachPatternsToLift,
  suggestLiftFromRun,
  type LiftPatternRef,
  type LiftRecommendation,
  type ShortlistSummary,
} from "./suggest-lift.ts";
import { buildRotorVerificationIndex, formatVerificationBadge, resolveRunDataFreshness, type DataFreshness } from "./audit-list.ts";
import {
  bestBunFeatureRepo,
  formatBunFeatureSummary,
  formatPatternSummary,
  emptyPatternHits,
  analyzeSource,
  loadPatternReport,
  type PatternHits,
  type PatternReport,
  type RepoPatternReport,
} from "./pattern-extract.ts";

export type BlueprintLiftEntry = {
  component: ScoreComponentKey;
  repo: string;
  points: number;
  maxPoints: number;
  badge: string;
  verified: boolean;
  verification: LiftRecommendation["verification"];
  findingId: string | null;
  rationale: string;
  pattern: LiftPatternRef | null;
};

export type BunNativeHint = {
  feature: string;
  localFiles: string[];
};

export type BlueprintSection = {
  dimension: string;
  title: string;
  runId: string | null;
  runGeneratedAt: string | null;
  recommendedBun: string[];
  referenceRepo: string | null;
  referenceScore: number | null;
  referenceBadge: string | null;
  referenceFindingId: string | null;
  referenceDimension: string | null;
  bunFeatures: string[];
  bunFeatureFile: string | null;
  authPattern: string | null;
  orderPattern: string | null;
  liftAuth: string | null;
  liftOrders: string | null;
  liftEntries: BlueprintLiftEntry[];
  shortlistSummary: ShortlistSummary[];
  liftNotes: string[];
  bunNative: BunNativeHint[];
  notes: string[];
  dataFreshness: DataFreshness | null;
  /** Gate config for the dimension run (when gateMiss is set). */
  gate?: GateOptions | null;
  /** Near misses + probe command when discover > 0 but none pass gate. */
  gateMiss?: GateMissStats;
};

export type ArchitectureBlueprint = {
  generatedAt: string;
  localBunStack: {
    features: string[];
    sourceFiles: string[];
    featureFiles: Record<string, string[]>;
  };
  sections: BlueprintSection[];
};

export type BlueprintDimensionSpec = {
  dimension: string;
  title: string;
  recommendedBun: string[];
  fallbackDimensions: string[];
  /** Shown when research has no gated shortlist (sports probes). */
  emptyShortlistNote?: string;
};

export const BLUEPRINT_DIMENSIONS: BlueprintDimensionSpec[] = [
  {
    dimension: "price-data",
    title: "Price / market data feeds",
    recommendedBun: ["bun-websocket", "bun-sqlite"],
    fallbackDimensions: ["market-making", "arbitrage", "all"],
  },
  {
    dimension: "wallet-track",
    title: "Wallet / balance tracking",
    recommendedBun: ["bun-cron", "bun-http"],
    fallbackDimensions: ["tracking", "arbitrage"],
  },
  {
    dimension: "tracking",
    title: "Portfolio tracking / monitoring",
    recommendedBun: ["bun-file", "bun-hash"],
    fallbackDimensions: ["market-making", "arbitrage"],
  },
  {
    dimension: "market-making",
    title: "Market making / execution",
    recommendedBun: ["bun-http", "bun-websocket"],
    fallbackDimensions: ["arbitrage"],
  },
  {
    dimension: "arbitrage",
    title: "Cross-venue arbitrage",
    recommendedBun: ["bun-cron", "bun-http"],
    fallbackDimensions: ["market-making"],
  },
  {
    dimension: "sports-nba",
    title: "NBA",
    recommendedBun: ["bun-http", "bun-cron"],
    fallbackDimensions: ["market-making", "arbitrage"],
    emptyShortlistNote: "No gated candidates yet — probe with `--min-stars=2`",
  },
  {
    dimension: "sports-nfl",
    title: "NFL",
    recommendedBun: ["bun-http", "bun-cron"],
    fallbackDimensions: ["market-making", "arbitrage"],
    emptyShortlistNote: "No gated candidates yet — probe with `--min-stars=2`",
  },
  {
    dimension: "sports-soccer",
    title: "Soccer",
    recommendedBun: ["bun-http", "bun-cron"],
    fallbackDimensions: ["market-making", "arbitrage"],
    emptyShortlistNote: "No gated candidates yet — probe with `--min-stars=2`",
  },
  {
    dimension: "sports-other",
    title: "Other sports (MLB, NHL, tennis, …)",
    recommendedBun: ["bun-http", "bun-cron"],
    fallbackDimensions: ["market-making", "arbitrage"],
    emptyShortlistNote: "No gated candidates yet — probe with `--min-stars=2`",
  },
  {
    dimension: "sports-elections",
    title: "Elections / politics",
    recommendedBun: ["bun-http", "bun-cron"],
    fallbackDimensions: ["market-making", "arbitrage"],
    emptyShortlistNote: "No gated candidates yet — probe with `--min-stars=2`",
  },
  {
    dimension: "sports-macro",
    title: "Macro / economic events",
    recommendedBun: ["bun-http", "bun-cron"],
    fallbackDimensions: ["market-making", "arbitrage"],
    emptyShortlistNote: "No gated candidates yet — probe with `--min-stars=2`",
  },
];

const LIFT_COMPONENTS: ScoreComponentKey[] = ["authApi", "orderRealism"];

/** Scan this repo's src/ for Bun API usage — SSOT when GitHub candidates are Python. */
export async function scanLocalBunStack(): Promise<ArchitectureBlueprint["localBunStack"]> {
  const glob = new Bun.Glob("src/**/*.{ts,tsx}");
  const features = new Set<string>();
  const sourceFiles: string[] = [];
  const featureFiles: Record<string, string[]> = {};

  for await (const rel of glob.scan({ cwd: ROOT, onlyFiles: true })) {
    const text = await Bun.file(`${ROOT}/${rel}`).text();
    const hits = analyzeSource(text);
    if (!hits.bunFeatures.length) continue;
    sourceFiles.push(rel);
    for (const f of hits.bunFeatures) {
      features.add(f);
      (featureFiles[f] ??= []).push(rel);
    }
  }

  for (const key of Object.keys(featureFiles)) {
    featureFiles[key] = [...new Set(featureFiles[key])].sort();
  }

  return {
    features: [...features].sort(),
    sourceFiles: sourceFiles.sort(),
    featureFiles,
  };
}

export function bunNativeHintsFor(
  recommendedBun: string[],
  localBunStack: ArchitectureBlueprint["localBunStack"],
): BunNativeHint[] {
  return recommendedBun.map((feature) => ({
    feature,
    localFiles: (localBunStack.featureFiles[feature] ?? []).slice(0, 4),
  }));
}

function patternLabels(hits: PatternHits, categories: Array<keyof PatternHits>): string {
  const labels: string[] = [];
  for (const cat of categories) {
    for (const label of hits[cat]) {
      if (!labels.includes(label)) labels.push(label);
    }
  }
  return formatPatternSummary(labels);
}

function repoFromPatternReport(report: PatternReport | null): RepoPatternReport | null {
  return report?.repos[0] ?? null;
}

function findRepoInReports(
  reports: PatternReport[],
  dimension: string,
): RepoPatternReport | null {
  const report = reports.find((r) => r.dimension === dimension);
  return repoFromPatternReport(report ?? null);
}

function toLiftEntry(rec: LiftRecommendation, freshness: DataFreshness): BlueprintLiftEntry {
  return {
    component: rec.component,
    repo: rec.repo,
    points: rec.points,
    maxPoints: rec.maxPoints,
    badge: rec.repo
      ? formatVerificationBadge({
          verified: rec.verified,
          verification: rec.verification,
          auditTier: rec.auditTier,
          stale: freshness.stale,
          ageMs: freshness.ageMs,
        })
      : "—",
    verified: rec.verified,
    verification: rec.verification,
    findingId: rec.findingId,
    rationale: rec.rationale,
    pattern: rec.pattern,
  };
}

export async function buildArchitectureBlueprint(): Promise<ArchitectureBlueprint> {
  const file = await loadDimensionsFile();
  const rotor = await buildRotorVerificationIndex();
  const localBunStack = await scanLocalBunStack();
  const patternReports: PatternReport[] = [];

  for (const spec of BLUEPRINT_DIMENSIONS) {
    const cached = await loadPatternReport(spec.dimension);
    if (cached) patternReports.push(cached);
    for (const fb of spec.fallbackDimensions) {
      if (patternReports.some((r) => r.dimension === fb)) continue;
      const fbReport = await loadPatternReport(fb);
      if (fbReport) patternReports.push(fbReport);
    }
  }

  const globalBun = bestBunFeatureRepo(patternReports);
  const sections: BlueprintSection[] = [];

  for (const spec of BLUEPRINT_DIMENSIONS) {
    const notes: string[] = [];
    const run = loadResearchRun({ dimension: spec.dimension });
    const patternReport = await loadPatternReport(spec.dimension);
    let repo = repoFromPatternReport(patternReport);

    if (!repo && run?.shortlist[0]) {
      notes.push(
        "No pattern report on disk — run: bun run agent patterns --dimension=" + spec.dimension,
      );
    }

    if (!repo?.summary.bunFeatures.length) {
      for (const fb of spec.fallbackDimensions) {
        const fbRepo = findRepoInReports(patternReports, fb);
        if (fbRepo?.summary.bunFeatures.length) {
          repo = fbRepo;
          notes.push(`Bun features from fallback dimension \`${fb}\` (${fbRepo.fullName})`);
          break;
        }
      }
    }

    if (!repo?.summary.bunFeatures.length && globalBun) {
      const fbReport = patternReports.find((r) => r.dimension === globalBun.dimension);
      repo = fbReport?.repos.find((r) => r.fullName === globalBun.fullName) ?? repo;
      if (repo?.summary.bunFeatures.length) {
        notes.push(`Bun features from cross-dimension reference ${globalBun.fullName}`);
      }
    }

    if (!repo?.summary.bunFeatures.length && localBunStack.features.length) {
      notes.push(
        `GitHub shortlist is non-Bun — mirror APIs from local stack: ${formatPatternSummary(localBunStack.features)}`,
      );
    }

    let liftAuth: string | null = null;
    let liftOrders: string | null = null;
    let liftEntries: BlueprintLiftEntry[] = [];
    let shortlistSummary: ShortlistSummary[] = [];
    let liftNotes: string[] = [];
    let referenceBadge: string | null = null;
    let referenceFindingId: string | null = null;
    let dataFreshness: DataFreshness | null = null;

    if (run) {
      dataFreshness = resolveRunDataFreshness(run);
      const lift = await attachPatternsToLift(suggestLiftFromRun(run, rotor), run);
      liftEntries = lift.recommendations
        .filter((r) => LIFT_COMPONENTS.includes(r.component))
        .map((r) => toLiftEntry(r, dataFreshness!));
      shortlistSummary = lift.shortlist;
      liftNotes = lift.notes;
      liftAuth = lift.recommendations.find((r) => r.component === "authApi")?.repo ?? null;
      liftOrders = lift.recommendations.find((r) => r.component === "orderRealism")?.repo ?? null;

      const referenceRepo =
        repo?.fullName ?? run.shortlist[0]?.repo.fullName ?? liftAuth ?? null;
      const shortlistEntry = referenceRepo
        ? lift.shortlist.find((s) => s.fullName === referenceRepo)
        : null;
      if (shortlistEntry) {
        referenceBadge = formatVerificationBadge({
          verified: shortlistEntry.verified,
          verification: shortlistEntry.verification,
          auditTier: shortlistEntry.auditTier,
          stale: dataFreshness.stale,
          ageMs: dataFreshness.ageMs,
        });
        referenceFindingId = shortlistEntry.findingId;
      }
    }

    if (patternReport?.repos[0]?.patternMiss?.length && !repo?.summary.auth.length) {
      for (const miss of patternReport.repos[0].patternMiss.slice(0, 2)) {
        notes.push(`Pattern miss (${miss.category}): ${miss.hint}`);
      }
    }

    if (!run?.shortlist.length) {
      if (run?.discoveryMiss) {
        notes.push(
          `Discovery miss: 0 candidates for ${run.discoveryMiss.label} — ${run.discoveryMiss.relaxedGateHint}`,
        );
        for (const alt of run.discoveryMiss.alternateQueries.slice(0, 2)) {
          notes.push(`Alternate query: \`${alt.query}\` — ${alt.rationale}`);
        }
        notes.push(`Probe: \`${run.discoveryMiss.retryCommand}\``);
      } else if (!run?.gateMiss) {
        if (spec.emptyShortlistNote) {
          notes.push(spec.emptyShortlistNote);
        } else {
          notes.push("No shortlist — run research with --min-stars=1 if niche");
        }
      }
    }

    const label = file.dimensions[spec.dimension]?.label ?? spec.title;
    const referenceRepo = repo?.fullName ?? run?.shortlist[0]?.repo.fullName ?? null;

    sections.push({
      dimension: spec.dimension,
      title: label,
      runId: run?.runId ?? null,
      runGeneratedAt: run?.generatedAt ?? null,
      recommendedBun: spec.recommendedBun,
      referenceRepo,
      referenceScore: repo?.score ?? run?.shortlist[0]?.score.total ?? null,
      referenceBadge,
      referenceFindingId,
      referenceDimension: patternReport ? spec.dimension : null,
      bunFeatures: repo?.summary.bunFeatures ?? [],
      bunFeatureFile:
        repo?.files.find((f) => f.hits.bunFeatures.length)?.path ??
        globalBun?.file ??
        null,
      authPattern: repo ? patternLabels(repo.summary, ["auth"]) : null,
      orderPattern: repo ? patternLabels(repo.summary, ["orders"]) : null,
      liftAuth,
      liftOrders,
      liftEntries,
      shortlistSummary,
      liftNotes,
      bunNative: bunNativeHintsFor(spec.recommendedBun, localBunStack),
      notes,
      dataFreshness,
      gate: run?.gateMiss ? run.config.gate : null,
      gateMiss: run?.gateMiss,
    });
  }

  return { generatedAt: new Date().toISOString(), localBunStack, sections };
}

function formatLiftEntryMarkdown(entry: BlueprintLiftEntry): string[] {
  const lines = [
    `- **${entry.component}** ← \`${entry.repo || "—"}\` (${entry.points}/${entry.maxPoints}) ${entry.badge}`,
    `  - ${entry.rationale}`,
  ];
  if (entry.pattern?.summary) {
    lines.push(`  - ↳ pattern: ${entry.pattern.summary}`);
  }
  if (entry.pattern?.misses?.length) {
    for (const miss of entry.pattern.misses) {
      lines.push(`  - ↳ review: ${miss.hint}`);
    }
  }
  if (entry.pattern?.file) {
    lines.push(`  - ↳ file: \`${entry.pattern.file}\``);
  }
  if (entry.pattern?.excerpt) {
    const excerpt = entry.pattern.excerpt.replace(/\s+/g, " ").trim();
    lines.push(`  - ↳ excerpt: \`${excerpt.slice(0, 200)}${excerpt.length > 200 ? "…" : ""}\``);
  }
  if (entry.findingId) {
    lines.push(`  - finding: \`${entry.findingId}\``);
  }
  return lines;
}

export function formatArchitectureBlueprintMarkdown(blueprint: ArchitectureBlueprint): string {
  const lines: string[] = [
    "# Kalshi bot architecture blueprint",
    "",
    `Generated: ${blueprint.generatedAt}`,
    "",
    "Single reference for **what to lift**, **verification status**, and **which Bun APIs to mirror** per domain slice.",
    "Grounded in `agent suggest-lift` + `agent patterns` (excerpts below).",
    "",
    "## Local Bun SSOT (this repo)",
    "",
    "GitHub Kalshi bots are mostly Python/Node — **this research pipeline** is the Bun reference implementation:",
    "",
    `- **Bun APIs in use:** ${formatPatternSummary(blueprint.localBunStack.features)}`,
    `- **Source files:** ${blueprint.localBunStack.sourceFiles.slice(0, 12).map((f) => `\`${f}\``).join(", ")}${blueprint.localBunStack.sourceFiles.length > 12 ? ", …" : ""}`,
    "",
    "| Domain need | Lift auth/orders from | Implement with (local Bun) |",
    "|-------------|---------------------|----------------------------|",
    "| Price data | MM / price-data shortlist | `bun-websocket` + `bun-sqlite` |",
    "| Wallet track | wallet-track shortlist | `bun-cron` + `bun-http` |",
    "| Portfolio | tracking shortlist | `bun-file` + `bun-hash` |",
    "| Execution / orders | market-making shortlist | `bun-http` + `bun-websocket` |",
    "| Sports | sports-* dimensions (probe) | `bun-http` + `bun-cron` |",
    "",
  ];

  for (const section of blueprint.sections) {
    lines.push(`## ${section.title} (\`${section.dimension}\`)`, "");

    if (section.runId) {
      lines.push(`**Research run:** \`${section.runId}\`${section.runGeneratedAt ? ` (${section.runGeneratedAt})` : ""}`);
    }

    const bunRec = section.recommendedBun
      .map((b) => formatPatternSummary([b]))
      .join(" + ");
    lines.push(`**Recommended Bun stack:** ${bunRec}`);

    if (section.referenceRepo) {
      const badge = section.referenceBadge ? ` — ${section.referenceBadge}` : "";
      const finding =
        section.referenceFindingId ? ` · \`${section.referenceFindingId}\`` : "";
      lines.push(
        `**Reference repo:** ${section.referenceRepo}${section.referenceScore != null ? ` (${section.referenceScore})` : ""}${badge}${finding}`,
      );
    } else {
      lines.push("**Reference repo:** _none yet — run dimension research_");
    }

    if (section.bunFeatures.length) {
      lines.push(
        `**Bun features observed:** ${formatBunFeatureSummary({ ...emptyPatternHits(), bunFeatures: section.bunFeatures })}`,
      );
      if (section.bunFeatureFile) {
        lines.push(`**Source file:** \`${section.bunFeatureFile}\``);
      }
    } else {
      lines.push(
        "**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_",
      );
    }

    if (section.liftEntries.length) {
      lines.push("", "### Lift recommendations (auth + orders)", "");
      for (const entry of section.liftEntries) {
        lines.push(...formatLiftEntryMarkdown(entry));
      }
    } else if (section.authPattern || section.orderPattern) {
      if (section.authPattern) lines.push(`**Auth pattern:** ${section.authPattern}`);
      if (section.orderPattern) lines.push(`**Order pattern:** ${section.orderPattern}`);
    }

    if (section.gateMiss && section.gate) {
      lines.push(...formatGateMissMarkdown(section.gateMiss, section.gate));
    }

    if (section.shortlistSummary.length) {
      lines.push("", "### Shortlist verification", "");
      for (const s of section.shortlistSummary) {
        const badge = formatVerificationBadge({
          verified: s.verified,
          verification: s.verification,
          auditTier: s.auditTier,
          stale: section.dataFreshness?.stale,
          ageMs: section.dataFreshness?.ageMs,
        });
        const lic = s.unlicensed ? " · UNLICENSED" : "";
        lines.push(`- \`${s.fullName}\` — ${s.total} — ${badge}${lic}`);
      }
    }

    if (section.liftNotes.length) {
      lines.push("", "### Lift notes", "");
      for (const n of section.liftNotes) lines.push(`- ${n}`);
    }

    if (section.liftAuth || section.liftOrders) {
      lines.push(
        `**Lift map:** auth ← ${section.liftAuth ?? "—"} · orders ← ${section.liftOrders ?? "—"}`,
      );
    }

    const nativeWithFiles = section.bunNative.filter((h) => h.localFiles.length);
    if (nativeWithFiles.length) {
      lines.push("", "### Bun native implementation", "");
      lines.push("| Bun API | Local reference |");
      lines.push("|---------|-----------------|");
      for (const hint of section.bunNative) {
        const refs = hint.localFiles.length
          ? hint.localFiles.map((f) => `\`${f}\``).join(", ")
          : "_not used locally yet_";
        lines.push(`| ${formatPatternSummary([hint.feature])} | ${refs} |`);
      }
    }

    if (section.notes.length) {
      lines.push("", "Notes:");
      for (const n of section.notes) lines.push(`- ${n}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

export async function writeArchitectureBlueprint(blueprint: ArchitectureBlueprint): Promise<string> {
  const mdPath = joinPath(RESEARCH_ROOT, "reports", "architecture-blueprint.md");
  const jsonPath = joinPath(RESEARCH_ROOT, "reports", "architecture-blueprint.json");
  await Bun.write(mdPath, formatArchitectureBlueprintMarkdown(blueprint));
  await Bun.write(jsonPath, JSON.stringify(blueprint, null, 2));
  return mdPath;
}

export async function runArchitectureBlueprint(options?: {
  write?: boolean;
}): Promise<ArchitectureBlueprint> {
  const blueprint = await buildArchitectureBlueprint();
  if (options?.write !== false) {
    await writeArchitectureBlueprint(blueprint);
  }
  return blueprint;
}
