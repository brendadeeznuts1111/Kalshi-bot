import { readFileSync, writeFileSync } from "fs";

const path = "/Users/nolarose/kimi-toolchain/src/lib/bun-utils.ts";
let text = readFileSync(path, "utf-8");

// Remove the module-level BUN_CRON_READY constant
const oldConst = `const BUN_CRON_READY = typeof (Bun as Record<string, unknown>).cron === "function";\n`;
if (text.includes(oldConst)) {
  text = text.replace(oldConst, "");
} else {
  console.error("Could not find BUN_CRON_READY constant");
  process.exit(1);
}

// Fix JSDoc: 6-field -> 5-field and example
const oldDoc = `@param cronExpr 6-field cron expression (e.g. \`"* * * * * *"\` for every second)`;
const newDoc = `@param cronExpr 5-field cron expression (e.g. \`"* * * * *"\` for every minute)`;
if (text.includes(oldDoc)) {
  text = text.replace(oldDoc, newDoc);
} else {
  console.error("Could not find old JSDoc");
  process.exit(1);
}

// Replace BUN_CRON_READY with local bunCronReady inside startCronLoop
const oldCheck = `  if (BUN_CRON_READY) {`;
const newCheck = `  const bunCronReady = typeof (Bun as Record<string, unknown>).cron === "function";\n  if (bunCronReady) {`;
if (text.includes(oldCheck)) {
  text = text.replace(oldCheck, newCheck);
} else {
  console.error("Could not find BUN_CRON_READY usage");
  process.exit(1);
}

writeFileSync(path, text);
console.log("Updated bun-utils.ts successfully");
