/**
 * Soft Telegram notify for inventory plane (events / promote).
 * Requires TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (or TELEGRAM_GROUP_ID).
 * Failures are non-fatal.
 */
// @see https://core.telegram.org/bots/api#sendmessage

export type InventoryNotifyResult = 'sent' | 'skipped_no_env' | 'skipped_empty' | 'error';

export function inventoryTelegramConfigured(): boolean {
  const token = Bun.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId =
    Bun.env.TELEGRAM_CHAT_ID?.trim() || Bun.env.TELEGRAM_GROUP_ID?.trim();
  return Boolean(token && chatId);
}

/**
 * Send a short inventory alert. Never throws.
 */
export async function maybeNotifyInventoryTelegram(input: {
  title: string;
  lines: string[];
  maxLines?: number;
}): Promise<InventoryNotifyResult> {
  if (!inventoryTelegramConfigured()) return 'skipped_no_env';
  if (input.lines.length === 0) return 'skipped_empty';

  const max = Math.min(Math.max(input.maxLines ?? 12, 1), 40);
  const text = [input.title, ...input.lines.slice(0, max)].join('\n').slice(0, 3500);

  try {
    const { sendMessage } = await import('../telegram/api.ts');
    const chatId =
      Bun.env.TELEGRAM_CHAT_ID?.trim() || Bun.env.TELEGRAM_GROUP_ID?.trim() || '';
    await sendMessage(chatId, text);
    return 'sent';
  } catch {
    return 'error';
  }
}
