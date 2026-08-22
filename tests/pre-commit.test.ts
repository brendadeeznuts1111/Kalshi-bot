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

  test("fires colors gate on staged color paths (dir prefix + files)", () => {
    expect(resolveConditionalGates(["src/lib/color/palette.ts"])).toEqual(["colors:check"]);
    expect(resolveConditionalGates(["public/registry/color-system.json"])).toEqual(["colors:check"]);
  });

  test("no conditional gates for unrelated changes", () => {
    expect(resolveConditionalGates(["src/institutions/massey/crossref.ts", "docs/README.md"])).toEqual([]);
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
