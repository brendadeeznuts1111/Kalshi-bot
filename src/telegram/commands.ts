export type ParsedTelegramCommand = Readonly<{
  name: string;
  botUsername: string | null;
  args: readonly string[];
}>;

/** Parse a Bot API command while preserving argument case and punctuation. */
export function parseTelegramCommand(text: string): ParsedTelegramCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const [head, ...args] = trimmed.split(/\s+/);
  const token = head?.slice(1) ?? "";
  const separator = token.indexOf("@");
  const rawName = separator === -1 ? token : token.slice(0, separator);
  const rawBotUsername = separator === -1 ? null : token.slice(separator + 1);

  if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(rawName)) return null;
  if (rawBotUsername !== null && !/^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(rawBotUsername)) {
    return null;
  }

  return Object.freeze({
    name: rawName.toLowerCase(),
    botUsername: rawBotUsername?.toLowerCase() ?? null,
    args: Object.freeze(args),
  });
}
