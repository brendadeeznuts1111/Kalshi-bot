import { readFileSync, writeFileSync } from "fs";

const path = "/Users/nolarose/kimi-toolchain/src/lib/test-gates.ts";
let text = readFileSync(path, "utf-8");

// 1. Add to UNIT_TEST_FILES after tool-registry
const unitInsertAfter = `  "test/tool-registry.unit.test.ts",`;
if (text.includes(unitInsertAfter) && !text.includes("test/subagent-orchestrator.unit.test.ts")) {
  text = text.replace(
    unitInsertAfter,
    `${unitInsertAfter}\n  "test/subagent-orchestrator.unit.test.ts",`
  );
} else {
  console.error("Could not find insertion point or file already exists");
  process.exit(1);
}

// 2. Add to TEST_GROUPS tool group
const toolGroupInsertAfter = `    "test/unified-shell-bridge.unit.test.ts",`;
if (text.includes(toolGroupInsertAfter)) {
  text = text.replace(
    toolGroupInsertAfter,
    `${toolGroupInsertAfter}\n    "test/subagent-orchestrator.unit.test.ts",`
  );
} else {
  console.error("Could not find TEST_GROUPS tool insertion point");
  process.exit(1);
}

writeFileSync(path, text);
console.log("Updated test-gates.ts successfully");
