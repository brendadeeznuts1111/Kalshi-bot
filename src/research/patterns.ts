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
 * Research server pattern taxonomy — one SSOT for all routes.
 * Organized by domain. Each entry has: pattern, method, handler hint.
 *
 * ── Pattern types ──
 *   ExactMap[MAX_PATTERNS]     → static pathname (=== is faster, keep)
 *   BunURLPattern               → parameterized or wildcard paths
 *
 * ── Param naming convention ──
 *   :nodeId    — resource identifier (alphanumeric + hyphen/underscore)
 *   :name      — human-readable name (may contain spaces, URL-encoded)
 *   :owner     — GitHub owner (alphanumeric + hyphen, no dot)
 *   :repo      — GitHub repo name (alphanumeric + hyphen/dot)
 *   :id        — generic resource id
 *   :runId     — timestamp-based run identifier
 */
export const SERVE_PATTERNS = {
  // ── Research & reports ──
  runApi:    new BunURLPattern({ pathname: "/api/runs/:id" }),
  // Param names must match ROUTES.repo (`:owner` / `:name`) for Bun.serve handlers.
  repo:      new BunURLPattern({ pathname: "/repo/:owner/:name" }),
  reports:   new BunURLPattern({ pathname: "/reports/*" }),

  // ── Tennis HQ ──
  tennisPlayer: new BunURLPattern({ pathname: "/api/hq/tennis/player/:name" }),

  // ── Ops dashboard ──
  opsPartner: new BunURLPattern({ pathname: "/ops/partners/:nodeId" }),
  kalshiRotateKey: new BunURLPattern({ pathname: "/ops/kalshi-rotate-key" }),

  // ── Polymarket ──
  polyIngest:    new BunURLPattern({ pathname: "/polymarket/ingest" }),
  polyStatus:    new BunURLPattern({ pathname: "/polymarket/status" }),
  polyTicks:     new BunURLPattern({ pathname: "/polymarket/ticks" }),
  polyLineMoves: new BunURLPattern({ pathname: "/polymarket/line-moves" }),

  // ── Conventions ──
  /** Static paths where `===` is simpler than URLPattern. Listed for completeness. */
  EXACT: {
    home:            "/hq",
    hqData:          "/api/hq",
    glossary:        "/api/glossary",
    tennisBoard:     "/api/hq/tennis",
    events:          "/api/events",
    metaAudit:       "/api/meta/audit",
    profiles:        "/api/profiles",
    opponentProfiles:"/api/opponent-profiles",
    ops:             "/ops",
    opsJson:         "/ops.json",
    placeBet:        "/place-bet",
    tradingOrder:    "/api/trading/order",
    tradingCancel:   "/api/trading/cancel",
    tradingBook:     "/api/trading/book",
    design:          "/api/design",
    designAudit:     "/api/design/audit",
    regulatoryHealth:"/regulatory/health",
    agentDispatch:   "/agent/dispatch",
    reportsLatest:   "/reports/latest.md",
    architecture:    "/architecture",
  },
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
