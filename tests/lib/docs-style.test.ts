// docs-style — smart prose-wall detection (§57 refine).
import { describe, expect, test } from "bun:test";
import { auditDocsStyle } from "../../src/lib/docs-style.ts";

describe("auditDocsStyle", () => {
  test("flags a wall of long prose bullets with no structure", () => {
    const md = [
      "## Section",
      "- " + "x".repeat(300),
      "- " + "y".repeat(250),
      "- " + "z".repeat(220),
      "- " + "a".repeat(210),
      "- " + "b".repeat(205),
      "- " + "c".repeat(300),
    ].join("\n");
    const issues = auditDocsStyle(md, "x.md");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.detail).toContain("prose bullet wall");
  });

  test("passes a short factual checklist (list-appropriate)", () => {
    const md = [
      "## Security notes",
      "- .env contains only URIs, never secrets",
      "- secrets live encrypted in Proton Pass",
      "- prefer PATs scoped with viewer",
      "- the wrapper never logs secret values",
      "- never commit .env.pass-tokens",
      "- tokens are masked in output",
    ].join("\n");
    expect(auditDocsStyle(md, "x.md")).toEqual([]);
  });

  test("passes when subsections or tables exist", () => {
    const md = [
      "## Section",
      "### Group",
      "- " + "x".repeat(300),
      "- " + "y".repeat(300),
      "- " + "z".repeat(300),
      "- " + "a".repeat(300),
      "- " + "b".repeat(300),
      "- " + "c".repeat(300),
    ].join("\n");
    expect(auditDocsStyle(md, "x.md")).toEqual([]);
  });
});