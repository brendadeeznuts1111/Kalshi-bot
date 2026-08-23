import { $ } from "bun";
import type { DemoProofInput, DemoProofScenario } from "./demo-proof.ts";

export interface DemoScenarioRun {
  runner: "bun-test-production-services-v1";
  scenarios: DemoProofInput["scenarios"];
  evidenceSha256: string;
}

interface ScenarioSpec {
  file: string;
  pattern: string;
}

const SCENARIO_SPECS: Record<DemoProofScenario, ScenarioSpec[]> = {
  duplicate_requests: [{
    file: "tests/partner/execution/executor.test.ts",
    pattern: "reserves, places, confirms, queues a receipt, and replays without a second call",
  }],
  crash_after_dispatch: [
    {
      file: "tests/partner/execution/maintenance.test.ts",
      pattern: "recovers only stale placing rows while preserving exposure and provenance",
    },
    {
      file: "tests/partner/execution/reservation.test.ts",
      pattern: "confirms an exact deterministic client-order match",
    },
  ],
  timeout_unknown: [{
    file: "tests/partner/execution/reservation.test.ts",
    pattern: "keeps exposure unknown when the provider has no conclusive match",
  }],
  partial_fill: [{
    file: "tests/partner/execution/execution-journal.test.ts",
    pattern: "partial fills, fees, cancellation, and settlement project once",
  }],
  cancellation: [{
    file: "tests/partner/execution/cancel.test.ts",
    pattern: "provider lifecycle releases only cancelled working quantity after partial fill",
  }],
  telegram_outage: [{
    file: "tests/telegram/authorization-outbox-worker.test.ts",
    pattern: "retries transport failures and delivers topic-bound receipts",
  }],
};

export type DemoScenarioSpecRunner = (spec: ScenarioSpec) => Promise<{
  exitCode: number;
  outputSha256: string;
}>;

/** Run real in-memory service tests with mocked provider/Telegram boundaries. */
export async function runDeterministicDemoScenarios(
  runSpec: DemoScenarioSpecRunner = runBunTestSpec,
): Promise<DemoScenarioRun> {
  const scenarios = {} as DemoProofInput["scenarios"];
  for (const [id, specs] of Object.entries(SCENARIO_SPECS) as Array<[DemoProofScenario, ScenarioSpec[]]>) {
    const results = [];
    for (const spec of specs) results.push(await runSpec(spec));
    const passed = results.every((result) => result.exitCode === 0);
    scenarios[id] = {
      exercised: true,
      passed,
      evidence: `bun-test-production-services-v1:${id}:${digest({ specs, results })}`,
    };
  }
  return {
    runner: "bun-test-production-services-v1",
    scenarios,
    evidenceSha256: digest(scenarios),
  };
}

async function runBunTestSpec(spec: ScenarioSpec) {
  const { stdout, stderr, exitCode } = await $`${process.execPath} test ${spec.file} --test-name-pattern ${spec.pattern}`.env({ ...process.env, KALSHI_ENV: "demo", KALSHI_PROD_ARMED: undefined }).nothrow().quiet();
  return { exitCode, outputSha256: digest({ stdout: stdout.toString(), stderr: stderr.toString() }) };
}

function digest(value: unknown): string {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
