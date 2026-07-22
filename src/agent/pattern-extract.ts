// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
/**
 * Static pattern extraction from detector evidence paths (gh API file reads — no clone).
 */
import type { EvidenceLine, ResearchRun, ScoredRepo } from "../research/types.ts";
import type { ScoreComponentKey } from "../research/constants.ts";
import { buildRepoReport } from "../research/evidence.ts";
import { fetchRepoFileText } from "../research/repo-content.ts";
import { loadResearchRun } from "../research/cache.ts";
import { dimensionArtifactBasename, runDimension } from "../research/dimensions.ts";
import { PATTERNS_DIR, joinPath } from "../research/paths.ts";
import { readJsonFile, writeJson } from "../research/io.ts";
import { ensureGhRateBudget } from "../research/gh.ts";
import { warmGitHubApiNetwork } from "../research/github-network.ts";
import { lookupRepoVerification, buildRotorVerificationIndex, formatVerificationBadge } from "./audit-list.ts";

export const MAX_REPOS_PER_REPORT = 5;
export const MAX_FILES_PER_REPO = 6;
export const MAX_EXCERPT_CHARS = 480;

export type PatternCategory =
  | "auth"
  | "orders"
  | "dryRun"
  | "loop"
  | "errors"
  | "structure"
  | "tests"
  | "bunFeatures";

export type PatternHits = Record<PatternCategory, string[]>;

export type FilePatternSlice = {
  path: string;
  components: string[];
  hits: PatternHits;
  excerpt: string | null;
  fetchOk: boolean;
};

export type RepoPatternReport = {
  fullName: string;
  score: number;
  verification: string;
  evidencePaths: string[];
  files: FilePatternSlice[];
  summary: PatternHits;
};

export type PatternReport = {
  runId: string;
  generatedAt: string;
  dimension: string;
  repos: RepoPatternReport[];
  aggregate: Partial<Record<PatternCategory, string[]>>;
};

export type LiftPatternRef = {
  summary: string;
  excerpt: string | null;
  file: string | null;
  source: string;
};

/** Score component → pattern categories for lift-map excerpts. */
export const COMPONENT_PATTERN_CATEGORIES: Record<ScoreComponentKey, PatternCategory[]> = {
  authApi: ["auth"],
  orderRealism: ["orders"],
  testsCi: ["tests"],
  docsSetup: ["structure"],
  maintenance: ["errors", "structure"],
  riskControls: ["dryRun"],
};

const PATTERN_LABEL_DISPLAY: Record<string, string> = {
  "kalshi-access-headers": "KALSHI-ACCESS-* headers",
  "rsa-pss-signing": "RSA-PSS",
  "api-key-file": "key file",
  "trade-api-v2": "trade-api/v2",
  "env-secrets": "env secrets",
  "create-order-call": "create-order API",
  "order-fields": "order fields (side/count/price)",
  "portfolio-orders-path": "portfolio/orders path",
  "dry-run-default": "dry-run default",
  "polling-loop": "polling loop",
  websocket: "WebSocket",
  "retry-backoff": "retry/backoff",
  "try-catch": "try/catch",
  "structured-logging": "structured logging",
  "client-wrapper": "client wrapper class",
  "test-import": "test framework",
  "bun-websocket": "Bun WebSocket",
  "bun-http": "Bun.serve",
  "bun-sqlite": "bun:sqlite",
  "bun-cron": "Bun.cron",
  "bun-hash": "Bun.CryptoHasher",
  "bun-timer": "Bun.sleep",
  "bun-file": "Bun.file / Bun.write",
};

const AGGREGATE_PATH = /\(readme\/code aggregate\)/i;

const RULES: Array<{ category: PatternCategory; label: string; re: RegExp }> = [
  { category: "auth", label: "kalshi-access-headers", re: /KALSHI-ACCESS-(KEY|SIGNATURE|TIMESTAMP)/i },
  { category: "auth", label: "trade-api-v2", re: /trade-api\/v2/i },
  { category: "auth", label: "rsa-pss-signing", re: /RSA-PSS|rsa\.sign|PSS/i },
  { category: "auth", label: "env-secrets", re: /process\.env|os\.environ|Bun\.env|getenv|dotenv|load_dotenv/i },
  { category: "auth", label: "api-key-file", re: /\.pem|private_key|API_KEY|ACCESS_KEY/i },
  { category: "orders", label: "create-order-call", re: /create_order|CreateOrder|place_order|PlaceOrder|post.*orders/i },
  { category: "orders", label: "order-fields", re: /(side|count|price|type).*?(buy|sell|yes|no|limit|market)/i },
  { category: "orders", label: "portfolio-orders-path", re: /portfolio\/orders|\/orders/i },
  { category: "dryRun", label: "dry-run-default", re: /DRY_RUN|dry_run|dry-run|paper_trading|PAPER/i },
  { category: "loop", label: "websocket", re: /websocket|WebSocket|ws\.|onmessage/i },
  { category: "loop", label: "polling-loop", re: /setInterval|setTimeout|while\s+True|asyncio\.|poll/i },
  { category: "loop", label: "state-machine", re: /enum\s+State|state_machine|StateMachine/i },
  { category: "errors", label: "retry-backoff", re: /retry|backoff|tenacity|exponential/i },
  { category: "errors", label: "try-catch", re: /\btry\b|\bcatch\b|\bexcept\b|\.nothrow\(/i },
  { category: "errors", label: "structured-logging", re: /logging\.|logger\.|console\.(error|warn)|log\.(info|error)/i },
  { category: "structure", label: "config-module", re: /config\.(py|ts|js)|settings\.(py|ts)|from config import/i },
  { category: "structure", label: "strategy-module", re: /strategy|strategies\//i },
  { category: "structure", label: "client-wrapper", re: /class\s+\w*(Client|Api|API)|KalshiClient/i },
  { category: "tests", label: "test-import", re: /pytest|unittest|describe\(|from jest|bun:test/i },
  { category: "bunFeatures", label: "bun-websocket", re: /Bun\.connect|websocket:\s*true|upgrade:\s*websocket/i },
  { category: "bunFeatures", label: "bun-http", re: /Bun\.serve\s*\(/ },
  { category: "bunFeatures", label: "bun-sqlite", re: /from\s+["']bun:sqlite["']|import\s+.*bun:sqlite|new\s+Database\s*\(/ },
  { category: "bunFeatures", label: "bun-cron", re: /Bun\.cron\s*\(/ },
  { category: "bunFeatures", label: "bun-hash", re: /Bun\.CryptoHasher|crypto\.createHash\s*\(/ },
  { category: "bunFeatures", label: "bun-timer", re: /Bun\.sleep\s*\(/ },
  { category: "bunFeatures", label: "bun-file", re: /Bun\.file\s*\(|Bun\.write\s*\(/ },
];

export function emptyPatternHits(): PatternHits {
  return {
    auth: [],
    orders: [],
    dryRun: [],
    loop: [],
    errors: [],
    structure: [],
    tests: [],
    bunFeatures: [],
  };
}

export function analyzeSource(text: string): PatternHits {
  const hits = emptyPatternHits();
  for (const rule of RULES) {
    if (rule.re.test(text) && !hits[rule.category].includes(rule.label)) {
      hits[rule.category].push(rule.label);
    }
  }
  return hits;
}

export function mergePatternHits(into: PatternHits, add: PatternHits): PatternHits {
  const out = { ...into };
  for (const cat of Object.keys(add) as PatternCategory[]) {
    for (const label of add[cat]) {
      if (!out[cat].includes(label)) out[cat].push(label);
    }
  }
  return out;
}

export function selectEvidencePaths(lines: EvidenceLine[], limit = MAX_FILES_PER_REPO): string[] {
  const scored = lines
    .filter((l) => l.path && !AGGREGATE_PATH.test(l.path))
    .map((l) => ({
      path: l.path,
      weight: l.component === "authApi" || l.component === "orderRealism" ? 2 : 1,
    }));

  const byPath = new Map<string, number>();
  for (const row of scored) {
    byPath.set(row.path, (byPath.get(row.path) ?? 0) + row.weight);
  }

  return [...byPath.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([path]) => path);
}

/** Evidence paths from inspect signals when detector lines only cite readme aggregate. */
export function signalEvidencePaths(item: ScoredRepo, limit = MAX_FILES_PER_REPO): string[] {
  const paths = [
    ...item.signals.authHits.flatMap((h) => h.paths),
    ...item.signals.orderHits.flatMap((h) => h.paths),
  ].filter((path) => path && !AGGREGATE_PATH.test(path));
  return [...new Set(paths)].slice(0, limit);
}

export function resolvePatternFetchPaths(
  item: ScoredRepo,
  generatedAt: string,
  limit = MAX_FILES_PER_REPO,
): string[] {
  const report = item.report ?? buildRepoReport(item, generatedAt);
  const evidenceLines = report.detectors.flatMap((d) => d.evidence);
  const fromEvidence = selectEvidencePaths(evidenceLines, limit);
  if (fromEvidence.length) return fromEvidence;

  const fromSignals = signalEvidencePaths(item, limit);
  if (fromSignals.length) return fromSignals;

  return ["README.md"];
}

function excerptAroundMatch(text: string, maxLen = MAX_EXCERPT_CHARS): string | null {
  if (!text.trim()) return null;
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (m?.index !== undefined) {
      const start = Math.max(0, m.index - 80);
      const end = Math.min(text.length, m.index + maxLen - 80);
      return text.slice(start, end).replace(/\s+/g, " ").trim();
    }
  }
  return text.slice(0, maxLen).replace(/\s+/g, " ").trim();
}

export async function extractRepoPatterns(
  item: ScoredRepo,
  generatedAt: string,
  verificationLabel: string,
): Promise<RepoPatternReport> {
  const report = item.report ?? buildRepoReport(item, generatedAt);
  const evidenceLines = report.detectors.flatMap((d) => d.evidence);
  const paths = resolvePatternFetchPaths(item, generatedAt);
  const repoRef = {
    fullName: item.repo.fullName,
    pushedAt: item.repo.pushedAt,
    defaultBranch: item.repo.defaultBranch,
  };

  let summary = emptyPatternHits();
  const files: FilePatternSlice[] = [];

  for (const path of paths) {
    const text = await fetchRepoFileText(repoRef, path);
    const hits = text ? analyzeSource(text) : emptyPatternHits();
    const components = [
      ...new Set(evidenceLines.filter((e) => e.path === path).map((e) => e.component)),
    ];
    summary = mergePatternHits(summary, hits);
    files.push({
      path,
      components,
      hits,
      excerpt: text ? excerptAroundMatch(text) : null,
      fetchOk: text !== null,
    });
  }

  for (const extra of ["package.json", "bunfig.toml"]) {
    if (paths.includes(extra) || files.some((f) => f.path === extra)) continue;
    const text = await fetchRepoFileText(repoRef, extra);
    if (!text) continue;
    const hits = analyzeSource(text);
    summary = mergePatternHits(summary, hits);
    files.push({
      path: extra,
      components: [],
      hits,
      excerpt: excerptAroundMatch(text),
      fetchOk: true,
    });
  }

  return {
    fullName: item.repo.fullName,
    score: item.score.total,
    verification: verificationLabel,
    evidencePaths: paths,
    files,
    summary,
  };
}

export function aggregatePatternReports(repos: RepoPatternReport[]): PatternReport["aggregate"] {
  const agg: PatternReport["aggregate"] = {};
  for (const repo of repos) {
    for (const cat of Object.keys(repo.summary) as PatternCategory[]) {
      for (const label of repo.summary[cat]) {
        agg[cat] ??= [];
        if (!agg[cat]!.includes(label)) agg[cat]!.push(label);
      }
    }
  }
  return agg;
}

export async function buildPatternReport(
  run: ResearchRun,
  options?: { repoFilter?: string; maxRepos?: number },
): Promise<PatternReport> {
  const rotor = await buildRotorVerificationIndex();
  let items = [...run.shortlist].sort((a, b) => b.score.total - a.score.total);

  if (options?.repoFilter?.trim()) {
    const key = options.repoFilter.trim().toLowerCase();
    items = items.filter((i) => i.repo.fullName.toLowerCase() === key);
    if (!items.length) {
      items = run.scored
        .filter((s) => s.repo.fullName.toLowerCase() === key)
        .slice(0, 1);
    }
  }

  items = items.slice(0, options?.maxRepos ?? MAX_REPOS_PER_REPORT);

  const repos: RepoPatternReport[] = [];
  for (const item of items) {
    const rotorStatus = lookupRepoVerification(rotor, item.repo.fullName);
    const badge = formatVerificationBadge({
      verified: rotorStatus.verified,
      verification: rotorStatus.verification,
    });
    repos.push(await extractRepoPatterns(item, run.generatedAt, badge));
  }

  return {
    runId: run.runId,
    generatedAt: run.generatedAt,
    dimension: runDimension(run),
    repos,
    aggregate: aggregatePatternReports(repos),
  };
}

export function formatPatternReportMarkdown(report: PatternReport): string {
  const lines: string[] = [
    "# Kalshi bot pattern report",
    "",
    `Run: \`${report.runId}\``,
    `Dimension: \`${report.dimension}\``,
    `Generated: ${report.generatedAt}`,
    "",
    "## Aggregate signals",
  ];

  const cats = Object.keys(report.aggregate) as PatternCategory[];
  if (!cats.length) {
    lines.push("_No pattern hits — shortlist empty or no readable evidence files._");
  } else {
    for (const cat of cats) {
      lines.push(`- **${cat}**: ${report.aggregate[cat]?.join(", ") ?? "—"}`);
    }
  }

  for (const repo of report.repos) {
    lines.push("", `## ${repo.fullName} (${repo.score}) — ${repo.verification}`, "");
    if (!repo.files.length) {
      lines.push("_No line-evidence paths to inspect._");
      continue;
    }
    for (const file of repo.files) {
      lines.push(`### \`${file.path}\` (${file.components.join(", ")})`);
      if (!file.fetchOk) {
        lines.push("- _Could not fetch file via gh API_");
        continue;
      }
      for (const cat of Object.keys(file.hits) as PatternCategory[]) {
        if (file.hits[cat].length) {
          lines.push(`- **${cat}**: ${file.hits[cat].join(", ")}`);
        }
      }
      if (file.excerpt) {
        lines.push("", "```", file.excerpt, "```");
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function patternReportBasename(dimension: string): string {
  return `patterns-${dimensionArtifactBasename(dimension)}`;
}

export function patternReportJsonPath(dimension: string): string {
  return joinPath(PATTERNS_DIR, `${patternReportBasename(dimension)}.json`);
}

/** Repo-relative path for committed pattern JSON (lift-map source links). */
export function patternReportSourceRel(dimension: string): string {
  return joinPath("research/patterns", `${patternReportBasename(dimension)}.json`);
}

export function formatPatternSummary(labels: string[]): string {
  return labels
    .map((label) => PATTERN_LABEL_DISPLAY[label] ?? label.replace(/-/g, " "))
    .join(", ");
}

export function pickPatternSliceForComponent(
  repoReport: RepoPatternReport,
  component: ScoreComponentKey,
): { summary: string; excerpt: string | null; file: string | null } {
  const categories = COMPONENT_PATTERN_CATEGORIES[component];
  const labels: string[] = [];
  for (const cat of categories) {
    for (const label of repoReport.summary[cat]) {
      if (!labels.includes(label)) labels.push(label);
    }
  }

  let bestFile: FilePatternSlice | null = null;
  let bestScore = -1;
  for (const file of repoReport.files) {
    if (!file.fetchOk) continue;
    const componentMatch = file.components.includes(component) ? 2 : 0;
    const catHits = categories.reduce((n, cat) => n + file.hits[cat].length, 0);
    const score = componentMatch + catHits;
    if (score > bestScore) {
      bestScore = score;
      bestFile = file;
    }
  }

  return {
    summary: formatPatternSummary(labels),
    excerpt: bestFile?.excerpt ?? null,
    file: bestFile?.path ?? null,
  };
}

export async function loadPatternReport(dimension: string): Promise<PatternReport | null> {
  return readJsonFile<PatternReport>(patternReportJsonPath(dimension));
}

export async function loadRepoPatternReport(
  dimension: string,
  repoFullName: string,
  run: ResearchRun,
  options?: { allowLiveFetch?: boolean },
): Promise<RepoPatternReport | null> {
  const key = repoFullName.trim().toLowerCase();
  const cached = await loadPatternReport(dimension);
  const fromDisk = cached?.repos.find((r) => r.fullName.toLowerCase() === key);
  if (fromDisk) return fromDisk;

  if (!options?.allowLiveFetch) return null;

  const item =
    run.shortlist.find((s) => s.repo.fullName.toLowerCase() === key) ??
    run.scored.find((s) => s.repo.fullName.toLowerCase() === key);
  if (!item) return null;

  const rotor = await buildRotorVerificationIndex();
  const rotorStatus = lookupRepoVerification(rotor, item.repo.fullName);
  const badge = formatVerificationBadge({
    verified: rotorStatus.verified,
    verification: rotorStatus.verification,
  });
  return extractRepoPatterns(item, run.generatedAt, badge);
}

export function formatBunFeatureSummary(hits: PatternHits): string {
  return formatPatternSummary(hits.bunFeatures);
}

export function bestBunFeatureRepo(
  reports: PatternReport[],
): { fullName: string; dimension: string; features: string[]; file: string | null } | null {
  let best: {
    fullName: string;
    dimension: string;
    features: string[];
    file: string | null;
    score: number;
  } | null = null;

  for (const report of reports) {
    for (const repo of report.repos) {
      const features = repo.summary.bunFeatures;
      if (!features.length) continue;
      const bunFile = repo.files.find((f) => f.hits.bunFeatures.length)?.path ?? null;
      const score = features.length * 10 + repo.score;
      if (!best || score > best.score) {
        best = {
          fullName: repo.fullName,
          dimension: report.dimension,
          features,
          file: bunFile,
          score,
        };
      }
    }
  }

  if (!best) return null;
  return {
    fullName: best.fullName,
    dimension: best.dimension,
    features: best.features,
    file: best.file,
  };
}

export async function writePatternReport(report: PatternReport): Promise<string> {
  await Bun.write(joinPath(PATTERNS_DIR, ".keep"), "");
  const base = patternReportBasename(report.dimension);
  const mdPath = joinPath(PATTERNS_DIR, `${base}.md`);
  const jsonPath = joinPath(PATTERNS_DIR, `${base}.json`);
  await Bun.write(mdPath, formatPatternReportMarkdown(report));
  await writeJson(jsonPath, report);
  return mdPath;
}

export function loadRunForPatterns(runId?: string, dimension?: string): ResearchRun | null {
  return loadResearchRun({ runId, dimension });
}

export async function runPatternExtract(options: {
  runId?: string;
  dimension?: string;
  repo?: string;
  write?: boolean;
}): Promise<PatternReport | null> {
  warmGitHubApiNetwork();
  await ensureGhRateBudget();
  const run = loadRunForPatterns(options.runId, options.dimension);
  if (!run) return null;
  const report = await buildPatternReport(run, { repoFilter: options.repo });
  if (options.write !== false) {
    await writePatternReport(report);
  }
  return report;
}
