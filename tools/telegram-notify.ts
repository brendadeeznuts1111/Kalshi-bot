#!/usr/bin/env bun
/**
 * Telegram notification sender — broadcasts dashboard to all subscribers.
 * Used by Automation after calibration-dashboard.py runs.
 * Run: bun tools/telegram-notify.ts
 */
import { sendMessage, sendPhoto } from "../src/telegram/api.ts";
import { listSubscribers } from "../src/telegram/subscribers.ts";
import { joinPath } from "../src/research/paths.ts";

const DASHBOARD_DIR = joinPath(import.meta.dir, "../research/calibration-dashboard");
const DASHBOARD_DATA = joinPath(DASHBOARD_DIR, "dashboard-data.json");
const CALIBRATION_CHART = joinPath(DASHBOARD_DIR, "tennis-game-model-calibration.png");
const COMPARISON_CHART = joinPath(DASHBOARD_DIR, "program-comparison.png");

async function main() {
  const subs = await listSubscribers();
  if (subs.length === 0) {
    console.log("No subscribers — nothing to send.");
    return;
  }

  const file = Bun.file(DASHBOARD_DATA);
  if (!(await file.exists())) {
    console.error("Dashboard data not found:", DASHBOARD_DATA);
    return;
  }

  const dashboard = (await file.json()) as { programs: Array<Record<string, unknown>>; generatedAt: string };

  // Build summary message
  const lines: string[] = [`📊 *Kalshi Calibration Dashboard*\n_${dashboard.generatedAt}_\n`];
  for (const prog of dashboard.programs) {
    const p = prog as Record<string, unknown>;
    if ((p.totalSignals as number) === 0) continue; // skip empty programs
    const brier = p.brier === null ? "—" : (p.brier as number).toFixed(4);
    const edge = p.meanEdgeCents === null ? "—" : `${(p.meanEdgeCents as number).toFixed(2)}c`;
    lines.push(`*${p.name}* (${p.role})`);
    lines.push(`  signals: ${p.totalSignals} | trades: ${p.trades} | resolved: ${p.resolved}`);
    lines.push(`  Brier: ${brier} | edge: ${edge}\n`);
  }
  const summary = lines.join("\n");

  // Send to all subscribers
  let sent = 0;
  for (const sub of subs) {
    try {
      await sendMessage(sub.chatId, summary, { parseMode: "Markdown" });
      const chartFile = Bun.file(CALIBRATION_CHART);
      if (await chartFile.exists()) {
        await sendPhoto(sub.chatId, CALIBRATION_CHART, "Calibration chart");
      }
      sent++;
    } catch (err) {
      console.error(`Failed to notify ${sub.chatId}:`, err);
    }
  }
  console.log(`Sent to ${sent}/${subs.length} subscribers.`);
}

if (import.meta.main) {
  await main();
}
