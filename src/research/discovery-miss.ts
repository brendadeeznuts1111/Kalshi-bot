import { buildRepoSearchQuery } from "./discover.ts";
import { formatDiscoverGateNote } from "./discover-gate.ts";
import type { DimensionsFile, ResolvedDimensionQueries } from "./dimensions.ts";
import type { GateOptions } from "./gate.ts";

export type DiscoveryMissAlternate = {
  query: string;
  rationale: string;
};

export type DiscoveryMissStats = {
  dimension: string;
  label: string;
  queriesTried: string[];
  searchQueries: string[];
  alternateQueries: DiscoveryMissAlternate[];
  relaxedGateHint: string;
  retryCommand: string;
};

function relaxedGate(gate: GateOptions): GateOptions {
  return {
    minStars: gate.minStars > 1 ? 1 : gate.minStars,
    minForks: gate.minForks > 0 ? 0 : gate.minForks,
    maxAgeMonths: Math.max(gate.maxAgeMonths, 24),
  };
}

function buildDiscoveryRetryCommand(dimension: string, gate: GateOptions): string {
  const next = relaxedGate(gate);
  const args = [`--dimension=${dimension}`];
  if (next.minStars !== gate.minStars) args.push(`--min-stars=${next.minStars}`);
  if (next.minForks !== gate.minForks) args.push(`--min-forks=${next.minForks}`);
  if (next.maxAgeMonths !== gate.maxAgeMonths) args.push(`--max-age-months=${next.maxAgeMonths}`);
  if (gate.minStars > 1 && !args.some((a) => a.startsWith("--min-stars"))) {
    args.push("--min-stars=1");
  }
  return `bun run research -- ${args.join(" ")}`;
}

function formatRelaxedGateHint(gate: GateOptions): string {
  const next = relaxedGate(gate);
  const parts: string[] = [];
  if (next.minStars !== gate.minStars) parts.push(`min-stars=${next.minStars}`);
  if (next.minForks !== gate.minForks) parts.push(`min-forks=${next.minForks}`);
  if (next.maxAgeMonths !== gate.maxAgeMonths) parts.push(`max-age-months=${next.maxAgeMonths}`);
  const gateLine =
    parts.length > 0
      ? `Relaxed gate: ${parts.join(", ")}`
      : "Gate already minimal — broaden queries in research/dimensions.json";
  return `${gateLine}. Discovery search adds \`stars:\`, \`forks:\`, and \`pushed:\` qualifiers from gate settings.`;
}

/** Broader query proposals from dimensions.json (all dimension + shorter variants). */
export function proposeAlternateDiscoveryQueries(
  dimension: string,
  resolved: ResolvedDimensionQueries,
  file: DimensionsFile,
  limit = 3,
): DiscoveryMissAlternate[] {
  const tried = new Set(resolved.queries.map((q) => q.toLowerCase().trim()));
  const alternates: DiscoveryMissAlternate[] = [];

  const allDef = file.dimensions.all;
  if (dimension !== "all" && allDef?.queries?.length) {
    for (const query of allDef.queries) {
      if (alternates.length >= limit) break;
      const key = query.toLowerCase().trim();
      if (tried.has(key)) continue;
      tried.add(key);
      alternates.push({
        query,
        rationale: "Broader query from `all` dimension in research/dimensions.json",
      });
    }
  }

  for (const query of resolved.queries) {
    if (alternates.length >= limit) break;
    const stripped = query.replace(/["']/g, "").trim();
    const words = stripped.split(/\s+/).filter(Boolean);
    if (words.length <= 2) continue;
    const shorter = words.slice(-2).join(" ");
    const key = shorter.toLowerCase();
    if (tried.has(key)) continue;
    tried.add(key);
    alternates.push({
      query: shorter,
      rationale: "Shorter variant of a configured dimension query",
    });
  }

  if (alternates.length < limit && dimension !== "all") {
    const fallback = `${resolved.label.split(/[/(]/)[0]?.trim() ?? dimension} kalshi bot`;
    const key = fallback.toLowerCase();
    if (!tried.has(key)) {
      alternates.push({
        query: fallback,
        rationale: "Generic fallback — add to dimension queries if it works",
      });
    }
  }

  return alternates.slice(0, limit);
}

/** When discover returns 0 candidates — alternate queries + relaxed gate retry. */
export function analyzeDiscoveryMiss(
  dimension: string,
  resolvedQueries: ResolvedDimensionQueries,
  gate: GateOptions,
  dimensionsFile: DimensionsFile,
  discoveredCount?: number,
  discoverGate: GateOptions = gate,
): DiscoveryMissStats | undefined {
  if (discoveredCount !== undefined && discoveredCount > 0) return undefined;

  const discoverNote = formatDiscoverGateNote(gate, discoverGate);

  return {
    dimension,
    label: resolvedQueries.label,
    queriesTried: resolvedQueries.queries,
    searchQueries: resolvedQueries.queries.map((q) => buildRepoSearchQuery(q, discoverGate)),
    alternateQueries: proposeAlternateDiscoveryQueries(dimension, resolvedQueries, dimensionsFile),
    relaxedGateHint: discoverNote
      ? `${discoverNote} ${formatRelaxedGateHint(gate)}`
      : formatRelaxedGateHint(gate),
    retryCommand: buildDiscoveryRetryCommand(dimension, gate),
  };
}

export function formatDiscoveryMissMarkdown(miss: DiscoveryMissStats): string[] {
  const lines: string[] = [
    "## Discovery miss",
    "",
    `Dimension **${miss.dimension}** (${miss.label}) returned **0** candidates from ` +
      `${miss.queriesTried.length} configured quer${miss.queriesTried.length === 1 ? "y" : "ies"}.`,
    "",
  ];

  if (miss.alternateQueries.length) {
    lines.push("### Alternate queries", "");
    miss.alternateQueries.forEach((alt, i) => {
      lines.push(`${i + 1}. \`${alt.query}\` — ${alt.rationale}`);
    });
    lines.push("");
  }

  lines.push("### Relaxed gate", "", `> ${miss.relaxedGateHint}`, "");
  lines.push("### Suggested probe", "", "```bash", miss.retryCommand, "```", "");

  return lines;
}
