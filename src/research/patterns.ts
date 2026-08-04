// @see https://bun.com/blog/bun-v1.3.4#urlpattern-api
// @see https://bun.com/blog/bun-v1.3.4#urlpattern-api:~:text=Pattern%20properties%3A%20protocol%2C%20username%2C%20password%2C%20hostname%2C%20port%2C%20pathname%2C%20search%2C%20hash
// @see https://bun.com/blog/bun-v1.3.12#urlpattern-is-up-to-2-3x-faster
// @see https://bun.com/docs/runtime/http/server#basic-setup
/**
 * Shared URLPattern SSOT — GitHub parse, Bun.serve routes, research fetch handlers.
 *
 * Blog vectors (v1.3.4):
 *   new URLPattern({ pathname: "/users/:id" }).exec(...).pathname.groups.id
 *   new URLPattern({ pathname: "/files/*" }).exec(...).pathname.groups[0]
 *   Pattern properties: protocol, username, password, hostname, port,
 *     pathname, search, hash (+ hasRegExpGroups)
 */

/** Thin wrapper so URLPattern usage stays consistent across modules. */
export class BunURLPattern {
  readonly pattern: URLPattern;

  constructor(init: URLPatternInit | string | URLPattern) {
    this.pattern = init instanceof URLPattern ? init : new URLPattern(init);
  }

  // ── Pattern properties (read-only component patterns) ──
  // @see Pattern properties: protocol, username, password, hostname, port, pathname, search, hash
  get protocol(): string {
    return this.pattern.protocol;
  }
  get username(): string {
    return this.pattern.username;
  }
  get password(): string {
    return this.pattern.password;
  }
  get hostname(): string {
    return this.pattern.hostname;
  }
  get port(): string {
    return this.pattern.port;
  }
  get pathname(): string {
    return this.pattern.pathname;
  }
  get search(): string {
    return this.pattern.search;
  }
  get hash(): string {
    return this.pattern.hash;
  }
  /** True when any component uses a custom regular-expression group. */
  get hasRegExpGroups(): boolean {
    return this.pattern.hasRegExpGroups;
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

  /**
   * Full component group bag after a match (pathname + search + hash).
   * Useful when patterns constrain more than pathname alone.
   */
  componentGroups(input: string | URL): {
    pathname: Record<string, string | undefined>;
    search: Record<string, string | undefined>;
    hash: Record<string, string | undefined>;
  } | null {
    const m = this.exec(input);
    if (!m) return null;
    return {
      pathname: m.pathname.groups,
      search: m.search.groups,
      hash: m.hash.groups,
    };
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

/**
 * Server routes: pathname-only (protocol/hostname/port stay `*`).
 * Pinning origin would break 127.0.0.1 vs localhost and non-default ports.
 * Use multi-component URLPatternInit only when you intentionally constrain host
 * (see GITHUB_REPO_CANON) or search/hash (componentGroups).
 *
 * Naming lanes (do not conflate):
 *   ROUTES          — research report browser only (`Bun.serve` routes map keys)
 *   SERVE_PATTERNS  — HQ / ops / tennis fetch handlers (URLPattern + EXACT path SSOT)
 *   GITHUB_REPO_*   — external github.com parse (`:owner` / `:repo`)
 *   glossary ids    — semantic concepts (tip keys, filter catalogs) — not URL paths
 *
 * Param convention (path segments):
 *   :id      generic resource (run timestamps)
 *   :name    human / route display name (player, repo name on ROUTES.repo)
 *   :nodeId  regulatory partner node
 *   :owner   GitHub owner
 *   :repo    GitHub repo (GITHUB patterns only — ROUTES uses :name for the same slot)
 *
 * @see Pattern properties: protocol, username, password, hostname, port, pathname, search, hash
 *   https://bun.com/blog/bun-v1.3.4#urlpattern-api
 * @see docs/SEMANTIC_LAYER.md — glossary naming
 */
export const SERVE_PATTERNS = {
  // ── Research & reports ──
  runApi:    new BunURLPattern({ pathname: "/api/runs/:id" }),
  // Param names must match ROUTES.repo (`:owner` / `:name`) for Bun.serve handlers.
  repo:      new BunURLPattern({ pathname: "/repo/:owner/:name" }),
  reports:   new BunURLPattern({ pathname: "/reports/*" }),

  // ── Tennis HQ ──
  tennisPlayer: new BunURLPattern({ pathname: "/api/hq/tennis/player/:name" }),

  // ── Match liquidity (derived event-store table) ──
  liquidityByEvent:      new BunURLPattern({ pathname: "/api/liquidity/:eventId" }),
  liquidityByTournament: new BunURLPattern({ pathname: "/api/liquidity/by-tournament/:key" }),

  // ── Ops dashboard ──
  opsPartner:     new BunURLPattern({ pathname: "/ops/partners/:nodeId" }),
  kalshiRotateKey: new BunURLPattern({ pathname: "/ops/kalshi-rotate-key" }),

  // ── Polymarket ──
  polyIngest:    new BunURLPattern({ pathname: "/polymarket/ingest" }),
  polyStatus:    new BunURLPattern({ pathname: "/polymarket/status" }),
  polyTicks:     new BunURLPattern({ pathname: "/polymarket/ticks" }),
  polyLineMoves: new BunURLPattern({ pathname: "/polymarket/line-moves" }),

  /**
   * Static pathnames (exact `===` match). Keys are camelCase route roles.
   * Do **not** name a key `home` — that collides with ROUTES.home (`"/"`).
   * HQ app shell is `hq` → `/hq`.
   */
  EXACT: {
    hq:              "/hq",
    hqData:          "/api/hq",
    glossary:        "/api/glossary",
    tennisBoard:     "/api/hq/tennis",
    tennisPlayerQuery: "/api/hq/tennis/player", // ?name= form; path form is tennisPlayer pattern
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
    /** Live OFFICIAL_URLS catalog probe (+ optional ?glossary=1) */
    healthUrls:      "/api/health/urls",
    /** Kalshi exchange status (prod/demo/elections) */
    healthKalshi:    "/api/health/kalshi",
    agentDispatch:   "/agent/dispatch",
    /** Same path as ROUTES.latestReport — research browser SSOT for path string */
    reportsLatest:   "/reports/latest.md",
    /** Same path as ROUTES.architecture */
    architecture:    "/architecture",
  },
} as const;

/**
 * Research **report browser** routes only (`Bun.serve` `routes` map).
 * Not the HQ SPA — that lives under SERVE_PATTERNS.EXACT.hq (`/hq`).
 */
export const ROUTES = {
  /** Report browser index (not HQ) */
  home: "/",
  runsList: "/api/runs",
  runApi: "/api/runs/:id",
  /** Second segment is `:name` here; GitHub parse uses `:repo` (different lane) */
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
