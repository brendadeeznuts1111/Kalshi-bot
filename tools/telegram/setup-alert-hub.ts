#!/usr/bin/env bun
/**
 * Configure Telegram chat for alert hub — profile, topics, commands.
 *
 * Run once:
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_ALERT_CHAT_ID=-100123 bun tools/telegram/setup-alert-hub.ts
 *
 * @see https://core.telegram.org/bots/api
 */
import {
  createForumTopic,
  getChatAdministrators,
  getChatMemberCount,
  getMe,
  setChatDescription,
  setChatPhoto,
  setMyCommands,
  setMyDescription,
  setMyName,
} from "../../src/telegram/api.ts";

const chatIdRaw = Bun.env.TELEGRAM_ALERT_CHAT_ID;
const chatId = chatIdRaw ? Number(chatIdRaw) : 0;
if (!chatId) {
  console.error("❌ TELEGRAM_ALERT_CHAT_ID not set — run:");
  console.error("   TELEGRAM_BOT_TOKEN=... TELEGRAM_ALERT_CHAT_ID=-100123 bun tools/telegram/setup-alert-hub.ts");
  process.exit(1);
}

// ── 1. Bot identity ─────────────────────────────────────────────

const me = await getMe();
console.log(`Bot: @${me.username} (${me.first_name}, id=${me.id})`);

await setMyName("Kalshi Alert Hub");
await setMyDescription(
  "Real-time alerts for Kalshi-bot price logger pipeline.\n" +
  "Monitors: feed health, Poly matching, volume gaps, cross-venue divergence.",
);

console.log("✅ Bot name + description set");

// ── 2. Chat profile ────────────────────────────────────────────

await setChatDescription(chatId,
  "📊 Kalshi Alert Hub\n" +
  "Live pipeline monitoring — feed staleness, Poly matching drops, volume gaps, price divergence.\n" +
  "Alerts are debounced (5 min) and auto-resolve when conditions clear.",
);

// Uncomment after adding an icon image:
// await setChatPhoto(chatId, "./tools/telegram/alert-hub-icon.png");

console.log("✅ Chat description set");

// ── 3. Forum topics (if using a forum supergroup) ──────────────

const createTopics = Bun.env.TELEGRAM_SETUP_TOPICS === "1";
if (createTopics) {
  const critThread = await createForumTopic(chatId, "🔴 Critical", 0xE74C3C);
  const warnThread = await createForumTopic(chatId, "🟡 Warnings", 0xF39C12);
  const infoThread = await createForumTopic(chatId, "🔵 Info", 0x3498DB);

  console.log("✅ Forum topics created:");
  console.log(`   CRITICAL  → thread_id=${critThread}  (set TELEGRAM_ALERT_THREAD_ID=${critThread})`);
  console.log(`   WARNING   → thread_id=${warnThread}`);
  console.log(`   INFO      → thread_id=${infoThread}`);
}

// ── 4. Bot commands ─────────────────────────────────────────────

await setMyCommands(chatId, [
  { command: "status", description: "Current pipeline health snapshot" },
  { command: "alerts", description: "Recent alert activity" },
  { command: "members", description: "Channel member count and admins" },
  { command: "dash", description: "Link to ops dashboard" },
]);

console.log("✅ Bot commands registered");
console.log("");

// ── 5. Member stats ────────────────────────────────────────────

try {
  const count = await getChatMemberCount(chatId);
  const admins = await getChatAdministrators(chatId);
  console.log(`👥 Members: ${count}`);
  console.log(`👑 Admins (${admins.length}):`);
  for (const a of admins) {
    const tag = a.user.username ? `@${a.user.username}` : a.user.first_name;
    console.log(`   ${tag} (id=${a.user.id})`);
  }
} catch (err) {
  console.log("   (bot lacks admin rights to read members)");
}

console.log("");
console.log("🎯 Alert hub configured. Add to .env:");
console.log("   TELEGRAM_ALERT_CHAT_ID=" + chatId);
if (createTopics) console.log("   TELEGRAM_ALERT_THREAD_ID=<critical-thread-id>");
