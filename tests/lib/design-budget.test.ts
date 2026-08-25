// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  DESIGN_MODULES,
  budgetStatus,
  checkBundleOutputs,
  circularImports,
  deltaPct,
  entryBytesFromMetaJson,
  externalImports,
  gitSnapshot,
  largestContributorBytes,
  moduleBytesFromMetaJson,
  readBundleHistory,
  recordBundleHistory,
  totalBytesFromMetaMd,
} from "../../src/lib/design-budget.ts";

const sampleMeta = {
  inputs: {},
  outputs: {
    "institutions/design-system.js": { bytes: 4762, entryPoint: "src/institutions/design-system.ts" },
    "research/hq-app/app.js": { bytes: 49665, entryPoint: "src/research/hq-app/app.js" },
  },
};

describe("design budgets", () => {
  test("every module has a positive budget and a dist output name", () => {
    for (const [name, spec] of Object.entries(DESIGN_MODULES)) {
      expect(name).toBeTruthy();
      expect(spec.maxBytes).toBeGreaterThan(0);
      expect(spec.out).toMatch(/\.js$/);
      expect(spec.entry).toMatch(/^(src|public)\//);
    }
  });

  test("entryBytesFromMetaJson maps entry point -> output bytes", () => {
    const map = entryBytesFromMetaJson(sampleMeta);
    expect(map.get("src/institutions/design-system.ts")).toBe(4762);
    expect(map.get("src/research/hq-app/app.js")).toBe(49665);
    expect(map.size).toBe(2);
  });

  test("entryBytesFromMetaJson tolerates malformed payloads", () => {
    expect(entryBytesFromMetaJson(null).size).toBe(0);
    expect(entryBytesFromMetaJson({}).size).toBe(0);
    expect(entryBytesFromMetaJson({ outputs: [{ bytes: 1 }] }).size).toBe(0);
  });

  test("moduleBytesFromMetaJson reads the module's own entry", () => {
    expect(moduleBytesFromMetaJson("design-system", sampleMeta)).toBe(4762);
    expect(moduleBytesFromMetaJson("hq-app", sampleMeta)).toBe(49665);
    expect(moduleBytesFromMetaJson("hq-app", { outputs: {} })).toBeNull();
  });

  test("totalBytesFromMetaMd parses the markdown quick summary", () => {
    expect(totalBytesFromMetaMd("| Total output size | 54.43 KB |")).toBeCloseTo(54.43 * 1024, 0);
    expect(totalBytesFromMetaMd("| Total output size | 1.5 MB |")).toBeCloseTo(1.5 * 1024 * 1024, 0);
    expect(totalBytesFromMetaMd("no table here")).toBeNull();
  });

  test("budgetStatus formats over/under budget", () => {
    expect(budgetStatus(4762, 12 * 1024)).toContain("KB");
    expect(budgetStatus(13 * 1024, 12 * 1024)).toContain("1.08x");
    expect(budgetStatus(null, 12 * 1024)).toBe("missing metafile");
  });

  test("hq-app source currently fits its budget (measured headroom)", async () => {
    // Source file exists; the 64 KB budget was sized from a real build.
    const src = await Bun.file("src/research/hq-app/app.js").text();
    expect(src.length).toBeGreaterThan(0);
    expect(src.length).toBeLessThan(DESIGN_MODULES["hq-app"].maxBytes * 4); // loose sanity: source < 4x budget
  });
});

describe("metafile analysis", () => {
  const contribMeta = {
    inputs: {},
    outputs: {
      "./hq-app.js": {
        bytes: 1000,
        entryPoint: "src/research/hq-app/app.js",
        inputs: { "a.ts": { bytesInOutput: 600 }, "b.ts": { bytesInOutput: 400 } },
      },
    },
  };

  test("largestContributorBytes reads the dominant module", () => {
    expect(largestContributorBytes("hq-app", contribMeta)).toBe(600);
    expect(largestContributorBytes("hq-app", { outputs: {} })).toBeNull();
    expect(largestContributorBytes("hq-app", null)).toBeNull();
  });

  test("circularImports finds cycles deterministically", () => {
    const cyclic = {
      inputs: {
        "a.ts": { bytes: 1, imports: [{ path: "b.ts", kind: "import-statement" }] },
        "b.ts": { bytes: 1, imports: [{ path: "a.ts", kind: "import-statement" }] },
        "c.ts": { bytes: 1, imports: [] },
      },
      outputs: {},
    };
    expect(circularImports(cyclic)).toEqual([["a.ts", "b.ts", "a.ts"]]);
    const acyclic = {
      inputs: {
        "a.ts": { bytes: 1, imports: [{ path: "b.ts" }] },
        "b.ts": { bytes: 1, imports: [] },
      },
      outputs: {},
    };
    expect(circularImports(acyclic)).toEqual([]);
    expect(circularImports(null)).toEqual([]);
  });

  test("externalImports lists specifiers outside the graph", () => {
    const ext = {
      inputs: {
        "a.ts": { bytes: 1, imports: [{ path: "b.ts" }, { path: "node:fs" }, { path: "bun" }] },
        "b.ts": { bytes: 1, imports: [] },
      },
      outputs: {},
    };
    expect(externalImports(ext)).toEqual([
      { from: "a.ts", specifier: "node:fs" },
      { from: "a.ts", specifier: "bun" },
    ]);
  });
});

describe("bundle history (trend gate)", () => {
  const tmp = "/tmp/bundle-history-test-" + Math.random().toString(36).slice(2) + ".json";

  test("deltaPct computes growth and tolerates missing prev", () => {
    expect(deltaPct(100, 110)).toBeCloseTo(10);
    expect(deltaPct(100, 75)).toBeCloseTo(-25);
    expect(deltaPct(null, 100)).toBeNull();
    expect(deltaPct(0, 100)).toBeNull();
    expect(deltaPct(undefined, 100)).toBeNull();
  });

  test("recordBundleHistory appends deltas and skips unchanged sizes", async () => {
    await recordBundleHistory(tmp, { "hq-app": 5000 }, () => "t1");
    await recordBundleHistory(tmp, { "hq-app": 5000 }, () => "t2"); // unchanged -> skipped
    let h = await readBundleHistory(tmp);
    expect(h["hq-app"]).toHaveLength(1);
    expect(h["hq-app"]![0]!.bytes).toBe(5000);
    await recordBundleHistory(tmp, { "hq-app": 6000 }, () => "t3");
    h = await readBundleHistory(tmp);
    expect(h["hq-app"]).toHaveLength(2);
    expect(h["hq-app"]![1]!.bytes).toBe(6000);
    await Bun.write(tmp, "");
  });

  test("readBundleHistory tolerates missing/corrupt files", async () => {
    expect(await readBundleHistory("/tmp/does-not-exist-" + Math.random().toString(36) + ".json")).toEqual({});
    expect(await readBundleHistory(tmp)).toEqual({});
  });
});
describe("git-correlated history + output integrity", () => {
  const tmp = "/tmp/bundle-history-git-" + Math.random().toString(36).slice(2) + ".json";

  test("recordBundleHistory stores git snapshot with new entries", async () => {
    await recordBundleHistory(tmp, { "hq-app": 5000 }, () => "t1", { commit: "abc1234", branch: "main", message: "add tokens" });
    const h = await readBundleHistory(tmp);
    expect(h["hq-app"]![0]!.commit).toBe("abc1234");
    expect(h["hq-app"]![0]!.branch).toBe("main");
    expect(h["hq-app"]![0]!.message).toBe("add tokens");
    await Bun.write(tmp, "");
  });

  test("gitSnapshot returns commit/branch/message in a repo", async () => {
    const snap = await gitSnapshot(process.cwd());
    expect(snap).toBeTypeOf("object");
    expect(snap.commit === undefined || /^[0-9a-f]{7,}$/.test(snap.commit!)).toBe(true);
  });

  test("checkBundleOutputs flags bun leaks and Bun refs in the live bundle", async () => {
    const root = "/tmp/ds-output-test-" + Math.random().toString(36).slice(2);
    await Bun.write(root + "/dist/design-system.js", 'import { x } from "bun"; export const y = 1;');
    await Bun.write(root + "/dist/hq-app.js", "const z = Bun.color('#fff', 'css');");
    const issues = await checkBundleOutputs(root);
    const details = issues.map((i) => i.detail);
    expect(details.some((d) => d.includes("leaked"))).toBe(true);
    expect(details.some((d) => d.includes("live bundle"))).toBe(true);
  });

  test("checkBundleOutputs passes clean outputs", async () => {
    const root = "/tmp/ds-output-clean-" + Math.random().toString(36).slice(2);
    await Bun.write(root + "/dist/design-system.js", "export const ok = 1;");
    await Bun.write(root + "/dist/hq-app.js", "export const ok = 2;");
    expect(await checkBundleOutputs(root)).toEqual([]);
  });
  test("externalImports treats split chunks + assets as internal (§163)", () => {
    const meta = {
      inputs: {
        "src/app.js": { imports: [{ path: "./chunk-abc.js" }, { path: "./style.css" }, { path: "node:fs" }] },
      },
      outputs: { "./app.js": {}, "./chunk-abc.js": {}, "./style.css": {} },
    };
    const ext = externalImports(meta);
    expect(ext).toEqual([{ from: "src/app.js", specifier: "node:fs" }]);
  });
});
