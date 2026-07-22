import type { PatternCategory } from "./pattern-extract.ts";
import type { RepoPatternReport, FilePatternSlice } from "./pattern-extract.ts";

export type PatternMissSuggestion = {
  category: PatternCategory;
  searchTerm: string;
  file: string | null;
  hint: string;
  reason: "no_heuristic_match" | "file_fetch_failed" | "empty_file";
};

const CATEGORY_SEARCH_TERMS: Record<PatternCategory, string[]> = {
  auth: ["KALSHI-ACCESS", "trade-api/v2", "signature", "ACCESS_KEY"],
  orders: ["create_order", "portfolio/orders", "PlaceOrder", "yes_price"],
  dryRun: ["dry-run", "DRY_RUN", "paper_trading"],
  loop: ["WebSocket", "setInterval", "poll"],
  errors: ["retry", "backoff", "try/catch"],
  structure: ["config", "strategy", "Client"],
  tests: ["pytest", "bun:test", "describe("],
  bunFeatures: ["Bun.serve", "bun:sqlite", "Bun.cron"],
};

const ALL_CATEGORIES: PatternCategory[] = [
  "auth",
  "orders",
  "dryRun",
  "loop",
  "errors",
  "structure",
  "tests",
  "bunFeatures",
];

function fileScoreForCategory(file: FilePatternSlice, category: PatternCategory): number {
  let score = 0;
  if (file.components.some((c) => categoryComponent(c) === category)) score += 3;
  if (file.path.toLowerCase().includes(categoryHintPath(category))) score += 2;
  if (file.fetchOk) score += 1;
  return score;
}

function categoryComponent(component: string): PatternCategory | null {
  if (component === "authApi") return "auth";
  if (component === "orderRealism") return "orders";
  if (component === "riskControls") return "dryRun";
  return null;
}

function categoryHintPath(category: PatternCategory): string {
  switch (category) {
    case "auth":
      return "auth";
    case "orders":
      return "order";
    case "tests":
      return "test";
    case "bunFeatures":
      return "bun";
    default:
      return category;
  }
}

function pickFileForCategory(repo: RepoPatternReport, category: PatternCategory): FilePatternSlice | null {
  if (!repo.files.length) return null;
  return [...repo.files].sort((a, b) => fileScoreForCategory(b, category) - fileScoreForCategory(a, category))[0] ?? null;
}

function hasCategoryHits(repo: RepoPatternReport, category: PatternCategory): boolean {
  return repo.summary[category].length > 0;
}

export function patternMissSuggestions(
  repo: RepoPatternReport,
  options?: { categories?: PatternCategory[]; max?: number },
): PatternMissSuggestion[] {
  const categories = options?.categories ?? ALL_CATEGORIES;
  const max = options?.max ?? 6;
  const out: PatternMissSuggestion[] = [];

  for (const category of categories) {
    if (hasCategoryHits(repo, category)) continue;

    const file = pickFileForCategory(repo, category);
    const fallbackPath = file?.path ?? repo.evidencePaths[0] ?? "README.md";
    const searchTerm = CATEGORY_SEARCH_TERMS[category][0] ?? category;

    let reason: PatternMissSuggestion["reason"] = "no_heuristic_match";
    if (file && !file.fetchOk) reason = "file_fetch_failed";
    else if (file?.fetchOk && !file.excerpt) reason = "empty_file";

    const hint =
      reason === "file_fetch_failed"
        ? `Could not fetch \`${fallbackPath}\` — try locally: gh api repos/${repo.fullName}/contents/${fallbackPath}`
        : `Manual review: search for \`${searchTerm}\` in \`${fallbackPath}\``;

    out.push({ category, searchTerm, file: fallbackPath, hint, reason });
    if (out.length >= max) break;
  }

  return out;
}

export function formatPatternMissSummary(misses: PatternMissSuggestion[]): string {
  if (!misses.length) return "";
  return misses.map((m) => m.hint).join("; ");
}

export function patternMissForComponent(
  repo: RepoPatternReport,
  categories: PatternCategory[],
): PatternMissSuggestion[] {
  return patternMissSuggestions(repo, { categories, max: 3 });
}

export function attachPatternMisses(repo: RepoPatternReport): RepoPatternReport {
  const misses = patternMissSuggestions(repo);
  if (!misses.length) return repo;
  return { ...repo, patternMiss: misses };
}

export function formatPatternMissMarkdown(misses: PatternMissSuggestion[]): string[] {
  if (!misses.length) return [];
  return [
    "#### Pattern miss — suggested manual review",
    "",
    ...misses.map((m) => `- **${m.category}**: ${m.hint}`),
    "",
  ];
}
