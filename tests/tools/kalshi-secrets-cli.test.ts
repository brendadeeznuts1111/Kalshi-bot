// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { DEFAULT_SECRET_SERVICE } from "../../src/lib/secrets.ts";
import { fingerprint, needsPrompt, parseCliArgs } from "../../tools/kalshi-secrets-cli.ts";

describe("kalshi:secrets CLI args", () => {
  test("command is the first positional token, anywhere in argv", () => {
    expect(parseCliArgs(["store"]).command).toBe("store");
    expect(parseCliArgs(["--force", "delete"]).command).toBe("delete");
    expect(parseCliArgs(["--service", "x", "inspect"]).command).toBe("inspect");
  });

  test("--service value form and = form override the default", () => {
    expect(parseCliArgs(["store"]).service).toBe(DEFAULT_SECRET_SERVICE);
    expect(parseCliArgs(["store", "--service", "kalshi-api-test"]).service).toBe(
      "kalshi-api-test",
    );
    expect(parseCliArgs(["store", "--service=kalshi-api-test"]).service).toBe(
      "kalshi-api-test",
    );
  });

  test("force/unrestricted/verbose flags parse", () => {
    const a = parseCliArgs(["store", "--force", "--unrestricted", "--verbose"]);
    expect(a.force).toBe(true);
    expect(a.unrestricted).toBe(true);
    expect(a.verbose).toBe(true);
    expect(parseCliArgs(["store"]).force).toBe(false);
  });
});

describe("fingerprint (masked, never the value)", () => {
  test("deterministic 8-hex digest", () => {
    expect(fingerprint("abc")).toBe(fingerprint("abc"));
    expect(fingerprint("abc")).toMatch(/^[0-9a-f]{8}$/);
  });
  test("different values differ", () => {
    expect(fingerprint("abc")).not.toBe(fingerprint("abd"));
  });
});

describe("needsPrompt (overwrite/delete guard)", () => {
  test("prompts only when the entry exists and --force is absent", () => {
    expect(needsPrompt(true, false)).toBe(true);
    expect(needsPrompt(false, false)).toBe(false);
    expect(needsPrompt(true, true)).toBe(false);
    expect(needsPrompt(false, true)).toBe(false);
  });
});
