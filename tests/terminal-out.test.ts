// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  formatInspectTable,
  padDisplay,
  plainDisplay,
  repoTerminalLink,
  shortlistTableRows,
  terminalLink,
  wrapDisplay,
} from "../src/research/terminal-out.ts";
import {
  buildResearchSpawnArgs,
  formatProgressLine,
  isResearchProgressMessage,
} from "../src/research/research-progress.ts";

describe("terminal-out", () => {
  test("terminalLink preserves visible width for Bun.stringWidth", () => {
    const text = "owner/repo";
    const linked = terminalLink(text, "https://github.com/owner/repo");
    expect(Bun.stringWidth(linked)).toBe(Bun.stringWidth(text));
    expect(linked.length).toBeGreaterThan(text.length);
  });

  test("repoTerminalLink uses githubRepoWebUrl", () => {
    expect(repoTerminalLink("OctagonAI/kalshi-trading-bot-cli", false)).toBe(
      "OctagonAI/kalshi-trading-bot-cli",
    );
  });

  test("shortlistTableRows builds inspect.table rows", () => {
    const rows = shortlistTableRows(
      [
        {
          repo: {
            fullName: "o/r",
            license: { unlicensed: false },
          },
          score: { total: 70, authApi: 20, orderRealism: 18 },
        },
      ],
      { hyperlinks: false },
    );
    expect(rows[0]?.repo).toBe("o/r");
    expect(rows[0]?.score).toBe(70);
    expect(rows[0]?.license).toBe("ok");
  });

  test("formatInspectTable returns empty string for no rows", () => {
    expect(formatInspectTable([], ["a"])).toBe("");
  });

  test("padDisplay pads by Bun.stringWidth", () => {
    expect(padDisplay("auth", 8)).toBe("auth    ");
    expect(Bun.stringWidth(padDisplay("auth", 8))).toBe(8);
    expect(padDisplay("orders", 4).endsWith("…")).toBe(true);
  });

  test("padDisplay truncates ANSI-colored text without leaving escapes", () => {
    const colored = "\u001b[31morders\u001b[0m";
    const truncated = padDisplay(colored, 4);
    expect(plainDisplay(truncated)).toBe("ord…");
    expect(truncated.includes("\u001b[")).toBe(false);
  });

  test("wrapDisplay preserves ANSI across soft wraps", () => {
    const colored = "\u001b[31mThe quick brown fox jumps over the lazy dog\u001b[0m";
    const wrapped = wrapDisplay(colored, 20);
    expect(wrapped.includes("\n")).toBe(true);
    expect(plainDisplay(wrapped).replace(/\n/g, " ")).toContain("quick brown");
  });

  test("plainDisplay strips ANSI via Bun.stripANSI", () => {
    expect(plainDisplay("\u001b[1mBold\u001b[0m")).toBe("Bold");
  });
});

describe("research progress", () => {
  test("formatProgressLine renders inspect progress", () => {
    const line = formatProgressLine({
      type: "inspect",
      repo: "o/r",
      n: 2,
      total: 10,
      cached: true,
      brief: '{ lang: "TypeScript", tags: "tracking" }',
    });
    expect(line).toContain("o/r");
    expect(line).toContain("(cached)");
    expect(line).toContain("2/10");
    expect(line).toContain("TypeScript");
  });

  test("isResearchProgressMessage validates wire shape", () => {
    expect(isResearchProgressMessage({ type: "complete", runId: "x", dimension: "d", shortlist: 1 })).toBe(true);
    expect(isResearchProgressMessage({ type: "complete", runId: "x" })).toBe(false);
    expect(isResearchProgressMessage({ type: "nope" })).toBe(false);
    expect(isResearchProgressMessage(null)).toBe(false);
  });

  test("buildResearchSpawnArgs forwards CLI flags", () => {
    expect(
      buildResearchSpawnArgs({
        json: false,
        exportAudit: true,
        dimension: "price-data",
        minStars: 1,
        minForks: 0,
      }),
    ).toEqual([
      "--export-audit",
      "--dimension=price-data",
      "--min-stars=1",
      "--min-forks=0",
    ]);
    expect(buildResearchSpawnArgs({ dryRun: true, dimension: "sports-nba" })).toEqual([
      "--dry-run",
      "--dimension=sports-nba",
    ]);
  });
});
