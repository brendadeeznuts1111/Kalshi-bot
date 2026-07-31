// @see https://bun.com/docs/test/index#run-tests
// @see https://bun.com/blog/bun-v1.3.4#urlpattern-api
// @see https://bun.com/blog/bun-v1.3.4#urlpattern-api:~:text=Pattern%20properties%3A%20protocol%2C%20username%2C%20password%2C%20hostname%2C%20port%2C%20pathname%2C%20search%2C%20hash
import { describe, expect, test } from "bun:test";
import {
  BunURLPattern,
  githubRepoWebUrl,
  isGitHubRepoUrl,
  localRepoPath,
  normalizeFullName,
  parseGitHubRepoRef,
  ROUTES,
  SERVE_PATTERNS,
} from "../../src/research/patterns.ts";

describe("URLPattern blog vectors (v1.3.4)", () => {
  test("named group /users/:id", () => {
    // Match URLs with a user ID parameter
    const pattern = new BunURLPattern({ pathname: "/users/:id" });

    expect(pattern.test("https://example.com/users/123")).toBe(true);
    expect(pattern.test("https://example.com/posts/456")).toBe(false);

    const result = pattern.exec("https://example.com/users/123");
    expect(result?.pathname.groups.id).toBe("123");
  });

  test("wildcard /files/* → groups[0]", () => {
    const filesPattern = new BunURLPattern({ pathname: "/files/*" });
    const match = filesPattern.exec("https://example.com/files/image.png");
    expect(match?.pathname.groups[0]).toBe("image.png");
  });

  test("pattern properties: protocol hostname pathname search hash", () => {
    // Pattern properties: protocol, username, password, hostname, port, pathname, search, hash
    const pattern = new BunURLPattern({
      protocol: "https",
      hostname: "example.com",
      pathname: "/users/:id",
      search: "q=:q",
      hash: "section-:s",
    });

    expect(pattern.protocol).toBe("https");
    expect(pattern.hostname).toBe("example.com");
    expect(pattern.pathname).toBe("/users/:id");
    expect(pattern.search).toBe("q=:q");
    expect(pattern.hash).toBe("section-:s");
    // Unconstrained components stay as wildcards
    expect(pattern.username).toBe("*");
    expect(pattern.password).toBe("*");
    expect(pattern.port).toBe("*");
    expect(pattern.hasRegExpGroups).toBe(false);

    const href = "https://example.com/users/9?q=tennis#section-a";
    expect(pattern.test(href)).toBe(true);
    expect(pattern.test("http://example.com/users/9?q=tennis#section-a")).toBe(false);

    const parts = pattern.componentGroups(href);
    expect(parts?.pathname.id).toBe("9");
    expect(parts?.search.q).toBe("tennis");
    expect(parts?.hash.s).toBe("a");
  });

  test("GITHUB_REPO_CANON exposes hostname + pathname properties", () => {
    // Multi-component init (hostname constrained) — not pathname-only
    const p = new BunURLPattern({
      hostname: "github.com",
      pathname: "/:owner/:repo",
    });
    expect(p.hostname).toBe("github.com");
    expect(p.pathname).toBe("/:owner/:repo");
    expect(p.protocol).toBe("*");
    expect(p.test("https://github.com/a/b")).toBe(true);
    expect(p.test("https://gitlab.com/a/b")).toBe(false);
  });
});

describe("SERVE_PATTERNS — research fetch handlers", () => {
  test("ops partner extracts nodeId (pathname-only — any host/port)", () => {
    // Unconstrained host: pattern.hostname is "*"
    expect(SERVE_PATTERNS.opsPartner.hostname).toBe("*");
    expect(SERVE_PATTERNS.opsPartner.protocol).toBe("*");
    expect(SERVE_PATTERNS.opsPartner.port).toBe("*");
    expect(SERVE_PATTERNS.opsPartner.pathname).toBe("/ops/partners/:nodeId");

    const g = SERVE_PATTERNS.opsPartner.groups(
      "http://127.0.0.1:3456/ops/partners/acme?state=MA",
    );
    expect(g?.nodeId).toBe("acme");
    // Same path on another origin still matches (pathname-only pattern)
    expect(
      SERVE_PATTERNS.opsPartner.groups("https://ops.example.com/ops/partners/acme")?.nodeId,
    ).toBe("acme");
    expect(SERVE_PATTERNS.opsPartner.test("http://127.0.0.1:3456/ops/partners/")).toBe(false);
  });

  test("tennis player path extracts name", () => {
    const g = SERVE_PATTERNS.tennisPlayer.groups(
      "http://localhost/api/hq/tennis/player/Rafael%20Nadal",
    );
    expect(g?.name).toBe("Rafael%20Nadal");
    expect(decodeURIComponent(g!.name!)).toBe("Rafael Nadal");
  });

  test("reports wildcard", () => {
    const m = SERVE_PATTERNS.reports.exec(
      "http://localhost/reports/weekly-review-2026-07-28.md",
    );
    expect(m?.pathname.groups[0]).toBe("weekly-review-2026-07-28.md");
  });

  test("ROUTES shapes match SERVE_PATTERNS", () => {
    expect(ROUTES.runApi).toBe("/api/runs/:id");
    expect(ROUTES.repo).toBe("/repo/:owner/:name");
    const run = SERVE_PATTERNS.runApi.groups("http://x/api/runs/2026-07-28T12:00:00Z");
    expect(run?.id).toBe("2026-07-28T12:00:00Z");
    const repo = SERVE_PATTERNS.repo.groups("http://x/repo/foo/bar");
    expect(repo).toEqual({ owner: "foo", name: "bar" });
  });

  test("EXACT.hq is /hq — never collides with ROUTES.home /", () => {
    expect(ROUTES.home).toBe("/");
    expect(SERVE_PATTERNS.EXACT.hq).toBe("/hq");
    expect(SERVE_PATTERNS.EXACT.reportsLatest).toBe(ROUTES.latestReport);
    expect(SERVE_PATTERNS.EXACT.architecture).toBe(ROUTES.architecture);
    // @ts-expect-error home is not an EXACT key (was renamed to hq)
    expect(SERVE_PATTERNS.EXACT.home).toBeUndefined();
  });
});

describe("BunURLPattern GitHub repo SSOT", () => {
  test("parses canonical repo URL", () => {
    const ref = parseGitHubRepoRef("https://github.com/OctagonAI/kalshi-trading-bot-cli");
    expect(ref).toEqual({
      owner: "OctagonAI",
      repo: "kalshi-trading-bot-cli",
      fullName: "OctagonAI/kalshi-trading-bot-cli",
    });
  });

  test("parses .git suffixed URL", () => {
    const ref = parseGitHubRepoRef("https://github.com/foo/bar.git");
    expect(ref?.fullName).toBe("foo/bar");
  });

  test("parses deep /tree/main/src path", () => {
    const ref = parseGitHubRepoRef("https://github.com/openfi-dao/kalshi-trading-bot/tree/main/src");
    expect(ref?.fullName).toBe("openfi-dao/kalshi-trading-bot");
  });

  test("rejects non-GitHub URLs", () => {
    expect(parseGitHubRepoRef("https://gitlab.com/foo/bar")).toBeNull();
    expect(isGitHubRepoUrl("https://example.com/foo/bar")).toBe(false);
  });

  test("githubRepoWebUrl and localRepoPath share capture groups", () => {
    const ref = parseGitHubRepoRef("https://github.com/scripflipped/Krypt-Trader")!;
    expect(githubRepoWebUrl(ref.owner, ref.repo)).toBe("https://github.com/scripflipped/Krypt-Trader");
    expect(localRepoPath(ref.owner, ref.repo)).toBe("/repo/scripflipped/Krypt-Trader");
  });

  test("normalizeFullName prefers URL over wrong gh fullName", () => {
    expect(
      normalizeFullName("wrong/foo", "https://github.com/correct/bar"),
    ).toBe("correct/bar");
    expect(
      normalizeFullName("bad", "https://github.com/OctagonAI/kalshi-trading-bot-cli"),
    ).toBe("OctagonAI/kalshi-trading-bot-cli");
  });

  test("ROUTES align with localRepoPath shape", () => {
    expect(ROUTES.repo).toBe("/repo/:owner/:name");
    expect(ROUTES.runsList).toBe("/api/runs");
    expect(localRepoPath("a", "b")).toBe("/repo/a/b");
  });
});
