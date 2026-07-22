// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { auditEvidenceRelPath, auditEvidenceSlug } from "../src/research/paths.ts";

describe("audit evidence paths", () => {
  test("auditEvidenceSlug normalizes fullName", () => {
    expect(auditEvidenceSlug("OctagonAI/kalshi-trading-bot-cli")).toBe(
      "octagonai__kalshi-trading-bot-cli",
    );
  });

  test("auditEvidenceRelPath is committed in-repo location", () => {
    expect(auditEvidenceRelPath("owner/Repo")).toBe("research/audit-evidence/owner__repo.jsonl");
  });
});
