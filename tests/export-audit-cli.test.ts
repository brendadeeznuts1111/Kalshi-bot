// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  parseExportAuditCli,
  runExportAuditCli,
} from "../src/research/export-audit-cli.ts";

describe("parseExportAuditCli", () => {
  test("parses verify and repo flags", () => {
    expect(parseExportAuditCli(["--verify", "research/exports/audit/x"])).toEqual({
      runId: undefined,
      latest: false,
      verify: "research/exports/audit/x",
      repo: undefined,
    });
    expect(parseExportAuditCli(["--latest", "--repo", "OctagonAI/kalshi-trading-bot-cli"])).toEqual({
      runId: undefined,
      latest: true,
      verify: undefined,
      repo: "OctagonAI/kalshi-trading-bot-cli",
    });
  });
});

describe("runExportAuditCli", () => {
  test("--verify exits 1 when export dir missing", async () => {
    const code = await runExportAuditCli({
      latest: false,
      verify: "research/exports/audit/__missing-verify-dir__",
    });
    expect(code).toBe(1);
  });

  test("requires --run or --latest when not verifying", async () => {
    const code = await runExportAuditCli({ latest: false });
    expect(code).toBe(1);
  });
});
