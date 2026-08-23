import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditRepository,
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
      "devDependencies.@iarna/toml duplicates Bun.TOML.parse() / governed tomlStringify()",
    ]);
  });

  test("blocks npm aliases to native replacements", () => {
    const violations = findManifestViolations({
      dependencies: {
        ansi: "npm:wrap-ansi@9",
        parser: "npm:@iarna/toml@3.0.0",
      },
    });

    expect(violations.map((item) => item.message)).toEqual([
      "dependencies.ansi aliases wrap-ansi; use Bun.wrapAnsi()",
      "dependencies.parser aliases @iarna/toml; use Bun.TOML.parse() / governed tomlStringify()",
    ]);
  });

  test("blocks imports and allows console examples in comments and strings", () => {
    const violations = findSourceViolations(`
      import wrapAnsi from "wrap-ansi";
      const table = require("cli-table3");
      await import("@iarna/toml");
      // Documentation can mention console.table([]).
      const example = "console.table([])";
    `);

    expect(violations).toHaveLength(3);
    expect(violations.map((item) => item.message).join("\n")).toContain("Bun.wrapAnsi()");
    expect(violations.map((item) => item.message).join("\n")).toContain("Bun.inspect.table()");
    expect(violations.map((item) => item.message).join("\n")).toContain("Bun.TOML.parse()");
  });

  test("blocks node:child_process imports - subprocesses only via Bun APIs", () => {
    const violations = findSourceViolations(`
      import { spawnSync } from "node:child_process";
      const out = spawnSync("git", ["status"]);
    `);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("node:child_process");
    expect(violations[0]?.message).toContain("Bun.spawnSync()");
  });

  test("blocks execa in manifests - subprocesses only via Bun APIs", () => {
    const violations = findManifestViolations({
      dependencies: { execa: "^9.0.0" },
    });

    expect(violations.map((item) => item.message)).toEqual([
      "dependencies.execa duplicates Bun.spawnSync() / Bun.$ (Bun Shell)",
    ]);
  });

  test("allows Bun Shell and Bun.spawnSync as the native subprocess surface", () => {
    const violations = findSourceViolations(`
      import { $ } from "bun";
      const out = Bun.spawnSync(["git", "status"], { stdout: "pipe" });
      await $\`git status\`.nothrow().quiet();
    `);

    expect(violations).toEqual([]);
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

  test("blocks declarations that shadow canonical Bun types", () => {
    expect(findSourceViolations("declare namespace Bun { interface WebView {} }")[0]?.message)
      .toContain("canonical bun-types");
    expect(findSourceViolations("interface Bun { version: string }")[0]?.message)
      .toContain("canonical runtime/type namespace");
  });

  test("audits an explicit Git file universe and ignores nested dependency trees", async () => {
    const root = mkdtempSync(join(tmpdir(), "bun-native-guard-"));
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, "alpha", "demo", "node_modules", "pkg"), { recursive: true });
      await Bun.write(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { "string-width": "1.0.0" } }),
      );
      await Bun.write(join(root, "src", "ok.ts"), "console.log(Bun.stringWidth('ok'));");
      await Bun.write(
        join(root, "alpha", "demo", "node_modules", "pkg", "bad.ts"),
        "import width from 'string-width';",
      );

      const violations = await auditRepository(root, [
        "package.json",
        "src/ok.ts",
        "alpha/demo/node_modules/pkg/bad.ts",
      ]);

      expect(violations.map((item) => item.message)).toEqual([
        "dependencies.string-width duplicates Bun.stringWidth()",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
