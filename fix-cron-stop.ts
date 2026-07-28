import { readFileSync, writeFileSync } from "fs";

const path = "/Users/nolarose/kimi-toolchain/src/lib/bun-utils.ts";
let text = readFileSync(path, "utf-8");

// Replace the type assertion and abort handler for Bun.cron
const oldBlock = `    const cron = (
      Bun as unknown as { cron: (expr: string, cb: () => void) => { dispose: () => void } }
    ).cron(cronExpr, async () => {
      if (controller.signal.aborted) return;
      try {
        await tick();
      } catch {
        // Cron errors are surfaced via unhandledRejection — no crash
      }
      // Signal may have fired during tick — cron.dispose() won't cancel in-flight ticks
      if (controller.signal.aborted) return;
    });
    controller.signal.addEventListener("abort", () => cron.dispose(), { once: true });`;

const newBlock = `    const cron = (
      Bun as unknown as { cron: (expr: string, cb: () => void) => { stop: () => void } }
    ).cron(cronExpr, async () => {
      if (controller.signal.aborted) return;
      try {
        await tick();
      } catch {
        // Cron errors are surfaced via unhandledRejection — no crash
      }
      // Signal may have fired during tick — cron.stop() won't cancel in-flight ticks
      if (controller.signal.aborted) return;
    });
    controller.signal.addEventListener("abort", () => cron.stop(), { once: true });`;

if (text.includes(oldBlock)) {
  text = text.replace(oldBlock, newBlock);
} else {
  console.error("Could not find old cron block");
  process.exit(1);
}

writeFileSync(path, text);
console.log("Updated bun-utils.ts cron stop handler");
