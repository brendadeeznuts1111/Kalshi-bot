// @see https://bun.com/docs/runtime/cron#the-scheduled-handler
/**
 * OS-level cron worker — tennis watch-set orderbook WebSocket recorder.
 * Persists session artifacts via tennis-ws-recorder-store (inside recorder path).
 *
 * Register: bun run tennis:record:ws:register
 * Manual:   bun run tennis:record -- --ws --ws-seconds=300
 */
import { runTennisRecordCli } from "./record-cli.ts";
import { resolveWsRecorderWsSeconds } from "./ws-recorder-schedule-cli.ts";

process.on("unhandledRejection", (err) => {
  console.error("[tennis-ws-recorder] unhandled rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("[tennis-ws-recorder] uncaught exception:", err);
});

/**
 * OS cron (launchd) runs without the user's shell profile, so KALSHI_API_KEY_ID
 * / KALSHI_PRIVATE_KEY_PATH from ~/.config/shell/kalshi.sh are absent there.
 * Fall back to that file when the env is missing (values are never logged).
 */
async function ensureKalshiCronEnv(): Promise<void> {
  if (Bun.env.KALSHI_API_KEY_ID?.trim() && Bun.env.KALSHI_PRIVATE_KEY_PATH?.trim()) return;
  const path = `${Bun.env.HOME}/.config/shell/kalshi.sh`;
  const file = Bun.file(path);
  if (!(await file.exists())) return;
  const text = await file.text();
  for (const m of text.matchAll(/^export\s+(\w+)=(.*)$/gm)) {
    const key = m[1]!;
    if (process.env[key] === undefined || process.env[key] === '') {
      const raw = m[2]!.trim().replace(/^["']|["']$/g, '');
      // Shell expands $HOME at source time; env consumers read the value verbatim.
      process.env[key] = raw.replace(/^\$HOME(?=\/)/, Bun.env.HOME ?? '~');
    }
  }
}

export default {
  async scheduled(controller: Bun.CronController) {
    const when = new Date(controller.scheduledTime).toISOString();
    const wsSeconds = resolveWsRecorderWsSeconds();
    await ensureKalshiCronEnv();
    console.error(
      `[tennis-ws-recorder] fire ${controller.cron} @ ${when} ws-seconds=${wsSeconds}`,
    );

    const code = await runTennisRecordCli(["--ws", `--ws-seconds=${wsSeconds}`]);
    if (code !== 0) {
      console.error(`[tennis-ws-recorder] exit ${code}`);
      // Re-throw so Bun.cron records a failed fire in OS logs.
      throw new Error(`tennis ws recorder failed with exit ${code}`);
    }
  },
};
