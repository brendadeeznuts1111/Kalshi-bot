// @see https://bun.com/blog/bun-v1.3.4#urlpattern-api
// @see https://bun.com/blog/bun-v1.3.12#urlpattern-is-up-to-2-3x-faster
// @see https://bun.com/docs/runtime/http/server#basic-setup
/**
 * Shared URLPattern SSOT — GitHub parse, Bun.serve routes, research fetch handlers.
 *
 * Blog vectors (v1.3.4):
 *   new URLPattern({ pathname: "/users/:id" }).exec(...).pathname.groups.id
 *   new URLPattern({ pathname: "/files/*" }).exec(...).pathname.groups[0]
 */

/** Thin wrapper so URLPattern usage stays consistent across modules. */
export class BunURLPattern {
  readonly pattern: URLPattern;

  constructor(init: URLPatternInit | string | URLPattern) {
    this.pattern = init instanceof URLPattern ? init : new URLPattern(init);
  }

  test(input: string | URL | URLPatternInit): boolean {
    return this.pattern.test(input as string | URL);
  }

  exec(input: string | URL | URLPatternInit): URLPatternResult | null {
    return this.pattern.exec(input as string | URL);
  }

  /** Named (or indexed) pathname groups, or null if no match. */
  groups(input: string | URL): Record<string, string | undefined> | null {
    const m = this.exec(input);
    return m ? m.pathname.groups : null;
  }
}

/** github.com/:owner/:repo — canonical repo root */
export const GITHUB_REPO_CANON = new BunURLPattern({
  hostname: "github.com",
  pathname: "/:owner/:repo",
});

/** github.com/:owner/:repo/* — .git suffix, /tree/main, deep paths */
export const GITHUB_REPO_DEEP = new BunURLPattern({
  hostname: "github.com",
  pathname: "/:owner/:repo/*",
});

/**
 * Research server parameterized paths (fetch-handler matching).
 * Prefer these over `pathname.startsWith` / `split("/").pop()`.
 */
export const SERVE_PATTERNS = {
  /** GET /ops/partners/:nodeId */
  opsPartner: new BunURLPattern({ pathname: "/ops/partners/:nodeId" }),
  /** GET /api/hq/tennis/player/:name (name may be URL-encoded) */
  tennisPlayer: new BunURLPattern({ pathname: "/api/hq/tennis/player/:name" }),
  /** GET /api/runs/:id — same shape as ROUTES.runApi */
  runApi: new BunURLPattern({ pathname: "/api/runs/:id" }),
  /** GET /repo/:owner/:name */
  repo: new BunURLPattern({ pathname: "/repo/:owner/:name" }),
  /** Wildcard: /reports/* → groups[0] is the relative path under reports */
  reports: new BunURLPattern({ pathname: "/reports/*" }),
} as const;

/** Local report browser routes (Bun.serve `routes` keys). Max ~5 — see docs/PLAN.md. */
export const ROUTES = {
  home: "/",
  runsList: "/api/runs",
  runApi: "/api/runs/:id",
  repo: "/repo/:owner/:name",
  latestReport: "/reports/latest.md",
  architecture: "/architecture",
} as const;

export type GitHubRepoRef = {
  owner: string;
  repo: string;
  fullName: string;
};

function stripGitSuffix(repo: string): string {
  return repo.endsWith(".git") ? repo.slice(0, -4) : repo;
}

function groupsToRef(owner: string | undefined, repo: string | undefined): GitHubRepoRef | null {
  if (!owner || !repo) return null;
  const cleanRepo = stripGitSuffix(repo);
  if (!cleanRepo) return null;
  return { owner, repo: cleanRepo, fullName: `${owner}/${cleanRepo}` };
}

/** Parse any supported github.com repo URL into canonical owner/repo. */
export function parseGitHubRepoRef(input: string): GitHubRepoRef | null {
  const match = GITHUB_REPO_CANON.exec(input) ?? GITHUB_REPO_DEEP.exec(input);
  if (!match) return null;
  return groupsToRef(match.pathname.groups.owner, match.pathname.groups.repo);
}

/** @deprecated alias */
export const parseGitHubRepoUrl = parseGitHubRepoRef;

export function isGitHubRepoUrl(url: string): boolean {
  return GITHUB_REPO_CANON.test(url) || GITHUB_REPO_DEEP.test(url);
}

/** Build canonical web URL from pattern capture groups — never ad-hoc concat from wire strings. */
export function githubRepoWebUrl(owner: string, repo: string): string {
  const ref = groupsToRef(owner, repo);
  if (!ref) throw new Error("invalid github repo ref");
  return `https://github.com/${ref.fullName}`;
}

export function localRepoPath(owner: string, repo: string): string {
  const ref = groupsToRef(owner, repo);
  if (!ref) throw new Error("invalid github repo ref");
  return `/repo/${ref.owner}/${ref.repo}`;
}

/** URL wins over gh search `fullName` when they disagree. */
export function normalizeFullName(wireFullName: string, htmlUrl: string): string {
  const parsed = parseGitHubRepoRef(htmlUrl);
  if (parsed) return parsed.fullName;
  return wireFullName.includes("/") ? wireFullName : wireFullName;
}

export function fullNameFromRouteParams(owner: string, name: string): string {
  const ref = groupsToRef(owner, name);
  if (!ref) throw new Error("invalid route params");
  return ref.fullName;
}
