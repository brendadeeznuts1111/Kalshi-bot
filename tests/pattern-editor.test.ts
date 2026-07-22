// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { resolveClonedRepoFile, patternReportPath } from "../src/agent/pattern-editor.ts";

describe("pattern-editor", () => {
  test("resolveClonedRepoFile returns null without REPO_CLONE_ROOT", () => {
    const prev = Bun.env.REPO_CLONE_ROOT;
    delete Bun.env.REPO_CLONE_ROOT;
    expect(resolveClonedRepoFile("o/r", "src/index.ts")).toBeNull();
    if (prev) Bun.env.REPO_CLONE_ROOT = prev;
  });

  test("patternReportPath uses dimension basename", () => {
    expect(patternReportPath("market-making")).toContain("patterns-latest-market-making.md");
  });
});
