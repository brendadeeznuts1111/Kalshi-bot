// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { joinPath } from "../src/research/paths.ts";

const SMOKE_DIR = joinPath(import.meta.dir, "..", "alpha", "_template-smoke");

describe("alpha-program template", () => {
  beforeAll(async () => {
    await Bun.$`rm -rf ${SMOKE_DIR}`.quiet();
    await Bun.$`bun create alpha-program ${SMOKE_DIR} --no-git`.cwd(joinPath(import.meta.dir, "..")).quiet();
  });

  afterAll(async () => {
    await Bun.$`rm -rf ${SMOKE_DIR}`.quiet();
  });

  test("scaffolds manifest with gates and hypothesis", async () => {
    expect(await Bun.file(joinPath(SMOKE_DIR, "program.json")).exists()).toBe(true);
    const manifest = (await Bun.file(joinPath(SMOKE_DIR, "program.json")).json()) as {
      name: string;
      gates: { shadowMinSignals: number; killBrierDriftPct: number; graduationMinRealizedEdgeCentsPerFill: number; graduationMinFills: number; graduationMinDistinctEvents: number };
    };
    expect(manifest.gates.shadowMinSignals).toBe(100);
    expect(manifest.gates.killBrierDriftPct).toBe(15);
    expect(manifest.gates.graduationMinRealizedEdgeCentsPerFill).toBe(2);
    expect(manifest.gates.graduationMinFills).toBe(30);
    expect(manifest.gates.graduationMinDistinctEvents).toBe(40);
    expect(await Bun.file(joinPath(SMOKE_DIR, "hypothesis.md")).exists()).toBe(true);
    const pkg = (await Bun.file(joinPath(SMOKE_DIR, "package.json")).json()) as { name: string };
    expect(pkg.name).toBe("_template-smoke");
  });

  test("fee tests pass in scaffolded program", async () => {
    const result = await Bun.$`bun test src/signal.test.ts`.cwd(SMOKE_DIR).quiet();
    expect(result.exitCode).toBe(0);
  });
});
