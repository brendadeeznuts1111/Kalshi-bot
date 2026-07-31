// @see https://bun.com/docs/test/index#run-tests
// @see https://bun.com/docs/pm/cli/update#visual-indicators
import { describe, expect, test } from "bun:test";
import {
  classifySemverChange,
  parseOutdatedTable,
} from "../../scripts/deps-outdated.ts";

describe("deps-outdated", () => {
  test("classifySemverChange major/minor/patch", () => {
    expect(classifySemverChange("1.0.0", "2.0.0")).toBe("major");
    expect(classifySemverChange("1.0.0", "1.1.0")).toBe("minor");
    expect(classifySemverChange("1.0.0", "1.0.1")).toBe("patch");
    expect(classifySemverChange("1.0.0", "1.0.0")).toBe("same");
    expect(classifySemverChange("6.0.3", "7.0.2")).toBe("major");
  });

  test("parseOutdatedTable strips (dev) suffix", () => {
    const text = `
| Package          | Current | Update | Latest |
|------------------|---------|--------|--------|
| typescript (dev) | 6.0.3   | 6.0.3  | 7.0.2  |
`;
    const rows = parseOutdatedTable(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.package).toBe("typescript");
    expect(rows[0]!.latest).toBe("7.0.2");
  });
});
