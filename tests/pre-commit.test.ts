// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  protectedDeletionViolations,
  resolveConditionalGates,
} from "../tools/pre-commit.ts";

describe("resolveConditionalGates", () => {
  test("fires partner gate on staged partner config", () => {
    expect(resolveConditionalGates(["config/partners.toml"])).toEqual(["partner:toml:validate"]);
    expect(resolveConditionalGates(["src/partner/toml-config.ts"])).toEqual(["partner:toml:validate"]);
  });

  test("fires colors + design gates on staged color paths (kernel affects bundle size)", () => {
    expect(resolveConditionalGates(["src/lib/color/palette.ts"])).toEqual(["design:check", "colors:check"]);
    expect(resolveConditionalGates(["public/registry/color-system.json"])).toEqual(["colors:check"]);
  });

  test("fires design gate on frontend module surfaces and pipeline files", () => {
    expect(resolveConditionalGates(["src/research/hq-view.ts"])).toEqual(["design:check"]);
    expect(resolveConditionalGates(["src/lib/design-budget.ts"])).toEqual(["design:check"]);
    expect(resolveConditionalGates(["scripts/build-design-system.ts"])).toEqual(["design:check"]);
    expect(resolveConditionalGates(["public/partner-dashboard/index.html"])).toEqual(["design:check"]);
    expect(resolveConditionalGates(["playground/funding-playground.html"])).toEqual(["design:check"]);
  });

  test("fires breaking-audit + deps:check + licenses:gate on manifest files", () => {
    expect(resolveConditionalGates(["package.json"])).toEqual(["bun:breaking-audit", "deps:check", "licenses:gate"]);
    expect(resolveConditionalGates(["bun.lock"])).toEqual(["bun:breaking-audit", "deps:check", "licenses:gate"]);
    expect(resolveConditionalGates(["bunfig.toml"])).toEqual(["bun:breaking-audit", "deps:check"]);
  });

  test("fires licenses:gate on policy + tooling changes", () => {
    expect(resolveConditionalGates(["config/licenses-allowlist.json"])).toEqual(["licenses:gate"]);
    expect(resolveConditionalGates(["config/audit-overrides.json"])).toEqual(["licenses:gate"]);
    expect(resolveConditionalGates(["tools/licenses-gate.ts"])).toEqual(["licenses:gate"]);
    expect(resolveConditionalGates(["tools/audit-overlay-update.ts"])).toEqual(["licenses:gate"]);
    expect(resolveConditionalGates(["src/lib/licenses-policy.ts"])).toEqual(["licenses:gate"]);
  });

  test("fires assets:check on content/docs + audit source", () => {
    expect(resolveConditionalGates(["content/posts/hello-world.md"])).toContain("assets:check");
    expect(resolveConditionalGates(["src/lib/assets-audit.ts"])).toEqual(["assets:check"]);
    expect(resolveConditionalGates(["tools/assets-check.ts"])).toEqual(["assets:check"]);
  });

  test("fires docs:check on docs + audit source", () => {
    // docs/ paths also match assets:check (docs are scanned for images)
    expect(resolveConditionalGates(["docs/AGENT-PITFALLS.md"])).toContain("docs:check");
    expect(resolveConditionalGates(["src/lib/docs-audit.ts"])).toEqual(["docs:check"]);
    expect(resolveConditionalGates(["tools/docs-check.ts"])).toEqual(["docs:check"]);
  });

  test("fires bun:blog-map on the mapping registry + tracker", () => {
    expect(resolveConditionalGates([".data/blog-map.json"])).toEqual(["bun:blog-map"]);
    expect(resolveConditionalGates(["src/lib/blog-map.ts"])).toEqual(["bun:blog-map"]);
    expect(resolveConditionalGates(["tools/bun-blog-map.ts"])).toEqual(["bun:blog-map"]);
  });

  test("fires content:check on content files + manifest + prune source", () => {
    // content/ paths also match assets:check (posts scanned for images)
    expect(resolveConditionalGates(["content/posts/hello-world.md"])).toContain("content:check");
    expect(resolveConditionalGates([".data/manifest.json"])).toEqual(["content:check"]);
    expect(resolveConditionalGates(["src/lib/prune-content.ts"])).toEqual(["content:check"]);
    expect(resolveConditionalGates(["tools/prune-content-cli.ts"])).toEqual(["content:check"]);
  });

  test("no conditional gates for unrelated changes", () => {
    expect(resolveConditionalGates(["src/institutions/massey/crossref.ts", "src/research/overview-page.ts"])).toEqual([]);
  });
});

describe("protectedDeletionViolations", () => {
  test("flags protected artifact deletions", () => {
    expect(protectedDeletionViolations(["research/audit-evidence/octagonai.jsonl"])).toEqual(["research/audit-evidence/octagonai.jsonl"]);
    expect(protectedDeletionViolations(["research/reports/latest.md"])).toEqual(["research/reports/latest.md"]);
  });

  test("allows unrelated deletions", () => {
    expect(protectedDeletionViolations(["src/foo.ts", "docs/scratch.md"])).toEqual([]);
  });
});
