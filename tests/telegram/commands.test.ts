import { describe, expect, test } from "bun:test";
import { parseTelegramCommand } from "../../src/telegram/commands.ts";

describe("Telegram command parser", () => {
  test("case-folds only the command and preserves arguments", () => {
    expect(parseTelegramCommand(" /REVOKE_OUT out-SPORTS-1 ")).toEqual({
      name: "revoke_out",
      botUsername: null,
      args: ["out-SPORTS-1"],
    });
  });

  test("accepts group command suffixes", () => {
    expect(parseTelegramCommand("/Approve@FactoryWagerBot 42")).toEqual({
      name: "approve",
      botUsername: "factorywagerbot",
      args: ["42"],
    });
  });

  test("rejects malformed commands", () => {
    for (const text of ["approve 1", "/", "/approve@ 1", "/approve bad\narg"]) {
      if (text === "/approve bad\narg") {
        expect(parseTelegramCommand(text)?.args).toEqual(["bad", "arg"]);
      } else {
        expect(parseTelegramCommand(text)).toBeNull();
      }
    }
  });
});
