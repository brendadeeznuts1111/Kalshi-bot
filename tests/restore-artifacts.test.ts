// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { auditEvidenceAbsPath } from "../src/research/paths.ts";
import { restoreCommittedArtifacts } from "../tools/restore-committed-artifacts.ts";

describe("restore-committed-artifacts", () => {
  test("restores octagonai audit evidence after test overwrite", async () => {
    const path = auditEvidenceAbsPath("OctagonAI/kalshi-trading-bot-cli");
    await Bun.write(path, '{"scope":"test"}\n');
    const restored = await restoreCommittedArtifacts();
    expect(restored).toContain("octagonai audit evidence");
    const text = await Bun.file(path).text();
    expect(text).toContain("KALSHI-ACCESS-SIGNATURE");
  });
});
