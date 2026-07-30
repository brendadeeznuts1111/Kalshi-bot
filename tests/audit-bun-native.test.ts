import { describe, expect, test } from "bun:test";
import {
  findManifestViolations,
  findSourceViolations,
} from "../scripts/audit-bun-native.ts";

describe("bun-native guard", () => {
  test("blocks direct dependencies with exact native replacements", () => {
    const violations = findManifestViolations({
      dependencies: {
        "wrap-ansi": "^9.0.0",
        zod: "^4.4.3",
      },
      devDependencies: {
        "@iarna/toml": "^3.0.0",
      },
    });

    expect(violations.map((item) => item.message)).toEqual([
      "dependencies.wrap-ansi duplicates Bun.wrapAnsi()",
      "devDependencies.@iarna/toml duplicates Bun.TOML.parse() / Bun.TOML.stringify()",
    ]);
  });

  test("blocks imports, require calls, dynamic imports, and console.table", () => {
    const directTableCall = ["console", "table"].join(".");
    const violations = findSourceViolations(`
      import wrapAnsi from "wrap-ansi";
      const table = require("cli-table3");
      await import("@iarna/toml");
      ${directTableCall}([{ ok: true }]);
    `);

    expect(violations).toHaveLength(4);
    expect(violations.map((item) => item.message).join("\n")).toContain("Bun.wrapAnsi()");
    expect(violations.map((item) => item.message).join("\n")).toContain("Bun.inspect.table()");
    expect(violations.map((item) => item.message).join("\n")).toContain("Bun.TOML.parse()");
  });

  test("allows Bun APIs, Node compatibility APIs, and non-equivalent styling packages", () => {
    const violations = findSourceViolations(`
      import { join } from "node:path";
      import chalk from "chalk";
      const output = Bun.inspect.table([{ ok: true }]);
      console.log(chalk.green(join("a", "b")), output);
    `);

    expect(violations).toEqual([]);
  });
});
