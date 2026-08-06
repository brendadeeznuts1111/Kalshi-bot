import { describe, expect, test } from "bun:test";
import { DEMO_PROOF_SCENARIOS } from "../../../src/partner/execution/demo-proof.ts";
import { runDeterministicDemoScenarios } from "../../../src/partner/execution/demo-scenario-runner.ts";

describe("deterministic demo scenario runner", () => {
  test("orchestrates the production-service specs for all six scenarios", async () => {
    const calls: string[] = [];
    const runSpec = async (spec: { file: string; pattern: string }) => {
      calls.push(`${spec.file}:${spec.pattern}`);
      return { exitCode: 0, outputSha256: "a".repeat(64) };
    };
    const first = await runDeterministicDemoScenarios(runSpec);
    const second = await runDeterministicDemoScenarios(runSpec);
    expect(first).toEqual(second);
    expect(Object.keys(first.scenarios).sort()).toEqual([...DEMO_PROOF_SCENARIOS].sort());
    expect(Object.values(first.scenarios).every((scenario) => scenario.exercised && scenario.passed)).toBeTrue();
    expect(first.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.runner).toBe("bun-test-production-services-v1");
    expect(calls).toHaveLength(14);
  });

  test("fails only the scenario whose production-service spec fails", async () => {
    const result = await runDeterministicDemoScenarios(async (spec) => ({
      exitCode: spec.file.endsWith("cancel.test.ts") ? 1 : 0,
      outputSha256: "b".repeat(64),
    }));
    expect(result.scenarios.cancellation.passed).toBeFalse();
    expect(result.scenarios.partial_fill.passed).toBeTrue();
  });
});
