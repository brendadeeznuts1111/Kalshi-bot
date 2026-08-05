#!/usr/bin/env bun
/**
 * Kalshi Telegram Bot — long-polling command handler.
 * Run: bun src/telegram/bot.ts
 *
 * Commands:
 *   /start      — welcome + available commands
 *   /status     — current program metrics from latest dashboard
 *   /dashboard  — send latest calibration chart image
 *   /subscribe  — add chat to weekly digest list
 *   /unsubscribe— remove chat from digest list
 *   /help       — command reference
 */
import { getUpdates, sendMessage, sendPhoto } from "./api.ts";
import { addSubscriber, removeSubscriber, listSubscribers } from "./subscribers.ts";
import { joinPath } from "../research/paths.ts";
import { getChatMemberCount, getChatAdministrators } from "./api.ts";

const DASHBOARD_DIR = joinPath(import.meta.dir, "../../research/calibration-dashboard");
const DASHBOARD_DATA = joinPath(DASHBOARD_DIR, "dashboard-data.json");
const CALIBRATION_CHART = joinPath(DASHBOARD_DIR, "tennis-game-model-calibration.png");
const COMPARISON_CHART = joinPath(DASHBOARD_DIR, "program-comparison.png");

async function loadDashboard() {
  const file = Bun.file(DASHBOARD_DATA);
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as { programs: Array<Record<string, unknown>>; generatedAt: string };
  } catch {
    return null;
  }
}

function fmtStatusLine(label: string, value: unknown): string {
  const v = value === null || value === undefined ? "—" : String(value);
  return `${label.padEnd(18)} ${v}`;
}

async function handleCommand(chatId: number, text: string, username?: string, firstName?: string) {
  const cmd = text.trim().toLowerCase();

  if (cmd === "/start") {
    await sendMessage(chatId,
      `🎯 Kalshi Bot Research Agent\n\n` +
      `Commands:\n` +
      `/status     — program metrics\n` +
      `/dashboard  — calibration charts\n` +
      `/members    — channel member count & admins\n` +
      `/subscribe  — weekly digest\n` +
      `/unsubscribe— stop digest\n` +
      `/help       — this help`,
    );
    return;
  }

  if (cmd === "/help") {
    await sendMessage(chatId,
      `*Kalshi Bot Commands*\n\n` +
      `*/status* — live program metrics from shadow logs\n` +
      `*/dashboard* — latest seaborn calibration charts\n` +
      `*/subscribe* — add this chat to weekly Sunday digest\n` +
      `*/unsubscribe* — remove from digest\n\n` +
      `Dashboard refreshes every Sunday at 07:17 UTC.`,
      { parseMode: "Markdown" },
    );
    return;
  }

  if (cmd === "/subscribe") {
    const added = await addSubscriber({
      chatId,
      username,
      firstName,
      subscribedAt: new Date().toISOString(),
    });
    await sendMessage(chatId, added ? "✅ Subscribed to weekly calibration digest." : "ℹ️ Already subscribed.");
    return;
  }

  if (cmd === "/unsubscribe") {
    const removed = await removeSubscriber(chatId);
    await sendMessage(chatId, removed ? "✅ Unsubscribed from digest." : "ℹ️ Not currently subscribed.");
    return;
  }

  if (cmd === "/status") {
    const dashboard = await loadDashboard();
    if (!dashboard) {
      await sendMessage(chatId, "❌ No dashboard data found. Run `bun run dashboard:generate` first.");
      return;
    }
    const lines: string[] = [`*Calibration Status*  _${dashboard.generatedAt}_\n`];
    for (const prog of dashboard.programs) {
      const p = prog as Record<string, unknown>;
      const brier = p.brier === null ? "—" : (p.brier as number).toFixed(4);
      const edge = p.meanEdgeCents === null ? "—" : `${(p.meanEdgeCents as number).toFixed(2)}c`;
      lines.push(`\n*${p.name}*  (${p.role})`);
      lines.push(fmtStatusLine("  signals", `${p.totalSignals}`));
      lines.push(fmtStatusLine("  trades/skips", `${p.trades} / ${p.skips}`));
      lines.push(fmtStatusLine("  resolved", `${p.resolved}`));
      lines.push(fmtStatusLine("  Brier", brier));
      lines.push(fmtStatusLine("  mean edge", edge));
    }
    await sendMessage(chatId, lines.join("\n"), { parseMode: "Markdown" });
    return;
  }

  if (cmd === "/dashboard") {
    const dashboard = await loadDashboard();
    if (!dashboard) {
      await sendMessage(chatId, "❌ No dashboard data. Run `bun run dashboard:generate` first.");
      return;
    }
    const file = Bun.file(CALIBRATION_CHART);
    if (await file.exists()) {
      await sendPhoto(chatId, CALIBRATION_CHART, `Calibration: ${dashboard.generatedAt}`);
    } else {
      await sendMessage(chatId, "❌ Chart not generated yet.");
    }
    return;
  }

  if (cmd === "/members") {
    try {
      const count = await getChatMemberCount(chatId);
      const admins = await getChatAdministrators(chatId);
      const lines: string[] = [`👥 <b>${count} members</b>\n`];
      lines.push("<b>Admins:</b>");
      for (const a of admins) {
        const tag = a.user.username ? `@${a.user.username}` : a.user.first_name;
        lines.push(`  ${Bun.escapeHTML(tag)}`);
      }
      lines.push("", "<i>Telegram bots cannot list non-admin members (API limitation).</i>");
      await sendMessage(chatId, lines.join("\n"), { parseMode: "HTML" });
    } catch {
      await sendMessage(chatId, "❌ Could not read member info — bot needs admin rights.");
    }
    return;
  }

  // Unknown command — silent
}

async function pollLoop() {
  console.log("🤖 Kalshi Telegram Bot started — long-polling");
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const updates = await getUpdates(offset);
      for (const u of updates) {
        offset = u.update_id + 1;
        const msg = u.message;
        if (!msg || !msg.text) continue;
        if (!msg.text.startsWith("/")) continue;
        await handleCommand(
          msg.chat.id,
          msg.text,
          msg.chat.username,
          msg.chat.first_name,
        );
      }
    } catch (err) {
      console.error("Poll error:", err);
      await Bun.sleep(5000);
    }
    await Bun.sleep(1000);
  }
}

if (import.meta.main) {
  // Graceful shutdown — exit cleanly on SIGTERM/SIGHUP/SIGINT.
  for (const sig of ["SIGHUP", "SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      console.error(`[telegram-bot] received ${sig}, shutting down`);
      process.exit(0);
    });
  }
  await pollLoop();
}
