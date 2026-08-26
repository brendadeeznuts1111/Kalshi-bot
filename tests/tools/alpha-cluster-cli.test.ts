// alpha:cluster CLI polish (§205): --format json|yaml|table, NO_COLOR/FORCE_COLOR gate, flag validation.
import { describe, expect, test } from "bun:test";
import { parseClusterCli, cliUseColor, renderClusterSummary } from "../../tools/alpha-cluster-cli.ts";

describe("parseClusterCli", () => {
  test("defaults: synthetic fixture, k=5, min-cluster=3, table", () => {
    const r = parseClusterCli([]);
    expect("opts" in r).toBe(true);
    if (!("opts" in r)) return;
    expect(r.opts.input).toBeNull();
    expect(r.opts.k).toBe(5);
    expect(r.opts.minClusterSize).toBe(3);
    expect(r.opts.format).toBe("table");
    expect(r.opts.styled).toBe(false);
  });

  test("accepts --format json|yaml|table and --k/--min-cluster", () => {
    expect(parseClusterCli(["--format=yaml"])).toEqual({ opts: { input: null, k: 5, minClusterSize: 3, styled: false, format: "yaml" } });
    expect(parseClusterCli(["--k=7", "--min-cluster=2", "--styled"])).toEqual({ opts: { input: null, k: 7, minClusterSize: 2, styled: true, format: "table" } });
  });

  test("rejects invalid format and non-numeric flags (exit 2 path)", () => {
    const badFmt = parseClusterCli(["--format=xml"]);
    expect("error" in badFmt && badFmt.error).toContain("--format must be table|json|yaml");
    const badK = parseClusterCli(["--k=abc"]);
    expect("error" in badK && badK.error).toContain("--k must be a positive number");
    const badMc = parseClusterCli(["--min-cluster=0"]);
    expect("error" in badMc && badMc.error).toContain("--min-cluster must be a positive number");
  });
});

describe("cliUseColor", () => {
  test("NO_COLOR disables; FORCE_COLOR=0 disables; default enabled", () => {
    expect(cliUseColor({})).toBe(true);
    expect(cliUseColor({ NO_COLOR: "1" })).toBe(false);
    expect(cliUseColor({ NO_COLOR: "0" })).toBe(true);
    expect(cliUseColor({ FORCE_COLOR: "0" })).toBe(false);
    expect(cliUseColor({ NO_COLOR: "1", FORCE_COLOR: "1" })).toBe(false); // NO_COLOR wins
  });
});

describe("renderClusterSummary", () => {
  const s = { prints: 24, clusters: 3, noise: 1, shifts: 2, labels: { a: 0, b: 1 } };
  test("json format parses back", () => {
    const out = renderClusterSummary(s, "json");
    const parsed = JSON.parse(out);
    expect(parsed.prints).toBe(24);
    expect(parsed.consensusShifts).toBe(2);
  });

  test("yaml format uses grounded Bun.YAML (flow style, §198)", () => {
    const out = renderClusterSummary(s, "yaml");
    expect(out).toContain("prints: 24");
    expect(out).toContain("clusters: 3");
  });

  test("table format is the human summary line", () => {
    const out = renderClusterSummary(s, "table");
    expect(out).toContain("24 prints");
    expect(out).toContain("3 clusters");
  });
});
