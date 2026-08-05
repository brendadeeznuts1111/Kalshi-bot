/**
 * Telegram Bot API wrapper — Bun-native, zero deps.
 * @see https://core.telegram.org/bots/api
 */
const TOKEN = Bun.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not set");

const BASE = `https://api.telegram.org/bot${TOKEN}`;

export type TelegramMessage = {
  message_id: number;
  chat: { id: number; username?: string; first_name?: string };
  text?: string;
  date: number;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

export async function getUpdates(offset = 0, limit = 100): Promise<TelegramUpdate[]> {
  const url = `${BASE}/getUpdates?offset=${offset}&limit=${limit}`;
  const res = await fetch(url);
  const data = (await res.json()) as { ok: boolean; result: TelegramUpdate[] };
  if (!data.ok) throw new Error("getUpdates failed");
  return data.result;
}

export async function sendMessage(chatId: number, text: string, opts?: { parseMode?: "Markdown" | "HTML" }): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (opts?.parseMode) body.parse_mode = opts.parseMode;
  const res = await fetch(`${BASE}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean };
  if (!data.ok) console.error("sendMessage failed", { chatId, text: text.slice(0, 80) });
}

export async function sendPhoto(chatId: number, photoPath: string, caption?: string): Promise<void> {
  const file = Bun.file(photoPath);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("photo", new Blob([await file.arrayBuffer()], { type: file.type || "image/png" }));
  if (caption) form.append("caption", caption);
  const res = await fetch(`${BASE}/sendPhoto`, { method: "POST", body: form });
  const data = (await res.json()) as { ok: boolean };
  if (!data.ok) console.error("sendPhoto failed", { chatId, photoPath });
}

export async function setWebhook(url: string): Promise<void> {
  const res = await fetch(`${BASE}/setWebhook?url=${encodeURIComponent(url)}`);
  const data = (await res.json()) as { ok: boolean };
  if (!data.ok) console.error("setWebhook failed");
}

export async function deleteWebhook(): Promise<void> {
  await fetch(`${BASE}/deleteWebhook`);
}

// ── Chat / profile management ──────────────────────────────────

/** Get basic bot info: id, username, name. */
export async function getMe(): Promise<{ id: number; username: string; first_name: string }> {
  const res = await fetch(`${BASE}/getMe`);
  const data = (await res.json()) as { ok: boolean; result: { id: number; username: string; first_name: string } };
  if (!data.ok) throw new Error("getMe failed");
  return data.result;
}

/** Set the chat photo from a local file path. */
export async function setChatPhoto(chatId: number, photoPath: string): Promise<void> {
  const file = Bun.file(photoPath);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("photo", new Blob([await file.arrayBuffer()], { type: file.type || "image/png" }));
  const res = await fetch(`${BASE}/setChatPhoto`, { method: "POST", body: form });
  const data = (await res.json()) as { ok: boolean };
  if (!data.ok) console.error("setChatPhoto failed", { chatId });
}

/** Set or clear the chat description. */
export async function setChatDescription(chatId: number, description?: string): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId };
  if (description) body.description = description;
  const res = await fetch(`${BASE}/setChatDescription`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean };
  if (!data.ok) console.error("setChatDescription failed", { chatId });
}

/** Create a forum topic. Returns the topic's message_thread_id. */
export async function createForumTopic(
  chatId: number,
  name: string,
  iconColor = 0x6FB9F0,
  iconCustomEmojiId?: string,
): Promise<number> {
  const body: Record<string, unknown> = { chat_id: chatId, name, icon_color: iconColor };
  if (iconCustomEmojiId) body.icon_custom_emoji_id = iconCustomEmojiId;
  const res = await fetch(`${BASE}/createForumTopic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; result: { message_thread_id: number } };
  if (!data.ok) throw new Error("createForumTopic failed");
  return data.result.message_thread_id;
}

/** Set bot commands scoped to a specific chat. */
export async function setMyCommands(chatId: number, commands: Array<{ command: string; description: string }>): Promise<void> {
  const res = await fetch(`${BASE}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands, scope: { type: "chat", chat_id: chatId } }),
  });
  const data = (await res.json()) as { ok: boolean };
  if (!data.ok) console.error("setMyCommands failed", { chatId });
}

/** Set bot's display name. */
export async function setMyName(name: string): Promise<void> {
  const res = await fetch(`${BASE}/setMyName`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = (await res.json()) as { ok: boolean };
  if (!data.ok) console.error("setMyName failed");
}

/** Set bot's description shown in the profile. */
export async function setMyDescription(description: string): Promise<void> {
  const res = await fetch(`${BASE}/setMyDescription`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  const data = (await res.json()) as { ok: boolean };
  if (!data.ok) console.error("setMyDescription failed");
}

/** Get member count for a chat. */
export async function getChatMemberCount(chatId: number): Promise<number> {
  const res = await fetch(`${BASE}/getChatMemberCount?chat_id=${chatId}`);
  const data = (await res.json()) as { ok: boolean; result: number };
  if (!data.ok) throw new Error("getChatMemberCount failed");
  return data.result;
}

/** Get chat administrators. */
export async function getChatAdministrators(chatId: number): Promise<Array<{ user: { id: number; username?: string; first_name: string } }>> {
  const res = await fetch(`${BASE}/getChatAdministrators?chat_id=${chatId}`);
  const data = (await res.json()) as { ok: boolean; result: Array<{ user: { id: number; username?: string; first_name: string } }> };
  if (!data.ok) throw new Error("getChatAdministrators failed");
  return data.result;
}
