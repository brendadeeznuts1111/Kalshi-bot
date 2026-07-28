import { readFileSync, writeFileSync, unlinkSync, renameSync } from "fs";

// 1. Append cron-loop tests to existing test/bun-cron.unit.test.ts
const bunCronPath = "/Users/nolarose/kimi-toolchain/test/bun-cron.unit.test.ts";
let bunCronText = readFileSync(bunCronPath, "utf-8");

// Remove the final `});` and append new tests + closing
const closing = "});";
if (!bunCronText.trimEnd().endsWith(closing)) {
  console.error("Unexpected end of bun-cron.unit.test.ts");
  process.exit(1);
}

bunCronText = bunCronText.trimEnd().slice(0, -closing.length).trimEnd();

const newTests = `

  test("startIntervalLoop fires ticks immediately then repeats", async () => {
    let ticks = 0;
    const controller = startIntervalLoop(50, () => {
      ticks++;
      if (ticks >= 3) controller.abort();
    });
    await Bun.sleep(300);
    expect(ticks).toBeGreaterThanOrEqual(3);
  });

  test("startCronLoop falls back to interval and fires ticks", async () => {
    const originalCron = (Bun as Record<string, unknown>).cron;
    try {
      (Bun as Record<string, unknown>).cron = undefined;
      let ticks = 0;
      const controller = startCronLoop("* * * * *", 50, () => {
        ticks++;
        if (ticks >= 3) controller.abort();
      });
      await Bun.sleep(300);
      expect(ticks).toBeGreaterThanOrEqual(3);
    } finally {
      (Bun as Record<string, unknown>).cron = originalCron;
    }
  });

  test("startCronLoop returns an AbortController when Bun.cron is available", () => {
    const controller = startCronLoop("* * * * *", 50, () => {});
    expect(controller).toBeInstanceOf(AbortController);
    controller.abort();
  });

  test("abort stops an interval loop", async () => {
    let ticks = 0;
    const controller = startIntervalLoop(10, () => {
      ticks++;
    });
    await Bun.sleep(50);
    controller.abort();
    const frozen = ticks;
    await Bun.sleep(100);
    expect(ticks).toBe(frozen);
  });
});
`;

// Add import if not present
if (!bunCronText.includes("startCronLoop") && !bunCronText.includes("startIntervalLoop")) {
  // Insert import after the existing import line
  const importLine = `import { describe, expect, test } from "bun:test";`;
  bunCronText = bunCronText.replace(
    importLine,
    `${importLine}\nimport { startCronLoop, startIntervalLoop } from "../src/lib/bun-utils.ts";`
  );
}

writeFileSync(bunCronPath, bunCronText + newTests);
console.log("Appended cron-loop tests to test/bun-cron.unit.test.ts");

// 2. Delete the standalone bun-cron-loop test file
unlinkSync("/Users/nolarose/kimi-toolchain/test/bun-cron-loop.unit.test.ts");
console.log("Deleted test/bun-cron-loop.unit.test.ts");

// 3. Rename subagent-flow test to subagent-orchestrator
const subagentFlowPath = "/Users/nolarose/kimi-toolchain/test/subagent-flow.unit.test.ts";
const subagentOrchestratorPath = "/Users/nolarose/kimi-toolchain/test/subagent-orchestrator.unit.test.ts";
let subagentText = readFileSync(subagentFlowPath, "utf-8");

// Update describe block
subagentText = subagentText.replace(
  'describe("subagent flows", () => {',
  'describe("subagent-orchestrator", () => {'
);

writeFileSync(subagentOrchestratorPath, subagentText);
unlinkSync(subagentFlowPath);
console.log("Renamed test/subagent-flow.unit.test.ts -> test/subagent-orchestrator.unit.test.ts");
